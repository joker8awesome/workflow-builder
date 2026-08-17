// 워크플로우 빌더 — 서버 연동 API (Express + PostgreSQL)
// 실행: node server.js  (기본 포트 3737)
const express = require('express');
const { Pool } = require('pg');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// Nous Portal 인증 토큰 로드 (서버에서만 사용 — 브라우저 노출 금지)
function getNousAuth() {
  try {
    const auth = JSON.parse(fs.readFileSync('/opt/data/auth.json', 'utf-8'));
    const nous = auth.providers && auth.providers.nous;
    if (!nous || !nous.access_token) return null;
    return {
      token: nous.access_token,
      base: nous.inference_base_url || 'https://inference-api.nousresearch.com/v1',
    };
  } catch (e) {
    console.warn('Nous auth 로드 실패:', e.message);
    return null;
  }
}

// === LLM 폴백 체인 — Nous 우선, 실패 시 대체 ===
let fallbackLog = [];
function logFallback(event) {
  fallbackLog.push({ ...event, ts: new Date().toISOString() });
  if (fallbackLog.length > 100) fallbackLog.shift();
}
async function callLLMWithFallback(messages, opts) {
  const nous = getNousAuth();
  if (!nous) return { fallback: true, error: 'no auth' };
  try {
    const r = await fetch(nous.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + nous.token },
      body: JSON.stringify({ model: opts.model, messages, temperature: opts.temperature || 0.2, max_tokens: opts.max_tokens || 100 }),
    });
    if (!r.ok) throw new Error('provider ' + r.status);
    const j = await r.json();
    logFallback({ provider: 'nous', ok: true });
    return { provider: 'nous', ok: true, data: j };
  } catch (e) {
    // 폴백 — 로컬 규칙 기반 (LLM 없이도 동작)
    logFallback({ provider: 'nous', ok: false, error: e.message, fallback: 'rule-based' });
    return { provider: 'rule-based', ok: true, fallback: true, data: { choices: [{ message: { content: opts.ruleFallback || 'NO' } }] } };
  }
}


const app = express();
app.use(express.json({ limit: '10mb' }));

// 폴백 로그 API
app.get('/api/fallback-log', (req, res) => res.json({ success: true, log: fallbackLog }));

const notify = require('./notify');
const { parseJsonbStrict } = require('./jsonb');
const { requireScope } = require('./auth-credential');
const { validateWebUrl } = require('./ssrf-guard');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

// === 팀 도구 전환 — 변경 API 인증 (단계적 적용) ===
// 무인증 변경 라우트가 23개 남아 있고, 웹 UI 가 아직 키 없이 호출한다.
// 한 번에 켜면 UI 가 전부 401 이 되므로 환경변수로 분리한다:
//   1) 이 코드를 배포한다 (기본 꺼짐 — 동작 변화 없음)
//   2) 프론트가 키를 보내는지 확인한다
//   3) WF_REQUIRE_AUTH_ALL=1 로 켠다  (재배포 없이 pm2 restart --update-env)
//   4) 문제가 있으면 즉시 끈다
const REQUIRE_AUTH_ALL = process.env.WF_REQUIRE_AUTH_ALL === '1';
function maybeAuth(scope) {
  const mw = requireScope(pool, scope || 'mcp:execute', { allowAccessToken: true });
  return function (req, res, next) {
    if (!REQUIRE_AUTH_ALL) return next();
    return mw(req, res, next);
  };
}

// /api/approvals 전용 플래그.
// 이 경로는 scheduler.py 가 인증 없이 호출하고 있어서 REQUIRE_AUTH_ALL 에서 제외해 뒀다.
// 그런데 열려 있는 동안은 누구나 승인 요청을 만들 수 있고, 그때마다 사용자 휴대폰으로
// 텔레그램 알림이 간다 — 실질적인 괴롭힘 벡터다.
//
// 켜기 전에 scheduler.py 가 키를 보내는지 반드시 확인할 것.
// 못 보내면 승인 요청이 401 로 실패하고 "알림이 안 온다"는 조용한 고장이 된다.
const APPROVALS_AUTH = process.env.WF_APPROVALS_AUTH === '1';
function approvalsAuth() {
  const mw = requireScope(pool, 'mcp:execute', { allowAccessToken: true });
  return function (req, res, next) {
    if (!APPROVALS_AUTH) return next();
    return mw(req, res, next);
  };
}
const approvalGate = require('./approval-gate');
// PostgreSQL — 로컬 소켓 trust
const pool = new Pool(process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : { host: process.env.PGHOST || '/opt/data/pgdata',
      database: process.env.PGDATABASE || 'odds',
      user: process.env.PGUSER || 'hermes',
      password: process.env.PGPASSWORD,
      port: process.env.PGPORT });
if (!process.env.DATABASE_URL && !process.env.PGHOST) {
  console.log('[db] 기본 소켓 경로 사용: /opt/data/pgdata');
}
// 자격증명 API 마운트 (Claude 세션 구현 — prefix/GET/DELETE/감사)
try {
  const createCredentialsRouter = require('./credentials-api');
  app.use('/', createCredentialsRouter(pool));
  console.log('[cred] credentials-api 마운트됨');
} catch (e) { console.warn('[cred] credentials-api 로드 실패:', e.message); }
// MCP 라우터 마운트 (외부 AI 세션 채널)
try {
  const mcpRouter = require('./mcp-router');
  app.use('/', mcpRouter);
  console.log('[mcp] 라우터 마운트됨: POST /mcp, GET /.well-known/mcp-server-card');
} catch (e) { console.warn('[mcp] 라우터 로드 실패:', e.message); }

const PORT = process.env.PORT || 3737;

// CORS — 배포 시 특정 출처 제한, 로컬은 전체 허용
const ALLOWED_ORIGINS = (process.env.WF_ALLOWED_ORIGINS || 'https://joker8awesome.github.io,http://localhost:3737,http://localhost:3000').split(',').map(s => s.trim());
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes('*') || (origin && ALLOWED_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 편집(mutation) API에만 인증 적용
app.post('/api/workflows',              maybeAuth('mcp:execute'));
app.put('/api/workflows/:id',           maybeAuth('mcp:execute'));
app.delete('/api/workflows/:id',        maybeAuth('mcp:execute'));
app.post('/api/workflows/:id/versions', maybeAuth('mcp:execute'));
app.post('/api/workflows/:id/logs',     maybeAuth('mcp:execute'));

// 목록
app.get('/api/workflows', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, updated_at FROM wf_workflows ORDER BY updated_at DESC'
    );
    res.json({ success: true, workflows: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 상세 (전체 데이터)
app.get('/api/workflows/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, data FROM wf_workflows WHERE id = $1', [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'not found' });
    res.json({ success: true, workflow: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 생성 (클라이언트가 id/name/data 제공)
app.post('/api/workflows', async (req, res) => {
  try {
    const { id, name, data } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    await pool.query(
      `INSERT INTO wf_workflows (id, name, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, updated_at = now()`,
      [id, name || '', JSON.stringify(data || {})]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 저장 (전체 덮어쓰기 upsert)
app.put('/api/workflows/:id', async (req, res) => {
  try {
    const { name, data } = req.body || {};
    await pool.query(
      `INSERT INTO wf_workflows (id, name, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, updated_at = now()`,
      [req.params.id, name || '', JSON.stringify(data || {})]
    );
    // 자동 버전 스냅샷 — 저장마다 wf_versions 기록 (최대 50개 보존)
    try {
      await pool.query('INSERT INTO wf_versions (wf_id, data, created_at) VALUES ($1,$2,now())',
        [req.params.id, JSON.stringify(data || {})]);
      await pool.query('DELETE FROM wf_versions WHERE wf_id = $1 AND id NOT IN (SELECT id FROM wf_versions WHERE wf_id = $1 ORDER BY id DESC LIMIT 50)', [req.params.id]);
    } catch (e) { console.warn('[wf] 버전 스냅샷 기록 실패:', e.message); }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 삭제
app.delete('/api/workflows/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM wf_workflows WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// HTML 이스케이프 (XSS 방지)
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// JSON을 <script> 안전하게 직렬화 — </script> 탈출 방지
function safeJson(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

// 공유 보기 라우트 — /wf/:id (읽기 전용 뷰)
app.get('/wf/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, data FROM wf_workflows WHERE id = $1', [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).send('<h2 style="font-family:system-ui;background:#0a0d10;color:#e8eaed;height:100vh;display:flex;align-items:center;justify-content:center;margin:0">워크플로우를 찾을 수 없습니다</h2>');
    }
    const wf = rows[0];
    res.send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(wf.name)} — 워크플로우 공유</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0a0d10;color:#e8eaed;height:100vh;display:flex;flex-direction:column;overflow:hidden}
  header{height:52px;background:#12161b;border-bottom:1px solid #232a33;display:flex;align-items:center;padding:0 16px;gap:12px}
  header strong{color:#00ff87}
  #canvas{flex:1;position:relative;overflow:auto}
  .node{position:absolute;min-width:160px;padding:10px 14px;background:#12161b;border:2px solid #232a33;border-radius:12px;display:flex;align-items:center;gap:8px;color:#e8eaed;box-shadow:0 1px 3px rgba(0,0,0,.1)}
  .node .nicon{width:26px;height:26px;border-radius:8px;color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px}
  .node .nlabel{font-size:14px;font-weight:600}
</style></head><body>
<header><strong>🔗 공유 워크플로우</strong><span style="color:#9aa3ad;font-size:13px">${esc(wf.name)}</span></header>
<div id="canvas"></div>
<script>
  const WF = ${safeJson(wf.data || { nodes: [], edges: [] })};
  const canvas = document.getElementById('canvas');
  (WF.nodes || []).forEach(n => {
    const el = document.createElement('div');
    el.className = 'node';
    el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
    const icon = { start:'▶', process:'▢', decision:'◇', end:'●' }[n.type] || '▢';
    const color = { start:'#2ea043', process:'#1f6feb', decision:'#d29922', end:'#d1242f' }[n.type] || '#1f6feb';
    el.innerHTML = '<span class="nicon" style="background:' + color + '">' + icon + '</span><span class="nlabel">' + esc(n.label||'') + '</span>';
    canvas.appendChild(el);
  });
</script>
</body></html>`);
  } catch (e) {
    res.status(500).send('서버 오류');
  }
});

// 정적 파일 (index.html 서빙)
app.use(express.static(__dirname));

const server = http.createServer(app);

// === 실시간 협업 (WebSocket) ===
const wss = new WebSocketServer({ noServer: true });
const wsClients = new Set();
wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('message', (raw) => {
    // 모든 클라이언트에게 브로드캐스트 (간단한 협업)
    wsClients.forEach(c => {
      if (c !== ws && c.readyState === 1) c.send(raw.toString());
    });
  });
  ws.on('close', () => wsClients.delete(ws));
});
function broadcastWf(id, data) {
  const msg = JSON.stringify({ type: 'wf_update', id, data });
  wsClients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

// === 에이전트 보고 API — trace_id로 상태 갱신 + 결과 저장 ===
app.post('/api/agent/report', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { trace_id, status, summary, result_ref, agent_id } = req.body || {};
    if (!trace_id) return res.status(400).json({ success: false, error: 'trace_id required' });
    // 해당 trace의 명령을 completed/failed로 갱신
    await pool.query(
      `UPDATE agent_messages SET status = $1, read_at = now() WHERE trace_id = $2`,
      [status || 'completed', trace_id]
    );
    // 결과 저장 — 외래키 실패 시 무시 (상태 갱신은 이미 완료)
    if (result_ref || summary) {
      try {
        await pool.query(
          `INSERT INTO wf_results (wf_id, node_id, result) VALUES ($1,$2,$3)`,
          [trace_id.slice(0, 8), result_ref || 'report_' + trace_id.slice(0, 6),
           JSON.stringify({ agent: agent_id || '', summary: summary || '', status: status || 'completed' })]
        );
      } catch (fkErr) { /* wf_id 외래키 미존재 — 무시 */ }
    }
    // 웹 UI에 이벤트 브로드캐스트 — 실시간 반영
    broadcastWf(trace_id, { agent_report: true, status: status || 'completed', summary: summary || '' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 에이전트 팀 협업 — 역할 기반 라우팅 규칙 ===
const TEAM_ROUTES = {
  ag_orch:        { receive: ['*'],             default_to: 'ag_communicator' },
  ag_researcher:  { receive: ['ag_orch','ag_collector'], default_to: 'ag_analyst' },
  ag_analyst:     { receive: ['ag_researcher','ag_orch'], default_to: 'ag_writer' },
  ag_writer:      { receive: ['ag_analyst','ag_orch'],    default_to: 'ag_reviewer' },
  ag_reviewer:    { receive: ['ag_writer','ag_developer'], default_to: 'ag_orch' },
  ag_collector:   { receive: ['ag_orch','ag_researcher'], default_to: 'ag_researcher' },
  ag_developer:   { receive: ['ag_orch','ag_designer'],   default_to: 'ag_tester' },
  ag_tester:      { receive: ['ag_developer','ag_orch'],  default_to: 'ag_reviewer' },
  ag_designer:    { receive: ['ag_orch'],                 default_to: 'ag_developer' },
  ag_security:    { receive: ['ag_orch','ag_developer'],  default_to: 'ag_reviewer' },
  ag_communicator:{ receive: ['ag_orch'],                 default_to: 'ag_archiver' },
  ag_scheduler:   { receive: ['ag_orch'],                 default_to: 'ag_communicator' },
  ag_integrator:  { receive: ['ag_orch','ag_developer'],  default_to: 'ag_tester' },
  ag_archiver:    { receive: ['*'],                       default_to: 'ag_orch' },
  ag_auditor:     { receive: ['ag_orch'],                 default_to: 'ag_orch' },
  ag_deepseek:    { receive: ['ag_orch','ag_analyst'],     default_to: 'ag_reviewer' },
};
// 다음 담당자 추천 — 핸드오프 프로토콜
app.get('/api/team/next/:agentId', (req, res) => {
  const route = TEAM_ROUTES[req.params.agentId];
  res.json({ success: true, agent_id: req.params.agentId, next: route ? route.default_to : 'ag_orch', receive_from: route ? route.receive : ['*'] });
});
// 팀 전체 상태 — 15개 세션 한눈에
app.get('/api/team/status', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id AS agent_id, a.name AS agent_name, a.role, a.color,
              count(DISTINCT s.id) FILTER (WHERE s.status IN ('running','working','waiting')) AS active_sessions,
              count(DISTINCT s.id) AS total_sessions,
              (SELECT count(*) FROM agent_messages m WHERE m.to_agent = a.id AND m.status = 'pending') AS pending_msgs
       FROM agents a
       LEFT JOIN agent_sessions s ON s.agent_id = a.id
       WHERE a.id IN (${Object.keys(TEAM_ROUTES).map((_, i) => '$' + (i + 1)).join(',')})
       GROUP BY a.id, a.name, a.role, a.color
       ORDER BY a.id`, Object.keys(TEAM_ROUTES));
    res.json({ success: true, team: rows });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 에이전트 연결 상태 API — 웹 UI 라이브 표시용 ===
app.get('/api/agents/status', (req, res) => {
  const online = [];
  agentSockets.forEach((ws, agentId) => {
    if (ws.readyState === 1) online.push(agentId);
  });
  res.json({ success: true, online });
});
// 에이전트 연결/해제를 웹 UI에 푸시
function broadcastAgentStatus() {
  const online = [];
  agentSockets.forEach((ws, agentId) => { if (ws.readyState === 1) online.push(agentId); });
  broadcastWf('_agent_status', { agent_status: online });
}

// === 에이전트 명령 전송 API — DB 기록 + WS push ===
app.post('/api/agent/command', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { to_agent, msg_type, payload_ref, trace_id, payload, from_agent } = req.body || {};
    if (!to_agent) return res.status(400).json({ success: false, error: 'to_agent required' });
    const sid = 'sess_' + Date.now().toString(36);
    await pool.query(
      `INSERT INTO agent_messages (msg_type, from_agent, to_agent, session_id, payload, status, trace_id, payload_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [msg_type || 'command', from_agent || 'web', to_agent, sid,
       JSON.stringify(payload || {}), 'pending', trace_id || '', payload_ref || '']
    );
    // WS push — 연결된 에이전트에게 즉시 전달 (미연결이면 DB에만 → MCP로 픽업)
    const pushed = await sendAgentCommand(to_agent, {
      type: msg_type || 'command', from_agent: from_agent || 'web', to_agent,
      payload_ref: payload_ref || '', trace_id: trace_id || '', payload: payload || {}
    });
    res.json({ success: true, pushed, session_id: sid });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 에이전트 WS 브릿지 — /ws/agent/:agent_id (외부 AI 세션 채널) ===
const agentSockets = new Map();  // agent_id → WebSocket
const agentWss = new WebSocketServer({ noServer: true });
// upgrade 통합 핸들러 — 웹 WS(/ws)와 에이전트 WS(/ws/agent) 경로 분기
server.on('upgrade', (req, socket, head) => {
  const pathname = (req.url || '').split('?')[0];
  if (pathname === '/ws/agent') {
    agentWss.handleUpgrade(req, socket, head, (ws) => agentWss.emit('connection', ws, req));
  } else if (pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  } else {
    socket.destroy();
  }
});
agentWss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const agentId = url.searchParams.get('agent_id') || '';
  const key = url.searchParams.get('key') || '';
  if (!agentId || !key) { ws.close(4001, 'agent_id/key required'); return; }
  // 자격증명 검증 — SHA-256 key_hash 기반 (credentials-api 저장 방식)
  const keyHash = require('crypto').createHash('sha256').update(key).digest('hex');
  pool.query(
    'SELECT agent_id FROM agent_credentials WHERE key_hash = $1 AND (revoked_at IS NULL) AND (expires_at IS NULL OR expires_at > now())',
    [keyHash]
  )
    .then(r => {
      if (!r.rows.length || r.rows[0].agent_id !== agentId) { ws.close(4003, 'invalid credential'); return; }
      agentSockets.set(agentId, ws);
      pool.query('UPDATE agent_credentials SET last_used_at = now() WHERE key_hash = $1', [keyHash]).catch(e => console.warn('[auth] last_used_at 갱신 실패:', e.message));
      ws.send(JSON.stringify({ type: 'connected', agent_id: agentId, ts: new Date().toISOString() }));
      console.log('[agent-ws] 연결됨:', agentId);
      broadcastAgentStatus();
    })
    .catch(e => { ws.close(4002, 'db error'); });
  ws.on('message', (raw) => {
    // 에이전트가 보낸 보고 → audit 로그
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'report') {
        pool.query("UPDATE agent_messages SET task_status = 'completed', updated_at = now() WHERE trace_id = $1", [msg.trace_id || '']).catch(e => console.warn('[agent-ws] task_status 갱신 실패:', e.message));
      }
    } catch (e) { console.warn('[agent-ws] 수신 메시지 처리 실패:', e.message); }
  });
  ws.on('close', () => { agentSockets.delete(agentId); console.log('[agent-ws] 해제:', agentId); broadcastAgentStatus(); });
});

// 에이전트에게 명령 전송 — orchestrator/웹 UI에서 호출
async function sendAgentCommand(toAgent, message) {
  const ws = agentSockets.get(toAgent);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(message));
    return true;
  }
  return false;  // 미연결 — DB에만 저장 (MCP로 나중에 픽업)
}

// === 서버 버전 히스토리 ===
app.post('/api/workflows/:id/versions', async (req, res) => {
  try {
    const { name, data } = req.body || {};
    await pool.query(
      `INSERT INTO wf_versions (wf_id, name, data, created_at)
       VALUES ($1, $2, $3, now())`,
      [req.params.id, name || '', JSON.stringify(data || {})]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.get('/api/workflows/:id/versions', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, created_at FROM wf_versions WHERE wf_id = $1 ORDER BY created_at DESC LIMIT 30',
      [req.params.id]
    );
    res.json({ success: true, versions: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.get('/api/workflows/:id/versions/:vid', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, wf_id, name, data FROM wf_versions WHERE id = $1 AND wf_id = $2',
      [req.params.vid, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'not found' });
    res.json({ success: true, version: rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// === 실행 로그 ===
app.post('/api/workflows/:id/logs', async (req, res) => {
  try {
    const { path, ts } = req.body || {};
    await pool.query(
      `INSERT INTO wf_runlogs (wf_id, run_path, run_at) VALUES ($1, $2, $3)`,
      [req.params.id, path || '', ts || new Date().toISOString()]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.get('/api/workflows/:id/logs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT run_path, run_at FROM wf_runlogs WHERE wf_id = $1 ORDER BY run_at DESC LIMIT 20',
      [req.params.id]
    );
    res.json({ success: true, logs: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 2: secret masking
function maskSecrets(str) {
  if (!str) return str;
  return String(str)
    .replace(/eyJ[A-Za-z0-9_-]{10,}/g, '[TOKEN_MASKED]')
    .replace(/rt_rtkR8[A-Za-z0-9_-]{5,}/g, '[REFRESH_MASKED]')
    .replace(/(api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?[A-Za-z0-9_-]{8,}/gi, '$1=[MASKED]');
}
function maskedError(e) { return maskSecrets(e.message); }

// === PII 레드액션 — LLM 프롬프트 전에 민감 데이터 마스킹 ===
function redactPII(str) {
  if (!str) return str;
  return String(str)
    .replace(/[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])-[1-4][0-9]{6}/g, '[SSN]')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '[EMAIL]')
    .replace(/\b(010|011|016|017|018|019)[- ]?\d{3,4}[- ]?\d{4}\b/g, '[PHONE]')
    .replace(/\b\d{6}-\d{7}\b/g, '[RESID]')
    .replace(/\b(\d{4}[- ]?){4}\b/g, '[CARD]');
}
// 감사 로그 저장 시 PII 마스킹
function maskAudit(text) { return redactPII(text || ''); }

// === LLM 판단 API (decision 노드: llm_prompt) ===
app.post('/api/ai/decide', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { prompt, context } = req.body || {};
    if (!prompt) return res.status(400).json({ success: false, error: 'prompt required' });
    const auth = getNousAuth();
    if (!auth) return res.status(503).json({ success: false, error: 'Nous 인증 없음' });
    const sys = `You are a workflow decision maker. Given a question and context, answer with ONLY \"YES\" or \"NO\" followed by a confidence score 0-100. Format: YES 85 or NO 70.
Question: ${prompt}
Context: ${JSON.stringify(context || {})}`;
    const r = await fetch(auth.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.token },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v4-flash-0731',
        messages: [{ role: 'system', content: sys }],
        temperature: 0.1, max_tokens: 100,
      }),
    });
    if (!r.ok) return res.status(502).json({ success: false, error: 'LLM 오류 ' + r.status });
    const data = await r.json();
    const answer = (data.choices?.[0]?.message?.content || '').trim().toUpperCase();
    const yes = answer.includes('YES');
    const confMatch = answer.match(/(\d{1,3})/);
    const confidence = confMatch ? Math.min(100, Math.max(0, parseInt(confMatch[1]))) : 50;
    res.json({ success: true, decision: yes, confidence, raw: answer });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 웹훅 트리거 — 외부 이벤트로 워크플로우 실행 ===
const webhookTokens = new Map(); // token -> { wfId, nodeId }
app.post('/api/webhook/register', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { wf_id, node_id } = req.body || {};
    if (!wf_id) return res.status(400).json({ success: false, error: 'wf_id required' });
    const token = 'wh_' + Math.random().toString(36).slice(2, 12);
    webhookTokens.set(token, { wfId: wf_id, nodeId: node_id || '' });
    res.json({ success: true, webhook_url: '/api/webhook/' + token, token });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.post('/api/webhook/:token', async (req, res) => {
  const reg = webhookTokens.get(req.params.token);
  if (!reg) return res.status(404).json({ success: false, error: 'invalid token' });
  // 실행 로그에 웹훅 호출 기록
  try {
    await pool.query(
      `INSERT INTO wf_runlogs (wf_id, run_path, run_at) VALUES ($1, $2, now())`,
      [reg.wfId, 'WEBHOOK → ' + (reg.nodeId || 'start')]
    );
  } catch (e) { console.warn('[webhook] 실행 로그 기록 실패:', e.message); }
  res.json({ success: true, triggered: reg });
});

// === 실행 스크립트 API (노드 액션: script) ===
app.post('/api/exec', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { script, args } = req.body || {};
    if (!script || typeof script !== 'string') {
      return res.status(400).json({ success: false, error: 'script required' });
    }
    // 8: whitelist + sandbox
    const SAFE = /^[a-zA-Z0-9_\/.\-\s=]+$/;
    if (!SAFE.test(script)) {
      return res.status(400).json({ success: false, error: 'invalid script (safe mode)' });
    }
    const dang = ['rm ', 'sudo ', 'curl ', 'wget ', '-delete', 'shutdown', 'reboot', 'dd ', 'chmod 777'];
    if (dang.some(d => script.includes(d))) {
      return res.status(403).json({ success: false, error: 'dangerous command blocked' });
    }
    // 2: agent workspace isolation — 에이전트별 디렉토리 강제
    const { agent_id } = req.body || {};
    const AGENT_ROOT = '/opt/data/agents';
    let cwd = '/opt/data/projects/workflow-builder';
    if (agent_id) {
      cwd = AGENT_ROOT + '/' + agent_id;
      try { fs.mkdirSync(cwd, { recursive: true }); } catch (e) { console.warn('[exec] 작업 디렉터리 생성 실패:', e.message); }
    }
    // 3: resource budget — 최대 실행 시간 (기본 10s)
    const { timeout } = req.body || {};
    const MAX_TIMEOUT = timeout ? Math.min(+timeout, 30) : 10;
    const { execSync } = require('child_process');
    const out = execSync(script, { encoding: 'utf-8', timeout: MAX_TIMEOUT * 1000, env: process.env, cwd });
    res.json({ success: true, output: out.slice(0, 2000), cwd });
  } catch (e) {
    res.status(500).json({ success: false, error: maskedError(e) });
  }
});

// === 노드 댓글 API ===
app.get('/api/workflows/:id/comments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, node_id, author, text, created_at FROM wf_comments WHERE wf_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ success: true, comments: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.post('/api/workflows/:id/comments', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { node_id, author, text } = req.body || {};
    if (!text) return res.status(400).json({ success: false, error: 'text required' });
    const { rows } = await pool.query(
      `INSERT INTO wf_comments (wf_id, node_id, author, text) VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
      [req.params.id, node_id || '', author || '익명', text]
    );
    res.json({ success: true, comment: rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// === 실행 결과 저장/조회 ===
app.post('/api/workflows/:id/results', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { node_id, result, run_at } = req.body || {};
    await pool.query(
      `INSERT INTO wf_results (wf_id, node_id, result, run_at) VALUES ($1, $2, $3, $4)`,
      [req.params.id, node_id || '', JSON.stringify(result || {}), run_at || new Date().toISOString()]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.get('/api/workflows/:id/results', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT node_id, result, run_at FROM wf_results WHERE wf_id = $1 ORDER BY run_at DESC LIMIT 50',
      [req.params.id]
    );
    res.json({ success: true, results: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// === 실행 통계 API ===
app.get('/api/stats', async (req, res) => {
  try {
    const wf = await pool.query('SELECT COUNT(*) AS cnt FROM wf_workflows');
    const ver = await pool.query('SELECT COUNT(*) AS cnt FROM wf_versions');
    const logs = await pool.query('SELECT COUNT(*) AS cnt FROM wf_runlogs');
    const recent = await pool.query(
      'SELECT wf_id, run_path, run_at FROM wf_runlogs ORDER BY run_at DESC LIMIT 10'
    );
    res.json({
      success: true,
      stats: {
        workflows: wf.rows[0].cnt,
        versions: ver.rows[0].cnt,
        runs: logs.rows[0].cnt,
        recentRuns: recent.rows,
      },
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// === DB 백업 (pg_dump) ===
app.get('/api/backup', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    const out = execSync(
      '/usr/lib/postgresql/17/bin/pg_dump -h /opt/data/pgdata -U hermes -d odds -t wf_workflows -t wf_versions -t wf_runlogs',
      { encoding: 'utf-8', env: { ...process.env, PATH: '/usr/lib/postgresql/17/bin:' + process.env.PATH } }
    );
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', 'attachment; filename="workflow_backup_' + new Date().toISOString().slice(0,10) + '.sql"');
    res.send(out);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === 에이전트 레지스트리 API ===
app.get('/api/agents', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM agents ORDER BY created_at DESC');
    res.json({ success: true, agents: rows });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.post('/api/agents', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { id, name, person, role, machine, color, owner } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    // owner — 이 에이전트를 담당하는 사람. 팀 도구 전환에서 키 귀속의 기준이 된다.
    // 이전에는 어떤 API도 owner 를 쓰지 않아 16명 전원 빈 문자열이었다.
    // 본문에 없으면 null 을 넘기고 COALESCE 로 기존 값을 보존한다 (생략 = 삭제가 되지 않도록).
    await pool.query(
      `INSERT INTO agents (id, name, person, role, machine, color, owner)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, ''))
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, person=EXCLUDED.person,
         role=EXCLUDED.role, machine=EXCLUDED.machine, color=EXCLUDED.color,
         owner=COALESCE($7, agents.owner)`,
      [id, name || '', person || '', role || '', JSON.stringify(machine || {}), color || '#00ff87',
       (owner === undefined || owner === null) ? null : String(owner)]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.delete('/api/agents/:id', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    await pool.query('DELETE FROM agents WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 승인 감사 API (Strong HITL) ===
app.post('/api/approvals', approvalsAuth(), async (req, res) => {
  try {
    const { wf_id, node_id, agent_id, approver, decision, checklist, context, action } = req.body || {};
    if (!wf_id) return res.status(400).json({ success: false, error: 'wf_id required' });
    const { rows } = await pool.query(
      `INSERT INTO wf_approvals (wf_id, node_id, agent_id, approver, decision, checklist, context, decided_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now()) RETURNING id`,
      [wf_id, node_id || '', agent_id || '', approver || 'system', decision || 'pending',
       JSON.stringify(checklist || {}), context || '']
    );
    // 승인 대기 건은 사용자에게 실제로 전달한다.
    // 이전에는 여기서 기록만 하고 아무에게도 알리지 않아, 사용자가 직접
    // 조회하지 않는 한 승인 요청이 있다는 사실조차 알 수 없었다.
    let notified = null;
    if ((decision || 'pending') === 'pending') {
      notified = await notify.approvalRequest({
        id: rows[0].id,
        action: action || 'unknown',
        detail: context || '',
        requester: agent_id || approver || '-',
        wf_id,
      });
    }
    res.json({ success: true, id: rows[0].id, notified: notified ? notified.sent : null });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// 웹훅 상태 조회 — 봇 토큰 없이도 "버튼이 왜 안 되는지" 확인할 수 있다
app.get('/api/telegram/status', requireScope(pool, 'mcp:read', { allowAccessToken: true }), (req, res) => {
  res.json({
    success: true,
    configured: Boolean(process.env.WF_TELEGRAM_WEBHOOK_SECRET),
    chat_id_set: Boolean(process.env.WF_TELEGRAM_CHAT_ID),
    notify_enabled: notify.enabled(),
    ...tgStat,
    webhook_registered: Boolean(tgStat.webhookUrl),
    hint: tgStat.webhookUrl === '' ? '웹훅이 등록돼 있지 않다 — 같은 봇 토큰으로 getUpdates 롱폴링을 도는 프로세스가 있는지 확인할 것'
      : tgStat.lastRejectReason === 'secret_mismatch'
      ? '텔레그램에 등록된 secret 이 서버 설정과 다르다 — setup-telegram-webhook.js --apply 로 재등록'
      : (tgStat.acceptCount === 0 && tgStat.rejectCount === 0
          ? '업데이트가 한 번도 도달하지 않았다 — 웹훅 미등록이거나 URL 이 잘못됐을 수 있다'
          : tgStat.messageCount === 0 && tgStat.callbackCount > 0
          ? '버튼은 오는데 사용자 텍스트가 한 번도 오지 않았다 — allowed_updates 에 message 가 빠졌을 수 있다'
          : null),
  });
});

// 에이전트 깨우기 — 큐에 지시가 들어왔을 때 scheduler 가 부른다.
// 알림(커멘드센터 봇)과 깨우기(게이트웨이 봇)는 목적도 수신자도 다르므로 분리한다.
app.post('/api/agents/:id/wake', requireScope(pool, 'mcp:execute', { allowAccessToken: true }), async (req, res) => {
  try {
    const { reason, trace_id, payload_ref, message_id } = req.body || {};
    const lines = [
      `[자동] ${req.params.id} 앞으로 지시가 도착했습니다.`,
      message_id ? `msg ${message_id}` : null,
      trace_id ? `trace ${trace_id}` : null,
      payload_ref ? `참조: ${payload_ref}` : null,
      reason || null,
      '',
      'git pull origin main 후 해당 지시서를 읽고 수행하세요.',
    ].filter(Boolean);
    const out = await notify.wakeAgent(lines.join('\n'));
    res.json({ success: true, woken: out.sent, reason: out.reason || null });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// 승인 결정 기록 — 텔레그램 버튼/웹 UI 양쪽에서 쓴다
app.post('/api/approvals/:id/decide', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { decision, approver } = req.body || {};
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, error: "decision must be 'approved' or 'rejected'" });
    }
    const { rowCount } = await pool.query(
      `UPDATE wf_approvals SET decision=$1, approver=$2, decided_at=now()
       WHERE id=$3 AND decision='pending'`,
      [decision, approver || 'user', req.params.id]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'not_found_or_already_decided' });
    res.json({ success: true, id: req.params.id, decision });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// 대기 중인 승인만 — 에이전트가 진행 가능 여부를 판단할 때 쓴다
app.get('/api/approvals/pending', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, wf_id, node_id, agent_id, context, created_at
       FROM wf_approvals WHERE decision='pending' ORDER BY created_at ASC LIMIT 100`
    );
    res.json({ success: true, pending: rows });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// 승인 게이트 설정 조회 — 무엇이 자동 통과인지 확인용
app.get('/api/approvals/config', (req, res) => {
  res.json({ success: true, ...approvalGate.describe(), notify_enabled: notify.enabled() });
});

// === 텔레그램 웹훅 — 승인 버튼 처리 ===
//
// 이 엔드포인트는 텔레그램이 호출해야 하므로 인터넷에 공개된다.
// 따라서 두 겹으로 막는다. 둘 중 하나라도 없으면 승인 위조가 가능하다:
//   1) X-Telegram-Bot-Api-Secret-Token — setWebhook 시 심은 값과 일치해야 함
//   2) chat_id — 지정된 채팅에서 온 것만 허용
// 웹훅 상태 — "버튼이 안 눌린다"를 진단 가능하게 만든다.
// secret 이 어긋나면 서버가 403 으로 조용히 거부하고, 텔레그램은 사용자에게
// 아무것도 알리지 않는다. 그래서 증상이 "버튼 먹통"으로만 보이고
// 원인을 밖에서 확인할 방법이 없었다. 실제로 그 상태로 한참 갔다.
// 버튼(callback_query)과 사용자 텍스트(message)를 따로 센다.
// 한 칸으로 합쳐두면 "웹훅은 살아 있는데 어느 쪽이 오는지" 를 알 수 없다 —
// message 를 allowed_updates 에 추가한 뒤 그게 실제로 도착하는지가 별개 질문이 됐다.
const tgStat = {
  lastCallbackAt: null,   // 마지막으로 정상 처리한 콜백(버튼)
  lastMessageAt: null,    // 마지막으로 받은 사용자 텍스트
  lastRejectAt: null,     // 마지막 거부
  lastRejectReason: null,
  rejectCount: 0,
  acceptCount: 0,         // 콜백 + 메시지 합계 (웹훅이 살아 있는가)
  callbackCount: 0,
  messageCount: 0,
};

/**
 * 사용자가 커멘드센터 봇에 보낸 텍스트를 처리한다.
 *
 * 이전에는 버튼(callback_query)만 받아서 한 방향이었다 — 알림은 오는데
 * 사용자가 말을 걸 수는 없었다. 이제 조회 명령과 지시 전달이 가능하다.
 *
 * 지시는 여기서 직접 실행하지 않고 **큐에 넣는다.**
 * 서버가 판단·실행까지 하면 승인 게이트를 우회하게 되고, 텔레그램 한 줄로
 * 프로덕션이 바뀔 수 있다. 큐에 넣으면 기존 경로(감지→알림→승인→수행)를 그대로 탄다.
 */
async function handleUserMessage(msg) {
  const allowed = String(process.env.WF_TELEGRAM_CHAT_ID || '');
  const from = String(msg.chat?.id ?? '');
  if (allowed && from !== allowed) {
    console.warn(`[tg] 허용되지 않은 채팅 ${from} — 메시지 무시`);
    return;
  }
  // 봇이 보낸 메시지는 무시한다 — 봇끼리 오가며 무한 루프가 되는 것을 막는다
  if (msg.from?.is_bot) return;

  const text = String(msg.text || '').trim();
  if (!text) return;
  const who = msg.from?.username ? '@' + msg.from.username : (msg.from?.first_name || 'user');
  console.log(`[tg] 사용자 메시지 (${who}): ${text.slice(0, 80)}`);

  const send = t => notify.send(t);

  // --- 조회 명령: 읽기만 하므로 바로 답한다 ---
  if (text === '/help' || text === '도움말') {
    return send(notify.esc(
      '커멘드센터\n\n' +
      '/status  시스템 상태\n' +
      '/queue   대기 중인 지시·승인\n' +
      '/지시 …  센터장에게 전달 (길어도 그대로)\n' +
      '/help    이 도움말\n\n' +
      '짧은 문장은 그대로 지시가 됩니다.\n' +
      '길거나 여러 줄이면 붙여넣기로 보고 되묻습니다.'));
  }

  if (text === '/status' || text === '상태') {
    const [wf, ag, ap] = await Promise.all([
      pool.query('SELECT count(*)::int n FROM wf_workflows'),
      pool.query('SELECT count(*)::int n FROM agents'),
      pool.query("SELECT count(*)::int n FROM wf_approvals WHERE decision='pending'"),
    ]);
    const g = approvalGate.describe();
    return send(notify.esc(
      `상태\n\n워크플로우 ${wf.rows[0].n} · 에이전트 ${ag.rows[0].n}\n` +
      `승인 대기 ${ap.rows[0].n}\n` +
      `승인 필요 작업: ${g.required.join(', ') || '(없음)'}\n` +
      `웹훅 ${tgStat.webhookUrl ? '등록됨' : '미등록'} · 버튼 ${tgStat.callbackCount}건 · 메시지 ${tgStat.messageCount}건`));
  }

  if (text === '/queue' || text === '큐') {
    const { rows } = await pool.query(
      `SELECT id, from_agent, to_agent, msg_type, trace_id FROM agent_messages
        WHERE status='pending' ORDER BY id DESC LIMIT 10`);
    const body = rows.length
      ? rows.map(r => `${r.id} ${r.from_agent}→${r.to_agent} (${r.msg_type})`).join('\n')
      : '대기 중인 지시 없음';
    return send(notify.esc('큐\n\n' + body));
  }

  // --- 강제 적재 표시를 먼저 떼어낸다 ---
  // 이게 맨 앞이어야 한다. 아래 필터들보다 뒤에 두면 /지시 를 붙여도 필터에 걸려
  // 탈출구가 무의미해진다 — 실제로 그렇게 돼 있었다. 필터가 필요한 내용일수록
  // 마커·보고 용어가 많아서, 정작 강제로 보내야 할 지시가 막힌다.
  const FORCE = /^\/(지시|task|cmd)\s+/;
  const forced = FORCE.test(text);
  const body = forced ? text.replace(FORCE, '').trim() : text;
  if (!body) return send(notify.esc('내용이 비어 있습니다. /지시 뒤에 할 일을 적어주세요.'));

  // --- 응답 붙여넣기 노이즈 필터 (강화판) ---
  // 서버 응답(할매봇 보고)을 텔레그램에서 그대로 복붙하면 지시로 오인돼 큐에 쌓인다.
  // (a) 첫 줄이 응답 마커로 시작하거나 (b) 본문 전체에 마커/특징이 다수 등장하면 skip.
  //     (a)만으로는 msg_257 처럼 "짧은 지시 + 뒤에 응답 전문" 케이스를 놓친다.
  const firstLine = body.split('\n')[0].trim();
  const RESPONSE_MARKERS = /^(✅|❌|⏳|📋|📥|📤|📊|🎉|🔴|🟠|🟡|🟢|🔔|🔒|⚠️|💡|📄|🤖|👑|🚀|#{1,3}\s|\|\s|=+\s)/u;
  const MARKER_ANY = /(✅|❌|⏳|📋|📥|📤|📊|🎉|🔴|🟠|🟡|🟢|🔔|🔒|⚠️|💡|📄|🤖|👑|🚀)/gu;
  const HEADER_ANY = /(^|\n)(#{1,3}\s|\|\s|={3,}|━{3,})/g;
  const REPORT_TERMS = /(pending\s*\d+건|claimed|completed\s*\||msg[_ ]?\d{2,}|커밋\s+push|npm\s+test|정리\s+결과|필터\s+규칙|판정\s+결과|반영\s*\n|시스템\s+상태|처리\s+결과)/gi;

  const markerCount = (text.match(MARKER_ANY) || []).length;
  const headerCount = (text.match(HEADER_ANY) || []).length;
  const termCount = (text.match(REPORT_TERMS) || []).length;
  const lineCount = text.split('\n').length;

  // 판정 규칙:
  //  1. 첫 줄이 응답 마커로 시작 → skip (기존)
  //  2. msg_숫자 시작 → skip (기존)
  //  3. 다행 텍스트(3줄 이상)에서 마커/헤더/보고 용어가 총 3개 이상 → skip (강화)
  //  4. 마커가 5개 이상이면 짧아도 skip
  const looksLikeReport = !forced && (
    RESPONSE_MARKERS.test(firstLine)
    || /^msg[_ ]?\d{2,}/i.test(firstLine)
    || (lineCount >= 3 && (markerCount + headerCount + termCount) >= 3)
    || markerCount >= 5);

  if (looksLikeReport) {
    console.log(`[tg] 응답 붙여넣기로 판정 — 큐 적재 건너뜀 (${who}) | markers=${markerCount} headers=${headerCount} terms=${termCount} lines=${lineCount} | first="${firstLine.slice(0, 60)}"`);
    return send(notify.esc('응답 붙여넣기로 판정돼 큐에 넣지 않았습니다.\n지시는 자연 문장으로 보내주세요 (예: "워크플로우 A 배포").'));
  }

  // --- 그 밖의 문장: 센터장 앞으로 큐에 넣는다 ---
  //
  // 다만 아무 문장이나 넣지는 않는다. 사용자가 봇 응답을 그대로 복사해 다시
  // 붙여넣는 일이 실제로 있었다 (msg_255·256). 봇이 보낸 것은 is_bot 으로 걸러지지만,
  // **사람이 붙여넣으면 사람 계정에서 오므로** 그 방어가 통하지 않는다.
  // 그렇게 들어온 가짜 지시를 센터장이 받으면, 그 처리 결과를 또 붙여넣는 순환이 생긴다.
  //
  // 길거나 여러 줄인 것은 사람이 손으로 친 지시가 아니라 붙여넣기일 가능성이 높다.
  // 확신할 수 없으므로 막지 않고 **되묻는다** — /지시 를 붙이면 그대로 들어간다.
  const lines = lineCount;
  const looksPasted = !forced && (body.length > 400 || lines > 6);

  if (looksPasted) {
    console.log(`[tg] 붙여넣기로 보여 보류: ${body.length}자 ${lines}줄`);
    return send(notify.esc(
      `길어서 지시로 넣지 않았습니다 (${body.length}자 ${lines}줄).\n\n` +
      '봇 응답을 다시 붙여넣은 것이라면 그대로 두시면 됩니다.\n' +
      '진짜 지시라면 앞에 /지시 를 붙여 다시 보내주세요.'));
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO agent_messages (msg_type, from_agent, to_agent, payload, status, trace_id)
       VALUES ('instruction', $1, 'ag_claude_desktop', $2, 'pending', $3) RETURNING id`,
      [`telegram:${who}`, JSON.stringify({ text: body, from: who, via: 'telegram', forced }),
       'trace_tg_' + Date.now().toString(36)]);
    await send(notify.esc(`전달했습니다 (msg ${rows[0].id})\n센터장이 확인하면 보고가 옵니다.`));
    console.log(`[tg] 지시 큐 적재: msg ${rows[0].id}`);
  } catch (e) {
    console.warn('[tg] 지시 적재 실패:', e.message);
    await send(notify.esc('전달하지 못했습니다: ' + e.message));
  }
}

// 웹훅 등록 상태를 텔레그램에 직접 물어본다.
async function checkWebhookAlive() {
  if (!notify.enabled()) return;
  try {
    const info = await notify.tg('getWebhookInfo', {});
    if (!info.ok) { console.warn('[tg] 웹훅 상태 조회 실패:', info.reason); return; }
    const url = (info.result && info.result.url) || '';
    tgStat.webhookUrl = url;
    tgStat.webhookCheckedAt = new Date().toISOString();
    tgStat.webhookLastError = (info.result && info.result.last_error_message) || null;
    if (!url) {
      console.warn('[tg] ⚠ 웹훅이 등록돼 있지 않다 — 승인 버튼이 동작하지 않는다.');
      console.warn('[tg]   같은 봇 토큰으로 getUpdates 롱폴링을 도는 프로세스가 있으면 ' +
        '텔레그램이 웹훅을 해제한다. 전용 봇을 쓰거나 롱폴링을 멈출 것.');
      console.warn('[tg]   재등록: node ops/setup-telegram-webhook.js --apply');
    } else if (tgStat.webhookLastError) {
      console.warn(`[tg] ⚠ 웹훅 마지막 오류: ${tgStat.webhookLastError}`);
    }
  } catch (e) {
    console.warn('[tg] 웹훅 상태 확인 오류:', e.message);
  }
}

app.post('/api/telegram/webhook', async (req, res) => {
  const secret = process.env.WF_TELEGRAM_WEBHOOK_SECRET || '';
  if (!secret) {
    tgStat.rejectCount++; tgStat.lastRejectAt = new Date().toISOString();
    tgStat.lastRejectReason = 'no_secret_configured';
    console.warn('[tg] WF_TELEGRAM_WEBHOOK_SECRET 미설정 — 웹훅 거부');
    return res.sendStatus(403);
  }
  if (req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    tgStat.rejectCount++; tgStat.lastRejectAt = new Date().toISOString();
    // 헤더가 아예 없는 것과 값이 다른 것을 구분한다 —
    // 없으면 텔레그램이 아닌 곳에서 온 것이고, 다르면 secret 이 어긋난 것이다.
    tgStat.lastRejectReason = req.headers['x-telegram-bot-api-secret-token']
      ? 'secret_mismatch' : 'no_secret_header';
    console.warn(`[tg] 거부 (${tgStat.lastRejectReason}) — 누적 ${tgStat.rejectCount}회`);
    if (tgStat.lastRejectReason === 'secret_mismatch') {
      console.warn('[tg] ⚠ 텔레그램이 보낸 secret 이 서버 설정과 다르다. ' +
        'ops/setup-telegram-webhook.js --apply 로 재등록할 것');
    }
    return res.sendStatus(403);
  }
  tgStat.acceptCount++;
  // 텔레그램에는 항상 200을 빨리 돌려준다. 실패해도 재전송 폭주를 만들지 않는다.
  res.sendStatus(200);

  try {
    // 사용자가 봇에 보낸 텍스트 — 양방향 대화·트리거용
    if (req.body && req.body.message) {
      tgStat.messageCount++; tgStat.lastMessageAt = new Date().toISOString();
      await handleUserMessage(req.body.message);
      return;
    }

    const cq = req.body && req.body.callback_query;
    if (!cq) return;
    tgStat.callbackCount++; tgStat.lastCallbackAt = new Date().toISOString();

    const allowed = String(process.env.WF_TELEGRAM_CHAT_ID || '');
    const from = String(cq.message?.chat?.id ?? '');
    if (allowed && from !== allowed) {
      console.warn(`[tg] 허용되지 않은 채팅 ${from} — 무시`);
      await notify.answerCallback(cq.id, '권한이 없습니다', true);
      return;
    }

    // callback_data 형식: ap:<승인id>:<approved|rejected>
    const m = /^ap:(\d+):(approved|rejected)$/.exec(cq.data || '');
    if (!m) return;
    const [, id, decision] = m;
    const who = cq.from?.username ? '@' + cq.from.username : (cq.from?.first_name || 'user');

    const { rowCount } = await pool.query(
      `UPDATE wf_approvals SET decision=$1, approver=$2, decided_at=now()
       WHERE id=$3 AND decision='pending'`,
      [decision, who, id]
    );

    if (!rowCount) {
      // 이미 처리된 건 — 두 사람이 동시에 눌렀거나 중복 클릭
      const { rows } = await pool.query('SELECT decision, approver FROM wf_approvals WHERE id=$1', [id]);
      const cur = rows[0];
      await notify.answerCallback(cq.id,
        cur ? `이미 ${cur.decision === 'approved' ? '승인' : '거부'}됨 (${cur.approver || '-'})` : '없는 승인 건',
        true);
      return;
    }

    await notify.answerCallback(cq.id, decision === 'approved' ? '승인했습니다' : '거부했습니다');
    // 버튼을 없애고 결과를 남긴다 — 같은 건을 다시 누를 수 없도록
    await notify.resolveMessage(
      cq.message.chat.id, cq.message.message_id,
      cq.message.text ? notify.esc(cq.message.text) : '승인 요청',
      decision, who
    );
    console.log(`[tg] 승인 ${id} → ${decision} (${who})`);
  } catch (e) {
    console.warn('[tg] 웹훅 처리 오류:', e.message);
  }
});
app.get('/api/approvals', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM wf_approvals ORDER BY created_at DESC LIMIT 100');
    res.json({ success: true, approvals: rows });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 에이전트 지식 메모리 API (MCP 스타일 공유) ===
app.post('/api/knowledge', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { agent_id, wf_id, note, tags } = req.body || {};
    if (!note) return res.status(400).json({ success: false, error: 'note required' });
    const { rows } = await pool.query(
      `INSERT INTO wf_knowledge (agent_id, wf_id, note, tags) VALUES ($1,$2,$3,$4) RETURNING id`,
      [agent_id || '', wf_id || '', note, JSON.stringify(tags || [])]
    );
    res.json({ success: true, id: rows[0].id });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.get('/api/knowledge', async (req, res) => {
  try {
    const { agent } = req.query || {};
    const { rows } = agent
      ? await pool.query('SELECT * FROM wf_knowledge WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 50', [agent])
      : await pool.query('SELECT * FROM wf_knowledge ORDER BY created_at DESC LIMIT 100');
    res.json({ success: true, knowledge: rows });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 에이전트 성과 메트릭 API ===
app.get('/api/agent-metrics', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT wf_id, run_path, run_at FROM wf_runlogs ORDER BY run_at DESC LIMIT 500
    `);
    res.json({ success: true, runs: rows });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 추적/체크포인트/카드 API ===
app.get('/api/spans', async (req, res) => {
  try {
    const { trace } = req.query || {};
    const { rows } = trace
      ? await pool.query('SELECT * FROM agent_spans WHERE trace_id = $1 ORDER BY started_at ASC', [trace])
      : await pool.query('SELECT * FROM agent_spans ORDER BY started_at DESC LIMIT 100');
    res.json({ success: true, spans: rows });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.get('/api/checkpoints', async (req, res) => {
  try {
    const { session } = req.query || {};
    const { rows } = session
      ? await pool.query('SELECT * FROM agent_checkpoints WHERE session_id = $1 ORDER BY id DESC LIMIT 50', [session])
      : await pool.query('SELECT * FROM agent_checkpoints ORDER BY id DESC LIMIT 50');
    res.json({ success: true, checkpoints: rows });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.get('/api/cards', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM agent_cards ORDER BY updated_at DESC');
    res.json({ success: true, cards: rows });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 에이전트 세션/메시지 API ===
// 세션 생성 — 15개 팀 부트스트랩용
app.post('/api/sessions', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { agent_id, status, node_id } = req.body || {};
    if (!agent_id) return res.status(400).json({ success: false, error: 'agent_id required' });
    const sid = 'sess_' + Date.now().toString(36) + Math.floor(Math.random() * 100);
    const { rows } = await pool.query(
      `INSERT INTO agent_sessions (id, agent_id, node_id, status, workspace) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [sid, agent_id, node_id || '', status || 'idle', '/opt/data/agents/' + agent_id]
    );
    res.json({ success: true, session_id: rows[0].id });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.get('/api/sessions', async (req, res) => {
  try {
    const { wf } = req.query || {};
    const { rows } = wf
      ? await pool.query('SELECT * FROM agent_sessions WHERE wf_id = $1 ORDER BY created_at DESC', [wf])
      : await pool.query('SELECT * FROM agent_sessions ORDER BY created_at DESC LIMIT 50');
    res.json({ success: true, sessions: rows });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.get('/api/messages', async (req, res) => {
  try {
    const { session } = req.query || {};
    const { rows } = session
      ? await pool.query('SELECT * FROM agent_messages WHERE session_id = $1 ORDER BY id DESC LIMIT 100', [session])
      : await pool.query('SELECT * FROM agent_messages ORDER BY id DESC LIMIT 100');
    res.json({ success: true, messages: rows });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.post('/api/messages', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { msg_type, from_agent, to_agent, session_id, payload, status } = req.body || {};
    if (!from_agent || !to_agent) return res.status(400).json({ success: false, error: 'from/to required' });
    // 기본값은 'pending' 이어야 한다.
    // 이전에는 'sent' 로 넣었는데 agent.tasks.list_pending 은 'pending' 만 조회하므로,
    // 이 API 로 만든 메시지는 픽업 경로에서 영영 보이지 않았다 — 보내도 아무도 못 받는다.
    // 수신 대기 상태를 뜻하는 값은 'pending' 하나로 통일한다.
    const st = ['pending', 'sent', 'claimed', 'read', 'completed', 'cancelled'].includes(status)
      ? status : 'pending';
    const { rows } = await pool.query(
      `INSERT INTO agent_messages (msg_type, from_agent, to_agent, session_id, payload, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [msg_type || 'command', from_agent, to_agent, session_id || '', JSON.stringify(payload || {}), st]
    );
    res.json({ success: true, id: rows[0].id });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
// 세션 상태 갱신
app.put('/api/sessions/:id', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { status } = req.body || {};
    await pool.query('UPDATE agent_sessions SET status = $1, updated_at = now() WHERE id = $2', [status || 'idle', req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 에이전트 세션 정리 — 종료 세션 무한 누적 방지 ===
// 세션은 POST /api/sessions 로 계속 쌓이는데 삭제 경로가 전혀 없었다 (grep -c 0).
// GET 이 LIMIT 50 으로 가릴 뿐이라 DB 에는 끝없이 누적된다 (19→43→46).
// 여기서 종료(done/failed) 상태이고 N일(기본 7일) 지난 세션만 지운다.
// ACTIVE(running/working/waiting)와 idle 은 절대 손대지 않는다 — 진행 중 기록 소멸 방지.
// dry_run 기본 true: 실삭제는 승인 게이트(session.cleanup)를 거쳐 dry_run:false 로만.
app.post('/api/sessions/cleanup', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const days = Math.max(1, parseInt((req.body && req.body.days), 10) || 7);
    const dryRun = !(req.body && req.body.dry_run === false);
    if (dryRun) {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM agent_sessions
         WHERE status IN ('done','failed') AND created_at < now() - ($1 || ' days')::interval`, [days]);
      return res.json({ success: true, dry_run: true, days, delete_targets: rows[0].n,
        note: '실삭제는 승인 후 dry_run:false 로 호출' });
    }
    // 실삭제 — 승인 게이트 대상. audit_logs 에 남긴다.
    const { rowCount } = await pool.query(
      `DELETE FROM agent_sessions
       WHERE status IN ('done','failed') AND created_at < now() - ($1 || ' days')::interval`, [days]);
    await pool.query('INSERT INTO audit_logs (actor, resource, action, detail) VALUES ($1,$2,$3,$4)',
      [req.agent_id || 'api', 'agent_sessions', 'cleanup', JSON.stringify({ days, deleted: rowCount })]);
    res.json({ success: true, dry_run: false, days, deleted: rowCount });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 시크릿 볼트 — 자격증명 암호화 (AES-256-CTR) ===
const crypto2 = require('crypto');
const VAULT_KEY = process.env.WF_VAULT_KEY || 'wf-vault-local-key-2026';
function encryptSecret(plain) {
  const iv = crypto2.randomBytes(16);
  const cipher = crypto2.createCipheriv('aes-256-ctr', crypto2.createHash('sha256').update(VAULT_KEY).digest(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}

// === PII 레드액션 API — LLM 프롬프트 전 클라이언트가 호출 ===
app.post('/api/redact', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { text } = req.body || {};
    res.json({ success: true, redacted: redactPII(text), original_len: String(text || '').length });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 에이전트 신뢰 점수 API — 성공률/블로커 기반 ===
app.get('/api/trust', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.status, s.agent_id FROM agent_checkpoints c
       LEFT JOIN agent_sessions s ON c.session_id = s.id
       ORDER BY c.id DESC LIMIT 500`);
    const byAgent = {};
    rows.forEach(r => {
      const a = r.agent_id || 'unknown';
      if (!byAgent[a]) byAgent[a] = { total: 0, ok: 0 };
      byAgent[a].total++;
      if (r.status === 'done') byAgent[a].ok++;
    });
    const trust = Object.entries(byAgent).map(([agent, d]) => ({
      agent_id: agent,
      trust: d.total ? Math.round(d.ok / d.total * 100) : 50,
      runs: d.total,
    }));
    res.json({ success: true, trust });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 1. 에이전트 자격증명/권한 API ===
// GET 은 admin 에게도 키 원문을 보내지 않는다 — 발급 시 1회만 보여주는 것이 원칙.
// 볼트를 여는 코드를 없애 WF_VAULT_KEY 유출이 전체 키 유출이 되는 구조를 제거했다 (지시서 #38).
app.get('/api/credentials',
  requireScope(pool, 'mcp:admin', { allowAccessToken: true }),
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, agent_id, name, key_prefix, scopes, created_at,
                last_used_at, revoked_at, expires_at
           FROM agent_credentials ORDER BY id DESC`);
      res.json({ success: true, credentials: rows });
    } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
  });
// POST /api/credentials 는 제거했다 (2026-08-17, 지시서 #38).
// ON CONFLICT 대상 제약 부재로 항상 500 이었고, key_hash 를 쓰지 않아
// 설령 INSERT 돼도 그 키로는 인증이 되지 않았다.
// 발급은 credentials-api.js 의 POST /api/agents/:id/credentials 를 쓴다.

// === 2. 감사 로그 API ===
app.post('/api/audit', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { actor, agent_id, resource, action, detail } = req.body || {};
    await pool.query(
      `INSERT INTO audit_logs (actor, agent_id, resource, action, detail) VALUES ($1,$2,$3,$4,$5)`,
      [actor || 'user', agent_id || '', maskAudit(resource || ''), action || '', maskAudit(detail || '')]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.get('/api/audit', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100');
    res.json({ success: true, logs: rows });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 3. 템플릿 마켓 API ===
app.get('/api/templates', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, description, category, tags, installs, rating FROM wf_templates ORDER BY installs DESC');
    res.json({ success: true, templates: rows });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.post('/api/templates', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { id, name, description, category, tags, data } = req.body || {};
    if (!id || !name) return res.status(400).json({ success: false, error: 'id/name required' });
    await pool.query(
      `INSERT INTO wf_templates (id, name, description, category, tags, data)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
         category=EXCLUDED.category, tags=EXCLUDED.tags, data=EXCLUDED.data`,
      [id, name, description || '', category || '', JSON.stringify(tags || []), JSON.stringify(data || {})]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.post('/api/templates/:id/install', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    await pool.query('UPDATE wf_templates SET installs = installs + 1 WHERE id = $1', [req.params.id]);
    const { rows } = await pool.query('SELECT data FROM wf_templates WHERE id = $1', [req.params.id]);
    res.json({ success: true, data: rows[0] ? rows[0].data : null });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 4. LLM semantic cache API ===
app.post('/api/cache/get', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { prompt, model } = req.body || {};
    if (!prompt) return res.json({ success: true, hit: false });
    const hash = require('crypto').createHash('sha256').update(prompt + (model || '')).digest('hex').slice(0, 16);
    const { rows } = await pool.query(
      'SELECT response FROM llm_cache WHERE prompt_hash = $1 ORDER BY id DESC LIMIT 1', [hash]);
    res.json({ success: true, hit: rows.length > 0, response: rows[0] ? rows[0].response : null, hash });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.post('/api/cache/put', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { prompt, model, response } = req.body || {};
    const hash = require('crypto').createHash('sha256').update(prompt + (model || '')).digest('hex').slice(0, 16);
    await pool.query(
      `INSERT INTO llm_cache (prompt_hash, prompt, response, model) VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING`, [hash, prompt || '', response || '', model || '']);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 1. 활동 이벤트 피드 API ===
app.get('/api/events', async (req, res) => {
  try {
    const { type } = req.query || {};
    const { rows } = type
      ? await pool.query('SELECT * FROM audit_logs WHERE action = $1 ORDER BY id DESC LIMIT 100', [type])
      : await pool.query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100');
    res.json({ success: true, events: rows });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 2. 텔레그램 알림 — 실행 실패/블로커 시 전송 ===
// (텔레그램 노드 액션 확장: action === 'telegram-alert' 시 실패만 전송)
// 실행 결과 저장 시 실패면 audit에 기록 (기존) + 클라이언트가 WS로 알림

// === 3. 신뢰도/자율성: ai/decide 응답에 confidence 포함 ===
// /api/ai/decide 중복(죽은) 정의 제거됨 — #44 P2-E.
// Express 는 첫 등록(위 527줄대)만 탄다. 이 아래 정의는 도달 불가였고,
// 게다가 getNousAuth 가 반환하지 않는 필드(inference_base_url/access_token)를 써서
// 실행됐어도 깨졌을 코드였다. 유효 정의는 위 하나뿐.

// === 워크플로우 테스트 스위트 API ===
app.get('/api/tests', async (req, res) => {
  try {
    const { wf } = req.query || {};
    const { rows } = wf
      ? await pool.query('SELECT * FROM wf_tests WHERE wf_id = $1 ORDER BY id DESC', [wf])
      : await pool.query('SELECT * FROM wf_tests ORDER BY id DESC LIMIT 100');
    res.json({ success: true, tests: rows });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.post('/api/tests', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { wf_id, name, input, expected } = req.body || {};
    if (!wf_id || !name) return res.status(400).json({ success: false, error: 'wf_id/name required' });
    const { rows } = await pool.query(
      `INSERT INTO wf_tests (wf_id, name, input, expected) VALUES ($1,$2,$3,$4) RETURNING id`,
      [wf_id, name, JSON.stringify(input || {}), JSON.stringify(expected || {})]
    );
    res.json({ success: true, id: rows[0].id });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
// 회귀 게이트 — 테스트 실행 후 결과 기록
app.post('/api/tests/:id/result', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { status } = req.body || {};
    await pool.query(
      'UPDATE wf_tests SET last_status = $1, last_run_at = now() WHERE id = $2',
      [status || 'pending', req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.delete('/api/tests/:id', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    await pool.query('DELETE FROM wf_tests WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 워크플로우 스케줄/트리거 API ===
app.post('/api/workflows/:id/schedule', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { cron, trigger_type } = req.body || {};
    await pool.query('UPDATE wf_workflows SET schedule = $1, trigger_type = $2 WHERE id = $3',
      [cron || '', trigger_type || 'manual', req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
// 자연어 → cron 변환 (간단 파서)
app.post('/api/schedule/parse', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { text } = req.body || {};
    const t = String(text || '').trim().toLowerCase();
    let cron = '';
    if (/매일|daily|every day/.test(t)) cron = '0 9 * * *';
    else if (/매시|every hour/.test(t)) cron = '0 * * * *';
    else if (/매주|weekly/.test(t)) cron = '0 9 * * 1';
    else if (/매월|monthly/.test(t)) cron = '0 9 1 * *';
    else if (/분마다|every .*min/.test(t)) { const m = t.match(/(\d+)\s*분/); cron = '*/' + (m ? m[1] : 5) + ' * * * *'; }
    if (!cron) return res.json({ success: false, error: '인식 실패 — 예: 매일 9시, 매시, 매주' });
    res.json({ success: true, cron });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
// 파일 감지 트리거 — 워크스페이스 새 파일 확인 (간단: 최근 파일 목록)
app.post('/api/workflows/:id/run', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { trigger } = req.body || {};
    const { rows } = await pool.query('SELECT id FROM wf_workflows WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'not found' });
    // 실행 요청 기록 (오케스트레이터 실행은 클라이언트가)
    await pool.query('INSERT INTO audit_logs (actor, resource, action, detail) VALUES ($1,$2,$3,$4)',
      ['system', req.params.id, 'run', 'trigger: ' + (trigger || 'manual')]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 워크플로우 실행 REST API — 외부에서 실행 (헤드리스) ===
app.post('/api/workflows/:id/execute', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, data FROM wf_workflows WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'not found' });
    const wf = rows[0];
    // 실행 직전이므로 엄격 모드 — data 가 깨졌는데 빈 객체로 진행하면
    // 노드 0개짜리 실행을 '성공'으로 보고하게 된다.
    const data = parseJsonbStrict(wf.data, { label: 'wf_workflows.data', id: wf.id });
    const nodes = data.nodes || [], edges = data.edges || [];
    // 간단 실행 시뮬레이션 — 시작→연결 추적
    const start = nodes.find(n => n.type === 'start');
    const path = [];
    let cur = start ? start.id : (nodes[0] ? nodes[0].id : null);
    const visited = new Set();
    let steps = 0, llm = 0;
    while (cur && steps < 100 && !visited.has(cur)) {
      visited.add(cur);
      const n = nodes.find(x => x.id === cur);
      if (!n) break;
      path.push(n.label || n.type);
      if (n.type === 'decision') llm++;
      steps++;
      const next = edges.find(e => e.from === cur);
      cur = next ? next.to : null;
    }
    const elapsed = 0.05 + Math.random() * 0.5;
    // 실행 로그 기록
    await pool.query(
      `INSERT INTO wf_runlogs (wf_id, run_path, run_at, status) VALUES ($1,$2,now(),'success')`,
      [wf.id, path.join(' → ')]
    );
    res.json({
      success: true,
      workflow: wf.name,
      path: path.join(' → '),
      steps: steps,
      llm_decisions: llm,
      elapsed_s: Number(elapsed.toFixed(2)),
      ts: new Date().toISOString(),
    });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 체크포인트 재개 API — 중단된 실행 이어서 ===
app.post('/api/workflows/:id/resume', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM agent_checkpoints WHERE wf_id = $1 AND status = $2 ORDER BY id DESC LIMIT 1',
      [req.params.id, 'running']
    );
    if (!rows.length) return res.json({ success: false, error: '재개할 체크포인트 없음' });
    const cp = rows[0];
    await pool.query("UPDATE agent_checkpoints SET status = 'resumed' WHERE id = $1", [cp.id]);
    res.json({ success: true, resumed_from: cp.node_id, session: cp.session_id, at: cp.created_at });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 실행 요약 리포트 API — 최근 실행 통계 ===
app.get('/api/report', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT wf_id, run_path, run_at, status FROM wf_runlogs ORDER BY run_at DESC LIMIT 20`
    );
    const total = await pool.query('SELECT count(*) FROM wf_runlogs');
    const success = await pool.query("SELECT count(*) FROM wf_runlogs WHERE status = 'success'");
    res.json({
      success: true,
      report: {
        total: parseInt(total.rows[0].count),
        success: parseInt(success.rows[0].count),
        rate: rows.length ? Math.round(parseInt(success.rows[0].count) / Math.max(1, parseInt(total.rows[0].count)) * 100) : 0,
        recent: rows,
      },
    });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 헬스체크 API ===
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', uptime: process.uptime(), ts: new Date().toISOString() });
});

// === 예시 워크플로우 — 내장 템플릿 3종 ===
const EXAMPLE_WFS = [
  {
    id: 'ex_content', name: '콘텐츠 제작 (아이디어→배포)',
    nodes: [
      { id: 'e1', type: 'start', x: 40, y: 180, label: '시작', desc: '', assignee: '', due: '', tags: [] },
      { id: 'e2', type: 'process', x: 220, y: 180, label: '아이디어 수집', desc: '주제/키워드 정리', assignee: '', due: '', tags: ['기획'] },
      { id: 'e3', type: 'process', x: 400, y: 180, label: '초안 작성', desc: 'LLM으로 초안 생성', assignee: '', due: '', tags: ['작성'] },
      { id: 'e4', type: 'reviewer', x: 580, y: 180, label: '검수', desc: '품질/오류 검증', assignee: '', due: '', tags: ['검토'] },
      { id: 'e5', type: 'decision', x: 760, y: 180, label: '승인 여부', desc: '검수 통과?', assignee: '', due: '', tags: [], llm_prompt: '이 초안이 배포 가능한 품질인가?' },
      { id: 'e6', type: 'process', x: 940, y: 180, label: '배포', desc: '게시/전송', assignee: '', due: '', tags: ['배포'] },
      { id: 'e7', type: 'end', x: 1120, y: 180, label: '종료', desc: '', assignee: '', due: '', tags: [] },
    ],
    edges: [
      { id: 'x1', from: 'e1', to: 'e2', label: '' }, { id: 'x2', from: 'e2', to: 'e3', label: '' },
      { id: 'x3', from: 'e3', to: 'e4', label: '' }, { id: 'x4', from: 'e4', to: 'e5', label: '' },
      { id: 'x5', from: 'e5', to: 'e6', label: 'Yes' }, { id: 'x6', from: 'e5', to: 'e3', label: 'No' },
      { id: 'x7', from: 'e6', to: 'e7', label: '' },
    ],
  },
  {
    id: 'ex_data', name: '데이터 처리 (CSV→가공→저장)',
    nodes: [
      { id: 'd1', type: 'start', x: 40, y: 150, label: '시작', desc: '', assignee: '', due: '', tags: [] },
      { id: 'd2', type: 'connector', x: 220, y: 150, label: 'CSV 입력', desc: '데이터 수집', assignee: '', due: '', tags: [], connector_type: 'csv', connector_config: { text: '이름,점수\n홍길동,95\n김철수,88' } },
      { id: 'd3', type: 'process', x: 400, y: 150, label: '가공', desc: '정제/변환', assignee: '', due: '', tags: [] },
      { id: 'd4', type: 'decision', x: 580, y: 150, label: '품질 확인', desc: '데이터 유효?', assignee: '', due: '', tags: [], condition: 'score > 0' },
      { id: 'd5', type: 'process', x: 760, y: 150, label: 'DB 저장', desc: '결과 저장', assignee: '', due: '', tags: [] },
      { id: 'd6', type: 'end', x: 940, y: 150, label: '종료', desc: '', assignee: '', due: '', tags: [] },
    ],
    edges: [
      { id: 'y1', from: 'd1', to: 'd2', label: '' }, { id: 'y2', from: 'd2', to: 'd3', label: '' },
      { id: 'y3', from: 'd3', to: 'd4', label: '' }, { id: 'y4', from: 'd4', to: 'd5', label: 'Yes' },
      { id: 'y5', from: 'd4', to: 'd3', label: 'No' }, { id: 'y6', from: 'd5', to: 'd6', label: '' },
    ],
  },
  {
    id: 'ex_approval', name: '승인 프로세스 (요청→승인→처리)',
    nodes: [
      { id: 'a1', type: 'start', x: 40, y: 150, label: '시작', desc: '', assignee: '', due: '', tags: [] },
      { id: 'a2', type: 'process', x: 220, y: 150, label: '요청 접수', desc: '요청 등록', assignee: '', due: '', tags: [] },
      { id: 'a3', type: 'approval', x: 400, y: 150, label: '승인 게이트', desc: '관리자 확인', assignee: '', due: '', tags: [] },
      { id: 'a4', type: 'process', x: 580, y: 150, label: '처리', desc: '요청 이행', assignee: '', due: '', tags: [] },
      { id: 'a5', type: 'end', x: 760, y: 150, label: '종료', desc: '', assignee: '', due: '', tags: [] },
    ],
    edges: [
      { id: 'z1', from: 'a1', to: 'a2', label: '' }, { id: 'z2', from: 'a2', to: 'a3', label: '' },
      { id: 'z3', from: 'a3', to: 'a4', label: 'Yes' }, { id: 'z4', from: 'a3', to: 'a2', label: 'No' },
      { id: 'z5', from: 'a4', to: 'a5', label: '' },
    ],
  },
];
app.get('/api/examples', (req, res) => res.json({ success: true, examples: EXAMPLE_WFS }));
app.post('/api/examples/install', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { id } = req.body || {};
    const ex = EXAMPLE_WFS.find(w => w.id === id);
    if (!ex) return res.status(404).json({ success: false, error: '없음' });
    await pool.query(
      `INSERT INTO wf_workflows (id, name, data) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, data=EXCLUDED.data, updated_at=now()`,
      [ex.id, ex.name, JSON.stringify({ nodes: ex.nodes, edges: ex.edges })]
    );
    res.json({ success: true, workflow: ex });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === SSRF 방지 — 내부 IP 차단 ===
function isInternalHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  // IPv4 내부 범위
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [parseInt(m[1]), parseInt(m[2])];
    if (a === 127 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0 || a === 169 && b === 254) return true;
  }
  return false;
}

// === 속도 제한 — IP당 분당 N회 ===
const rateBuckets = new Map();
function rateLimit(key, max = 60, windowMs = 60000) {
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, reset: now + windowMs };
  if (now > bucket.reset) { bucket.count = 0; bucket.reset = now + windowMs; }
  bucket.count++;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 1000) rateBuckets.clear();  // 메모리 보호
  return bucket.count <= max;
}

// === 데이터 커넥터 API — CSV/JSON/API/DB 입력 ===
app.post('/api/connector', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    if (!rateLimit(req.ip || 'connector')) return res.status(429).json({ success: false, error: 'rate limited' });
    const { type, config } = req.body || {};
    const out = { success: true, data: null, meta: {} };
    if (type === 'csv') {
      // CSV 텍스트 → JSON 배열
      const csv = String(config && config.text || '');
      if (!csv.trim()) return res.json({ success: false, error: 'CSV 없음' });
      const lines = csv.split(/\r?\n/).filter(l => l.trim());
      const headers = lines[0].split(',').map(h => h.trim());
      out.data = lines.slice(1).map(l => {
        const cells = l.split(',').map(c => c.trim());
        const row = {};
        headers.forEach((h, i) => row[h] = cells[i] || '');
        return row;
      });
      out.meta.count = out.data.length;
    } else if (type === 'json') {
      const txt = String(config && config.text || '');
      try { out.data = JSON.parse(txt); } catch (e) { return res.json({ success: false, error: 'JSON 파싱 실패' }); }
      out.meta.count = Array.isArray(out.data) ? out.data.length : 1;
    } else if (type === 'api') {
      const url = String(config && config.url || '');
      if (!url) return res.json({ success: false, error: 'URL 없음' });
      // SSRF 방지 — 내부 주소 차단
      try {
        const u = new URL(url);
        if (isInternalHost(u.hostname)) return res.json({ success: false, error: '내부 주소 차단 (SSRF 방지)' });
      } catch (e) { return res.json({ success: false, error: 'URL 형식 오류' }); }
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const text = await r.text();
      try {
        out.data = JSON.parse(text);
      } catch (e) {
        // JSON이 아니면 텍스트로 저장 (HTML 등)
        out.data = { text: text.slice(0, 2000) };
        out.meta.non_json = true;
      }
      out.meta.status = r.status;
    } else if (type === 'db') {
      const q = String(config && config.query || '');
      if (!q) return res.json({ success: false, error: '쿼리 없음' });
      const { rows } = await pool.query(q);
      out.data = rows;
      out.meta.count = rows.length;
    } else {
      return res.json({ success: false, error: '지원 타입: csv/json/api/db' });
    }
    res.json(out);
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 다중 모델 라우팅 — 모델별 가격/품질 테이블 ===
const MODEL_ROUTES = {
  'auto':    { desc: '자동', providers: ['nous'] },
  'cheap':   { desc: '저비용', model: 'deepseek/deepseek-v4-flash-0731', max_tokens: 50 },
  'smart':   { desc: '고성능', model: 'deepseek/deepseek-v4-flash-0731', max_tokens: 200 },
};
app.get('/api/model-routes', (req, res) => res.json({ success: true, routes: MODEL_ROUTES }));

// === 결과 피드백 루프 — 실행 결과를 지식으로 저장 ===
app.post('/api/feedback', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { wf_id, node_id, summary, status } = req.body || {};
    if (!wf_id || !summary) return res.json({ success: false, error: 'wf_id/summary 필요' });
    await pool.query(
      `INSERT INTO wf_knowledge (wf_id, note, tags) VALUES ($1,$2,'["feedback"]')`,
      [wf_id, '[실행' + (status || '') + '] ' + String(summary).slice(0, 500)]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === Kimi LLM 워커 — ag_deepseek 에이전트 실행 (기본: moonshotai/kimi-k3) ===
// 규칙: 명령 수신 → LLM 호출(WF_LLM_WORKER_MODEL) → 결과 report (trace_id 유지)
// 인증 필수 — 이 라우트는 외부 LLM 을 호출해 실제 비용을 발생시킨다.
// 무인증이면 URL 을 아는 누구나 사용자의 크레딧으로 LLM 을 쓸 수 있고,
// system 프롬프트까지 지정할 수 있어 사실상 공개 LLM 프록시가 된다.
app.post('/api/llm/worker', requireScope(pool, 'mcp:execute', { allowAccessToken: true }), async (req, res) => {
  try {
    // 인증된 호출자라도 폭주는 막는다 — 비용이 나가는 경로다
    if (!rateLimit('llm:' + (req.agent_id || req.ip || 'anon'), 20)) {
      return res.status(429).json({ success: false, error: 'rate limited', detail: '분당 20회' });
    }
    const { prompt, agent_id, trace_id, system, report_to, max_tokens } = req.body || {};
    // 800 고정이었다. 코드 리뷰 12건 중 7건이 답을 쓰다 잘렸고,
    // 잘렸다는 사실이 응답에 없어서 받는 쪽은 그게 완성된 답인 줄 알았다.
    // 호출자가 필요한 만큼 올릴 수 있게 하되 상한은 둔다 — 비용이 나가는 경로다.
    const maxTokens = Math.min(Math.max(Number(max_tokens) || 1500, 100), 4000);

    // 어떤 모델이 답했는지 응답에 실는다.
    // agents 테이블의 이름·역할을 바꿔도 이 라우트가 부르는 모델은 안 바뀐다.
    // 실제로 ag_deepseek 을 "Kimi 워커"로 고쳐놓고도 라우트는 그대로였고,
    // 응답에 모델명이 없어서 밖에서는 확인할 방법이 없었다.
    // 오늘 모델명 오타로 하루 종일 404 가 났던 것도 같은 사각지대였다.
    const workerModel = process.env.WF_LLM_WORKER_MODEL || 'deepseek/deepseek-v4-flash-0731';
    if (!prompt) return res.status(400).json({ success: false, error: 'prompt required' });
    const nous = getNousAuth();
    if (!nous) return res.status(500).json({ success: false, error: 'Nous auth 없음' });
    const r = await fetch(nous.base + '/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(60000),   // 응답 없는 호출이 요청을 물고 있지 않도록
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + nous.token },
      body: JSON.stringify({
        model: workerModel,
        messages: [
          { role: 'system', content: system || '당신은 커멘드센터의 Kimi 워커입니다. 요청을 분석·요약·리뷰하고 간결한 한국어로 답하세요. trace_id가 있으면 보고에 포함하세요.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: maxTokens
      })
    });
    const j = await r.json();
    const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;

    // 실패를 성공으로 포장하지 않는다.
    // 예전엔 `|| JSON.stringify(j)` 로 넘어가서, 제공자가 404 를 줘도 그 오류 JSON 이
    // 그대로 "결과"가 되고 success:true 로 응답했다. 그래서 모델명이 잘못 바뀐 뒤로
    // 모든 호출이 실패하는데도 아무도 몰랐다 (2026-08-16, 6곳 오타로 하루 종일 404).
    // 워커 결과를 믿고 쓰는 쪽에서는 이게 가장 위험한 실패 방식이다.
    if (!r.ok || !text) {
      const detail = (j.error && (j.error.message || j.error)) || j.message || JSON.stringify(j).slice(0, 300);
      console.error(`[llm] 워커 호출 실패 (HTTP ${r.status}): ${detail}`);
      if (agent_id) {
        const to = report_to || req.agent_id || 'ag_orch';
        await pool.query(
          `INSERT INTO agent_messages (msg_type, from_agent, to_agent, payload, status, trace_id)
           VALUES ('report', $1, $2, $3, 'pending', $4)`,
          [agent_id, to, JSON.stringify({ ok: false, error: detail }), trace_id || '']
        );
      }
      return res.status(502).json({ success: false, error: 'llm_failed', detail, model: workerModel, trace_id: trace_id || '' });
    }

    // 보고 기록.
    // 예전엔 받는 쪽이 'ag_orch' 로 박혀 있고 status 가 'sent' 였다. 둘 다 문제였다 —
    // 지시한 쪽과 받는 쪽이 다르고, list_pending 은 'pending' 만 조회하므로
    // 워커 결과가 큐에서 아무에게도 보이지 않았다. (POST /api/messages 와 같은 사고)
    // 기본 수신자는 이 호출을 한 에이전트다. 시킨 사람이 결과를 받는 게 맞다.
    // 답을 쓰다 잘렸는지 알린다.
    // 잘린 답은 틀린 답보다 위험하다 — 문장이 중간에 끊겼을 뿐 앞부분은 그럴듯해서
    // 받는 쪽이 완성된 결론으로 읽는다. 실제로 리뷰 12건 중 7건이 이렇게 잘렸는데
    // 응답만 봐서는 알 수 없었다.
    const truncated = j.choices && j.choices[0] && j.choices[0].finish_reason === 'length';
    if (truncated) console.warn(`[llm] 응답이 max_tokens(${maxTokens})에서 잘렸다 — trace=${trace_id || '-'}`);

    if (agent_id) {
      const to = report_to || req.agent_id || 'ag_orch';
      await pool.query(
        `INSERT INTO agent_messages (msg_type, from_agent, to_agent, payload, status, trace_id)
         VALUES ('report', $1, $2, $3, 'pending', $4)`,
        [agent_id, to, JSON.stringify({ result: text, ok: !truncated, truncated }), trace_id || '']
      );
    }
    res.json({
      success: true, agent_id: agent_id || 'ag_deepseek', result: text,
      model: workerModel, truncated, max_tokens: maxTokens, trace_id: trace_id || '',
    });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 웹 리서치 워커 — tool-loop 엔드포인트 (지시서 #46) ===
// LLM 이 web_search/web_fetch 를 tool_call 로 호출하며 실제 웹 조회로 리서치한다.
// 기존 /api/llm/worker 는 건드리지 않는다 — 이 엔드포인트는 신규 추가만.
//
// 보안: SSRF 방어(사설망·클라우드 메타데이터 차단, 리다이렉트 매 홉 재검사),
//       used_sources 감사(출처 없는 합성 답은 반려), 무한루프·폭주 가드레일.

const RESEARCH_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const FETCH_TEXT_LIMIT = 20000;   // fetch 본문 truncate (20KB)
const FETCH_COUNT_LIMIT = 8;      // 세션당 fetch 개수 상한
const RESEARCH_TIMEOUT_MS = 90000; // 총 타임아웃

// insane-search 엔진 호출 경로 — 배치 /opt/data/engine (모듈명 `engine`), venv /opt/data/engine-venv.
const ENGINE_PYTHON = process.env.WF_ENGINE_PYTHON || '/opt/data/engine-venv/bin/python';
const ENGINE_CWD = process.env.WF_ENGINE_DIR || '/opt/data';
const ENGINE_TIMEOUT_MS = 30000;   // 엔진 단일 fetch 상한 (curl grid + 폴백 없이 --no-playwright)

// 리다이렉트도 매 홉 SSRF 재검사하며 따라간다. 마지막 홉의 { ok, status, text } 또는 { error }.
async function fetchWithRedirectGuard(url, { timeoutMs = 15000, maxHops = 4 } = {}) {
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    const v = await validateWebUrl(current);
    if (v.error) return { ok: false, error: v.error };
    let r;
    try {
      r = await fetch(v.url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': RESEARCH_UA, 'Accept': 'text/html,application/xhtml+xml,text/plain,*/*' },
      });
    } catch (e) {
      return { ok: false, error: 'fetch 실패: ' + (e.name === 'TimeoutError' ? 'timeout' : e.message) };
    }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return { ok: false, error: '리다이렉트지만 Location 없음' };
      try { current = new URL(loc, v.url).toString(); } catch (e) { return { ok: false, error: '리다이렉트 URL 오류' }; }
      continue;
    }
    const text = await r.text().catch(() => '');
    return { ok: r.ok, status: r.status, text };
  }
  return { ok: false, error: '리다이렉트 상한(' + maxHops + ') 초과' };
}

// insane-search 엔진 가용 여부 — 매 fetch 마다 spawn 실패를 반복하지 않도록 캐시.
let engineAvailable = null;
async function checkEngine() {
  if (engineAvailable !== null) return engineAvailable;
  try {
    await execFileAsync(ENGINE_PYTHON, ['-m', 'engine', '--help'], { cwd: ENGINE_CWD, timeout: 5000 });
    engineAvailable = true;
  } catch (e) { engineAvailable = false; }
  return engineAvailable;
}

// web_fetch 백엔드 — 엔진(insane-search) 우선, Jina Reader 폴백.
// SSRF: 엔진 호출 전 validateWebUrl 로 1차 검증 + 엔진이 내부에서 리다이렉트를 따라갔을 수
// 있으므로 반환된 최종 URL(final_url)을 재검증해 매-홉 우회를 막는다.
async function webFetchBackend(url) {
  const v = await validateWebUrl(url);
  if (v.error) return { ok: false, error: v.error };

  // 엔진 우선 — curl-only(--no-playwright)로 빠르게. 본문 있으면 채택, 없으면 Jina 폴백.
  if (await checkEngine()) {
    try {
      const { stdout } = await execFileAsync(
        ENGINE_PYTHON, ['-m', 'engine', v.url, '--json', '--no-playwright'],
        { cwd: ENGINE_CWD, timeout: ENGINE_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' }
      );
      const j = JSON.parse(String(stdout || '{}'));
      // SSRF: 엔진이 리다이렉트를 따라간 최종 URL 재검증 (함정2 — 엔진 내부 리다이렉트 우회 차단).
      if (j.final_url) {
        const fv = await validateWebUrl(j.final_url);
        if (fv.error) return { ok: false, error: '엔진 최종 URL SSRF 차단: ' + fv.error };
      }
      const text = String(j.content || '').slice(0, FETCH_TEXT_LIMIT);
      if (text.trim()) {
        return { ok: true, text, bytes: Buffer.byteLength(text), backend: 'engine', final_url: j.final_url };
      }
      console.warn('[research] engine 본문 없음, Jina 폴백');
    } catch (e) {
      console.warn('[research] engine fetch 실패, Jina 폴백:', e.message);
    }
  }

  // Jina Reader (URL → 마크다운, 키 불필요)
  const r = await fetchWithRedirectGuard('https://r.jina.ai/' + v.url, { timeoutMs: 30000, maxHops: 4 });
  if (r.error) return { ok: false, error: r.error };
  if (!r.ok) return { ok: false, error: 'Jina HTTP ' + r.status, status: r.status };
  const text = (r.text || '').slice(0, FETCH_TEXT_LIMIT);
  return { ok: true, text, bytes: Buffer.byteLength(text), backend: 'jina' };
}

// web_search 백엔드 — (b) DuckDuckGo HTML (키 0, 취약하나 동작). 링크·제목 파싱.
function parseDdgResults(html, max) {
  const out = [];
  const re = /class="result__a"[^>]*href="[^"]*uddg=([^"&]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < max) {
    let url;
    try { url = decodeURIComponent(m[1]); } catch (e) { url = m[1]; }
    const title = m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
    if (url) out.push({ title, url });
  }
  return out;
}
async function webSearchBackend(query) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: 'query 없음' };
  const ddgUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
  const r = await fetchWithRedirectGuard(ddgUrl, { timeoutMs: 20000, maxHops: 4 });
  if (r.error) return { ok: false, error: r.error };
  if (!r.ok) return { ok: false, error: 'DDG HTTP ' + r.status, status: r.status };
  const results = parseDdgResults(r.text, 5);
  return { ok: true, results, count: results.length };
}

const RESEARCH_SYSTEM = `당신은 웹 리서치 도우미입니다. 사용자의 질문에 정확히 답하기 위해 도구를 활용하세요.
- web_search(query): 웹 검색으로 관련 출처(제목+URL)를 찾습니다.
- web_fetch(url): 특정 URL 의 본문을 가져옵니다.

규칙:
1. 답은 반드시 실제로 조회한 출처에 근거하세요. 출처 없이 추측하거나 내부 지식만으로 단정하지 마세요.
2. 중요한 주장에는 출처 URL 을 함께 명시하세요.
3. 조회 결과가 불충분하면 추가 검색·조회를 이어가세요.
4. 한국어로 답하세요.`;

const RESEARCH_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '웹에서 질의를 검색해 관련 출처 목록(제목+URL)을 반환한다.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '검색 질의' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: '지정한 URL 의 본문(마크다운/텍스트)을 가져온다. http/https 공개 URL 만 허용.',
      parameters: { type: 'object', properties: { url: { type: 'string', description: '가져올 URL' } }, required: ['url'] },
    },
  },
];

app.post('/api/llm/research', requireScope(pool, 'mcp:execute', { allowAccessToken: true }), async (req, res) => {
  try {
    // 인증된 호출자라도 폭주는 막는다 — 외부 LLM + 네트워크 비용이 나가는 경로.
    if (!rateLimit('research:' + (req.agent_id || req.ip || 'anon'), 10)) {
      return res.status(429).json({ success: false, error: 'rate limited', detail: '분당 10회' });
    }
    const { prompt, model, agent_id, trace_id, report_to, max_iters } = req.body || {};
    if (!prompt) return res.status(400).json({ success: false, error: 'prompt required' });

    const modelName = model || process.env.WF_LLM_RESEARCH_MODEL || process.env.WF_LLM_WORKER_MODEL || 'moonshotai/kimi-k3';
    const maxIters = Math.min(Math.max(Number(max_iters) || 5, 1), 10); // 무한루프 방지

    const nous = getNousAuth();
    if (!nous) return res.status(500).json({ success: false, error: 'Nous auth 없음' });

    const used_sources = [];
    let fetchCount = 0;

    const messages = [
      { role: 'system', content: RESEARCH_SYSTEM },
      { role: 'user', content: prompt },
    ];

    let finalAnswer = null;
    let iterations = 0;

    for (let i = 0; i < maxIters; i++) {
      iterations = i + 1;
      const r = await fetch(nous.base + '/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(RESEARCH_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + nous.token },
        body: JSON.stringify({ model: modelName, messages, tools: RESEARCH_TOOLS, max_tokens: 3000 }),
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => '').then(t => t.slice(0, 300));
        console.error(`[research] LLM 호출 실패 (HTTP ${r.status}): ${detail}`);
        return res.status(502).json({ success: false, error: 'llm_failed', detail, model: modelName, trace_id: trace_id || '' });
      }
      const j = await r.json();
      const msg = j.choices && j.choices[0] && j.choices[0].message;
      if (!msg) return res.status(502).json({ success: false, error: 'llm_failed', detail: '빈 응답', model: modelName, trace_id: trace_id || '' });

      const toolCalls = msg.tool_calls && msg.tool_calls.length ? msg.tool_calls : null;
      if (!toolCalls) { finalAnswer = msg.content || ''; break; }

      // tool_calls 실행 → role:'tool' 메시지로 append
      messages.push({ role: 'assistant', content: msg.content || null, tool_calls: toolCalls });
      for (const tc of toolCalls) {
        const fn = tc.function || {};
        let args = {};
        try { args = JSON.parse(fn.arguments || '{}'); } catch (e) { args = {}; }
        let resultText;

        if (fn.name === 'web_fetch') {
          if (fetchCount >= FETCH_COUNT_LIMIT) {
            resultText = JSON.stringify({ error: 'fetch 상한 초과(' + FETCH_COUNT_LIMIT + ')' });
            used_sources.push({ type: 'fetch', url: args.url, ok: false, error: 'limit' });
          } else {
            fetchCount++;
            const out = await webFetchBackend(args.url);
            used_sources.push({ type: 'fetch', url: args.url, ok: out.ok, bytes: out.bytes, backend: out.backend, error: out.error });
            resultText = out.ok ? out.text : JSON.stringify({ error: out.error });
          }
        } else if (fn.name === 'web_search') {
          const out = await webSearchBackend(args.query);
          used_sources.push({ type: 'search', query: args.query, ok: out.ok, count: out.count, error: out.error });
          resultText = out.ok ? JSON.stringify(out.results) : JSON.stringify({ error: out.error });
        } else {
          resultText = JSON.stringify({ error: '알 수 없는 도구: ' + fn.name });
          used_sources.push({ type: 'unknown', name: fn.name, ok: false, error: 'unknown_tool' });
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: String(resultText).slice(0, FETCH_TEXT_LIMIT) });
      }
    }

    if (finalAnswer === null) finalAnswer = '(max_iters 도달 — 도구 호출이 계속됨)';

    // 감사성 게이트: 출처 없이 합성된 답은 검증 불가 = 실패로 친다.
    const noSources = used_sources.length === 0;
    const success = !noSources;

    if (agent_id) {
      const to = report_to || req.agent_id || 'ag_orch';
      try {
        await pool.query(
          `INSERT INTO agent_messages (msg_type, from_agent, to_agent, payload, status, trace_id)
           VALUES ('report', $1, $2, $3, 'pending', $4)`,
          [agent_id, to, JSON.stringify({ result: finalAnswer, used_sources, ok: success }), trace_id || '']
        );
      } catch (e) { console.warn('[research] report 기록 실패:', e.message); }
    }

    res.json({
      success,
      error: noSources ? 'no_sources_used (검증 불가 — 출처 없이 합성)' : undefined,
      result: finalAnswer,
      used_sources,
      iterations,
      model: modelName,
      trace_id: trace_id || '',
    });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === LLM 프록시 — 워크플로우 생성 ===
const WF_SCHEMA_EXAMPLE = `{
  "nodes": [
    {"id":"n_s","type":"start","x":60,"y":80,"label":"시작","desc":"","assignee":"","due":"","tags":[]},
    {"id":"n_1","type":"process","x":60,"y":220,"label":"단계명","desc":"","assignee":"","due":"","tags":[]},
    {"id":"n_d","type":"decision","x":60,"y":360,"label":"판단","desc":"","assignee":"","due":"","tags":[]},
    {"id":"n_e","type":"end","x":60,"y":500,"label":"종료","desc":"","assignee":"","due":"","tags":[]}
  ],
  "edges": [
    {"id":"e1","from":"n_s","to":"n_1","label":""},
    {"id":"e2","from":"n_1","to":"n_d","label":""},
    {"id":"e3","from":"n_d","to":"n_e","label":"Yes"}
  ]
}`;

app.post('/api/ai/generate', maybeAuth('mcp:execute'), async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ success: false, error: 'prompt required' });
    }
    const auth = getNousAuth();
    if (!auth) {
      return res.status(503).json({ success: false, error: 'Nous 인증 토큰 없음' });
    }
    const sysPrompt = `You are a workflow designer. Convert the user's request into a workflow JSON.
Rules:
- node types: start, process, decision, end
- start node label "시작", end node label "종료"
- decision nodes must have outgoing edges labeled "Yes"/"No"
- coordinates: x starts 60, y increments 140
- Return ONLY valid JSON (no markdown, no explanation)
Example format:
${WF_SCHEMA_EXAMPLE}`;

    const r = await fetch(auth.base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + auth.token,
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v4-flash-0731',
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1500,
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      return res.status(502).json({ success: false, error: 'LLM API 오류: ' + r.status + ' ' + errText.slice(0, 200) });
    }
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content || '';
    // JSON 추출 (마크다운 코드 블록 처리)
    let jsonStr = content.trim();
    const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) jsonStr = fence[1].trim();
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }
    let wf;
    try {
      wf = JSON.parse(jsonStr);
    } catch (e) {
      return res.status(422).json({ success: false, error: 'LLM 출력 파싱 실패: ' + e.message, raw: content.slice(0, 500) });
    }
    // LLM 출력 정규화 — 다양한 형식 → nodes/edges
    // 형식 A: { nodes:[], edges:[] }
    // 형식 B: { workflow: { steps: [...] } }
    // 형식 C: { steps: [...] }
    let rawWf = wf.workflow && wf.workflow.nodes ? wf.workflow : wf;
    if (!rawWf.nodes && (rawWf.steps || (rawWf.workflow && rawWf.workflow.steps))) {
      const steps = rawWf.steps || (rawWf.workflow && rawWf.workflow.steps);
      const nodes = [
        { id: 'n_s', type: 'start', x: 60, y: 80, label: '시작', desc: '', assignee: '', due: '', tags: [] },
      ];
      const edges = [];
      let prev = 'n_s';
      steps.forEach((s, i) => {
        const id = 'n_' + (i + 1);
        nodes.push({
          id, type: 'process', x: 60, y: 80 + (i + 1) * 140,
          label: s.name || s.label || '단계 ' + (i + 1),
          desc: s.description || s.desc || '', assignee: '', due: '', tags: [],
        });
        edges.push({ id: 'e_' + i, from: prev, to: id, label: '' });
        prev = id;
      });
      nodes.push({ id: 'n_e', type: 'end', x: 60, y: 80 + (steps.length + 1) * 140, label: '종료', desc: '', assignee: '', due: '', tags: [] });
      edges.push({ id: 'e_end', from: prev, to: 'n_e', label: '' });
      wf = { nodes, edges };
    }
    // 스키마 검증/보정
    if (!Array.isArray(wf.nodes)) wf.nodes = [];
    if (!Array.isArray(wf.edges)) wf.edges = [];
    wf.nodes.forEach((n, i) => {
      n.id = n.id || 'n_' + i;
      n.type = ['start', 'process', 'decision', 'end'].includes(n.type) ? n.type : 'process';
      n.x = typeof n.x === 'number' ? n.x : 60 + (i % 4) * 240;
      n.y = typeof n.y === 'number' ? n.y : 60 + Math.floor(i / 4) * 140;
      n.label = n.label || (n.type === 'start' ? '시작' : n.type === 'end' ? '종료' : '단계 ' + (i + 1));
      n.desc = n.desc || ''; n.assignee = n.assignee || ''; n.due = n.due || ''; n.tags = n.tags || [];
    });
    wf.edges.forEach((e, i) => {
      e.id = e.id || 'e_' + i;
      e.label = e.label || '';
    });
    // semantic cache 저장 (같은 프롬프트 재사용 시 비용 절감)
    try {
      await pool.query(
        `INSERT INTO llm_cache (prompt_hash, prompt, response, model) VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING`,
        [cacheHash, prompt, JSON.stringify(wf), routeModel]
      );
    } catch (e) { console.warn('[llm] 캐시 저장 실패:', e.message); }
    res.json({ success: true, workflow: wf });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

server.listen(PORT, () => {
  approvalGate.logConfig();
  console.log(`[approval] /api/approvals 인증: ${APPROVALS_AUTH ? '요구함' : '열려 있음 (WF_APPROVALS_AUTH=1 로 잠금)'}`);
  // 웹훅이 살아 있는지 주기적으로 확인한다.
  // 같은 봇 토큰으로 getUpdates 롱폴링을 도는 프로세스가 있으면 텔레그램이
  // 웹훅을 해제해 버린다. 그러면 콜백이 아예 안 오고, 서버 입장에서는
  // '아무 일도 안 일어나는' 상태라 알아챌 방법이 없다 — 실제로 그렇게 한참 갔다.
  checkWebhookAlive();
  setInterval(checkWebhookAlive, 10 * 60 * 1000);
  if (!notify.enabled()) console.warn('[notify] 텔레그램 미설정 — 승인 요청이 사용자에게 전달되지 않는다');
  console.log(`워크플로우 빌더 서버: http://localhost:${PORT}`);
});

// MCP 라우터용 export
module.exports = { pool, sendAgentCommand, broadcastWf };
