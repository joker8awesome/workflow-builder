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

const app = express();
app.use(express.json({ limit: '10mb' }));

// PostgreSQL — 로컬 소켓 trust
const pool = new Pool({
  host: '/opt/data/pgdata',
  database: 'odds',
  user: 'hermes',
});

const PORT = process.env.PORT || 3737;

// CORS — 배포 시 특정 출처 제한, 로컬은 전체 허용
const ALLOWED_ORIGINS = (process.env.WF_ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
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

// 간단한 인증 — 환경변수 WF_ACCESS_TOKEN 설정 시 편집 API에 토큰 요구
const ACCESS_TOKEN = process.env.WF_ACCESS_TOKEN || null;
function requireAuth(req, res, next) {
  if (!ACCESS_TOKEN) return next(); // 미설정 시 인증 없음 (로컬)
  const auth = req.headers.authorization || '';
  if (auth === 'Bearer ' + ACCESS_TOKEN) return next();
  return res.status(401).json({ success: false, error: 'unauthorized' });
}
// 편집(mutation) API에만 인증 적용
app.post('/api/workflows', requireAuth);
app.put('/api/workflows/:id', requireAuth);
app.delete('/api/workflows/:id', requireAuth);
app.post('/api/workflows/:id/versions', requireAuth);
app.post('/api/workflows/:id/logs', requireAuth);

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
const wss = new WebSocketServer({ server, path: '/ws' });
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

// === LLM 판단 API (decision 노드: llm_prompt) ===
app.post('/api/ai/decide', async (req, res) => {
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
app.post('/api/webhook/register', requireAuth, async (req, res) => {
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
  } catch (e) {}
  res.json({ success: true, triggered: reg });
});

// === 실행 스크립트 API (노드 액션: script) ===
app.post('/api/exec', async (req, res) => {
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
      try { fs.mkdirSync(cwd, { recursive: true }); } catch (e) {}
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
app.post('/api/workflows/:id/comments', requireAuth, async (req, res) => {
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
app.post('/api/workflows/:id/results', async (req, res) => {
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
app.post('/api/agents', requireAuth, async (req, res) => {
  try {
    const { id, name, person, role, machine, color } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    await pool.query(
      `INSERT INTO agents (id, name, person, role, machine, color)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, person=EXCLUDED.person,
         role=EXCLUDED.role, machine=EXCLUDED.machine, color=EXCLUDED.color`,
      [id, name || '', person || '', role || '', JSON.stringify(machine || {}), color || '#00ff87']
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.delete('/api/agents/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM agents WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 승인 감사 API (Strong HITL) ===
app.post('/api/approvals', async (req, res) => {
  try {
    const { wf_id, node_id, agent_id, approver, decision, checklist, context } = req.body || {};
    if (!wf_id) return res.status(400).json({ success: false, error: 'wf_id required' });
    const { rows } = await pool.query(
      `INSERT INTO wf_approvals (wf_id, node_id, agent_id, approver, decision, checklist, context, decided_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now()) RETURNING id`,
      [wf_id, node_id || '', agent_id || '', approver || 'system', decision || 'pending',
       JSON.stringify(checklist || {}), context || '']
    );
    res.json({ success: true, id: rows[0].id });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.get('/api/approvals', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM wf_approvals ORDER BY created_at DESC LIMIT 100');
    res.json({ success: true, approvals: rows });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 에이전트 지식 메모리 API (MCP 스타일 공유) ===
app.post('/api/knowledge', async (req, res) => {
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
app.post('/api/messages', async (req, res) => {
  try {
    const { msg_type, from_agent, to_agent, session_id, payload } = req.body || {};
    if (!from_agent || !to_agent) return res.status(400).json({ success: false, error: 'from/to required' });
    const { rows } = await pool.query(
      `INSERT INTO agent_messages (msg_type, from_agent, to_agent, session_id, payload, status)
       VALUES ($1,$2,$3,$4,$5,'sent') RETURNING id`,
      [msg_type || 'command', from_agent, to_agent, session_id || '', JSON.stringify(payload || {})]
    );
    res.json({ success: true, id: rows[0].id });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
// 세션 상태 갱신
app.put('/api/sessions/:id', async (req, res) => {
  try {
    const { status } = req.body || {};
    await pool.query('UPDATE agent_sessions SET status = $1, updated_at = now() WHERE id = $2', [status || 'idle', req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 1. 에이전트 자격증명/권한 API ===
app.get('/api/credentials', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT agent_id, api_key, scopes FROM agent_credentials');
    res.json({ success: true, credentials: rows });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.post('/api/credentials', requireAuth, async (req, res) => {
  try {
    const { agent_id, scopes } = req.body || {};
    if (!agent_id) return res.status(400).json({ success: false, error: 'agent_id required' });
    const key = 'ag_' + require('crypto').randomBytes(12).toString('hex');
    await pool.query(
      `INSERT INTO agent_credentials (agent_id, api_key, scopes) VALUES ($1,$2,$3)
       ON CONFLICT (agent_id) DO UPDATE SET api_key=EXCLUDED.api_key, scopes=EXCLUDED.scopes`,
      [agent_id, key, JSON.stringify(scopes || ['execute', 'report'])]
    );
    res.json({ success: true, api_key: key });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 2. 감사 로그 API ===
app.post('/api/audit', async (req, res) => {
  try {
    const { actor, agent_id, resource, action, detail } = req.body || {};
    await pool.query(
      `INSERT INTO audit_logs (actor, agent_id, resource, action, detail) VALUES ($1,$2,$3,$4,$5)`,
      [actor || 'user', agent_id || '', resource || '', action || '', detail || '']
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
app.post('/api/templates', requireAuth, async (req, res) => {
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
app.post('/api/templates/:id/install', async (req, res) => {
  try {
    await pool.query('UPDATE wf_templates SET installs = installs + 1 WHERE id = $1', [req.params.id]);
    const { rows } = await pool.query('SELECT data FROM wf_templates WHERE id = $1', [req.params.id]);
    res.json({ success: true, data: rows[0] ? rows[0].data : null });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 4. LLM semantic cache API ===
app.post('/api/cache/get', async (req, res) => {
  try {
    const { prompt, model } = req.body || {};
    if (!prompt) return res.json({ success: true, hit: false });
    const hash = require('crypto').createHash('sha256').update(prompt + (model || '')).digest('hex').slice(0, 16);
    const { rows } = await pool.query(
      'SELECT response FROM llm_cache WHERE prompt_hash = $1 ORDER BY id DESC LIMIT 1', [hash]);
    res.json({ success: true, hit: rows.length > 0, response: rows[0] ? rows[0].response : null, hash });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.post('/api/cache/put', async (req, res) => {
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
app.post('/api/ai/decide', async (req, res) => {
  try {
    const { prompt, context, model } = req.body || {};
    if (!prompt) return res.status(400).json({ success: false, error: 'prompt required' });
    const auth = getNousAuth();
    if (!auth) return res.status(503).json({ success: false, error: 'Nous 인증 토큰 없음' });
    const r = await fetch(auth.inference_base_url + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.access_token },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v4-flash-0731',
        messages: [
          { role: 'system', content: 'Answer ONLY with YES or NO followed by a confidence score 0-100. Format: YES 85' },
          { role: 'user', content: String(prompt) },
        ],
        temperature: 0.2,
        max_tokens: 100,
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      return res.status(502).json({ success: false, error: 'LLM API 오류: ' + r.status + ' ' + errText.slice(0, 200) });
    }
    const data = await r.json();
    const content = (data.choices?.[0]?.message?.content || '').trim().toUpperCase();
    const yes = content.includes('YES');
    const confMatch = content.match(/(\d{1,3})/);
    const confidence = confMatch ? Math.min(100, Math.max(0, parseInt(confMatch[1]))) : 50;
    res.json({ success: true, decision: yes, confidence, raw: content });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

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
app.post('/api/tests', requireAuth, async (req, res) => {
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
app.post('/api/tests/:id/result', requireAuth, async (req, res) => {
  try {
    const { status } = req.body || {};
    await pool.query(
      'UPDATE wf_tests SET last_status = $1, last_run_at = now() WHERE id = $2',
      [status || 'pending', req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
app.delete('/api/tests/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM wf_tests WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});

// === 워크플로우 스케줄/트리거 API ===
app.post('/api/workflows/:id/schedule', requireAuth, async (req, res) => {
  try {
    const { cron, trigger_type } = req.body || {};
    await pool.query('UPDATE wf_workflows SET schedule = $1, trigger_type = $2 WHERE id = $3',
      [cron || '', trigger_type || 'manual', req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
});
// 자연어 → cron 변환 (간단 파서)
app.post('/api/schedule/parse', async (req, res) => {
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
app.post('/api/workflows/:id/run', async (req, res) => {
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

app.post('/api/ai/generate', async (req, res) => {
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
    } catch (e) {}
    res.json({ success: true, workflow: wf });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`워크플로우 빌더 서버: http://localhost:${PORT}`);
});
