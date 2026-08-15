// mcp-router.js — MCP Streamable HTTP 서버 (스펙 2026-07-28)
const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');
const { parseScopes } = require('./auth-credential');
const { parseJsonb } = require('./jsonb');
const pool = new Pool(process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : { host: process.env.PGHOST || '/opt/data/pgdata',
      database: process.env.PGDATABASE || 'odds',
      user: process.env.PGUSER || 'hermes',
      password: process.env.PGPASSWORD,
      port: process.env.PGPORT });
const router = express.Router();

// ------- 인증 미들웨어 -------
async function authenticate(req, res, next) {
  // 테스트용 인증 우회 — WF_MCP_OPEN=1 이면 Bearer 없이 통과 (Custom Connector OAuth 대응)
  if (process.env.WF_MCP_OPEN === '1') {
    req.agent_id = 'ag_connector';
    req.scopes = ['mcp:read', 'mcp:execute', 'mcp:admin'];
    return next();
  }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'invalid_credentials' }, id: null });
  }
  const key = auth.slice(7);
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  try {
    const { rows } = await pool.query(
      'SELECT agent_id, scopes, expires_at FROM agent_credentials WHERE key_hash = $1 AND (revoked_at IS NULL)',
      [keyHash]
    );
    if (!rows.length) {
      return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'invalid_credentials', data: { detail: 'API key not found or revoked' } }, id: null });
    }
    if (rows[0].expires_at && new Date(rows[0].expires_at) < new Date()) {
      return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'invalid_credentials', data: { detail: 'API key expired' } }, id: null });
    }
    req.agent_id = rows[0].agent_id;
    // scopes 는 배열이 아니라 Postgres 배열 리터럴 문자열('{"mcp:read",...}')로 온다.
    // 그대로 두면 아래 스코프 검사의 .includes() 가 부분 문자열 검사가 된다.
    req.scopes = parseScopes(rows[0].scopes);
    pool.query('UPDATE agent_credentials SET last_used_at = now() WHERE key_hash = $1', [keyHash]).catch(e => console.warn('[mcp] last_used_at 갱신 실패:', e.message));
    next();
  } catch (e) {
    res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null });
  }
}

// ------- 스코프 강제 -------
const SCOPE_FOR_TOOL = {
  'agent.whoami': 'mcp:read',
  'agent.tasks.list_pending': 'mcp:read',
  'agent.tasks.claim': 'mcp:execute',
  'agent.payload.get': 'mcp:read',
  'agent.report': 'mcp:execute',
  'workflow.list': 'mcp:read',
  'workflow.execute': 'mcp:execute',
  'workflow.get_status': 'mcp:read',
  'workflow.get_trace': 'mcp:read',
  'agent.send_message': 'mcp:execute',
  'agent.list': 'mcp:read',
  'agent.checkpoint': 'mcp:execute'
};

// ------- 툴 스키마 -------
const TOOLS = [
  { name: 'agent.whoami', description: '연결된 세션의 신원 확인', inputSchema: { type: 'object', properties: {} } },
  { name: 'agent.tasks.list_pending', description: '나에게 온 처리 대기 메시지 조회 (기본 command/instruction)', inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20 }, since: { type: 'string', format: 'date-time' }, types: { type: 'array', items: { enum: ['command', 'instruction', 'report'] } } } } },
  { name: 'agent.tasks.claim', description: '명령 클레임 (동시 처리 방지)', inputSchema: { type: 'object', required: ['message_id'], properties: { message_id: { type: 'string' } } } },
  { name: 'agent.payload.get', description: 'payload_ref를 실제 데이터로 해석', inputSchema: { type: 'object', required: ['payload_ref'], properties: { payload_ref: { type: 'string' } } } },
  { name: 'agent.report', description: '작업 결과 보고', inputSchema: { type: 'object', required: ['trace_id', 'task_status'], properties: { trace_id: { type: 'string' }, task_status: { enum: ['completed', 'failed'] }, result: {}, error: { type: 'string' }, duration_ms: { type: 'number' } } } },
  // tag 는 선언돼 있었으나 wf_workflows 에 해당 컬럼이 없어 구현할 수 없다.
  // 없는 기능을 스키마에 남겨두면 호출자가 넘긴 값이 조용히 무시된다 — 그래서 뺀다.
  { name: 'workflow.list', description: '등록된 워크플로우 목록', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'workflow.execute', description: '워크플로우 실행 트리거', inputSchema: { type: 'object', required: ['workflow_id'], properties: { workflow_id: { type: 'string' }, inputs: { type: 'object' }, async: { type: 'boolean', default: true } } } },
  { name: 'workflow.get_status', description: '실행 상태 조회', inputSchema: { type: 'object', required: ['run_id'], properties: { run_id: { type: 'string' } } } },
  { name: 'workflow.get_trace', description: '실행 트레이스 조회', inputSchema: { type: 'object', required: ['trace_id'], properties: { trace_id: { type: 'string' }, include_children: { type: 'boolean', default: true } } } },
  { name: 'agent.send_message', description: '다른 에이전트에게 메시지 전송', inputSchema: { type: 'object', required: ['to_agent', 'type'], properties: { to_agent: { type: 'string' }, type: { enum: ['command', 'instruction', 'report'] }, payload_ref: { type: 'string' }, trace_id: { type: 'string' } } } },
  { name: 'agent.list', description: '에이전트 목록', inputSchema: { type: 'object', properties: { capability: { type: 'string' }, online_only: { type: 'boolean' } } } },
  { name: 'agent.checkpoint', description: '세션 체크포인트 기록', inputSchema: { type: 'object', required: ['session_id', 'status'], properties: { session_id: { type: 'string' }, status: { enum: ['running', 'waiting', 'done', 'failed'] }, note: { type: 'string' } } } }
];

// ------- 툴 실행 -------
async function callTool(name, args, ctx) {
  const { agent_id } = ctx;
  // 감사 로그
  try {
    await pool.query('INSERT INTO audit_logs (actor, agent_id, resource, action, detail) VALUES ($1,$2,$3,$4,$5)',
      [agent_id, agent_id, JSON.stringify(args || {}).slice(0, 500), 'mcp.' + name, JSON.stringify(args || {}).slice(0, 500)]);
  } catch (e) { console.warn('[mcp] 감사 로그 기록 실패:', e.message); }
  switch (name) {
    case 'agent.whoami': {
      const { rows } = await pool.query('SELECT id, name, role FROM agents WHERE id = $1', [agent_id]);
      const a = rows[0];
      return { content: [{ type: 'text', text: JSON.stringify({ agent_id, name: a ? a.name : agent_id, scopes: ctx.scopes }) }] };
    }
    case 'agent.tasks.list_pending': {
      const limit = Math.min((args && args.limit) || 20, 100);
      // since 는 선언만 돼 있고 무시됐다. 폴링하는 쪽이 "이 시각 이후"만 받으려
      // 넘겨도 매번 전체가 오고 있었다.
      const since = (args && args.since) ? new Date(args.since) : null;
      const useSince = since && !isNaN(since.getTime());
      if (args && args.since && !useSince) {
        console.warn('[mcp] list_pending: since 파싱 실패, 무시함:', args.since);
      }
      // types 미지정 시 기존 동작(command/instruction)을 유지한다.
      // report 를 기본에 넣으면 "처리할 작업"과 "받은 보고"가 섞인다.
      // 다만 지정하면 볼 수 있어야 한다 — 할매봇이 report 로 보낸 보고가
      // 이 툴에 잡히지 않아 큐에 쌓이기만 하던 문제가 있었다.
      const ALLOWED_TYPES = ['command', 'instruction', 'report'];
      let types = Array.isArray(args && args.types) ? args.types.filter(t => ALLOWED_TYPES.includes(t)) : [];
      if (!types.length) types = ['command', 'instruction'];
      const params = [agent_id, limit, types];
      if (useSince) params.push(since.toISOString());
      const { rows } = await pool.query(
        `SELECT id, from_agent, msg_type, payload_ref, trace_id, status, created_at
         FROM agent_messages WHERE to_agent = $1 AND msg_type = ANY($3) AND status = 'pending'
         ${useSince ? 'AND created_at > $4' : ''}
         ORDER BY created_at ASC LIMIT $2`, params);
      const tasks = rows.map(r => ({ message_id: 'msg_' + r.id, from_agent: r.from_agent, type: r.msg_type, payload_ref: r.payload_ref, trace_id: r.trace_id, timestamp: r.created_at, claimed_by: null }));
      return { content: [{ type: 'text', text: JSON.stringify({ tasks }) }] };
    }
    case 'agent.tasks.claim': {
      const mid = (args && args.message_id || '').replace('msg_', '');
      const lease = 30;
      const expires = new Date(Date.now() + lease * 1000).toISOString();
      const { rows } = await pool.query(
        `UPDATE agent_messages SET status = 'claimed', read_at = now() WHERE id = $1 AND status = 'pending' RETURNING id`, [mid]);
      if (rows.length) return { content: [{ type: 'text', text: JSON.stringify({ claimed: true, expires_at: expires, lease_seconds: lease }) }] };
      return { content: [{ type: 'text', text: JSON.stringify({ claimed: false, claimed_by: 'ag_other' }) }] };
    }
    case 'agent.payload.get': {
      const ref = (args && args.payload_ref) || '';
      const { rows } = await pool.query('SELECT id, wf_id, node_id, result, run_at FROM wf_results WHERE node_id = $1 ORDER BY id DESC LIMIT 1', [ref]);
      if (!rows.length) throw { code: -32003, message: 'payload_not_found' };
      return { content: [{ type: 'text', text: JSON.stringify({ payload: rows[0].result, mime_type: 'application/json', size_bytes: JSON.stringify(rows[0].result).length, created_at: rows[0].run_at, created_by: rows[0].wf_id }) }] };
    }
    case 'agent.report': {
      const { trace_id, task_status, result, error, duration_ms } = args || {};
      // 4.2 멱등성 — 이미 완료된 trace_id면 중복 처리 방지
      try {
        const chk = await pool.query(
          `SELECT COUNT(*) FROM agent_checkpoints WHERE data->>'trace_id' = $1 AND status IN ('done','failed')`, [trace_id]);
        if (parseInt(chk.rows[0].count) > 0) {
          return { content: [{ type: 'text', text: JSON.stringify({ idempotent: true, trace_id, result_payload_ref: 'result_' + trace_id.slice(-6) }) }] };
        }
      } catch (e) { console.warn('[mcp] 멱등성 확인 실패 — 중복 처리될 수 있다:', e.message); }
      await pool.query(`UPDATE agent_messages SET status = $1, read_at = now() WHERE trace_id = $2`, [task_status === 'completed' ? 'completed' : 'failed', trace_id]);
      const rref = 'result_' + Date.now().toString(36);
      try {
        await pool.query('INSERT INTO wf_results (wf_id, node_id, result) VALUES ($1,$2,$3)', [trace_id.slice(0, 8), rref, JSON.stringify({ agent: agent_id, result: result || null, error: error || null, status: task_status })]);
      } catch (e) { console.warn('[mcp] 결과 저장 실패 — payload_ref 가 빈 참조가 된다:', e.message); }
      // 체크포인트 기록 — 멱등성 기반 (done/failed)
      try {
        await pool.query(
          `INSERT INTO agent_checkpoints (session_id, wf_id, node_id, status, data)
           VALUES ($1,$2,$3,$4,$5)`,
          ['sess_' + Date.now().toString(36), trace_id.slice(0, 8), rref,
           task_status === 'completed' ? 'done' : 'failed',
           JSON.stringify({ agent_id, trace_id, status: task_status, error: error || null })]
        );
      } catch (e) { console.warn('[mcp] 체크포인트 기록 실패:', e.message); }
      try { const srv = require('./server'); if (srv && srv.broadcastWf) srv.broadcastWf(trace_id, { agent_report: true, status: task_status, agent_id }); } catch (e) { console.warn('[mcp] WS 브로드캐스트 실패:', e.message); }
      return { content: [{ type: 'text', text: JSON.stringify({ report_message_id: 'msg_' + Date.now().toString(36), result_payload_ref: rref, checkpoint_id: 'chk_' + Date.now().toString(36), span_id: 'span_' + Date.now().toString(36) }) }] };
    }
    case 'workflow.list': {
      // limit 은 선언만 돼 있고 무시됐다. 넘기면 실제로 줄어들도록 한다.
      // 미지정 시에는 기존 동작(전체 반환)을 유지한다 — 기본값을 넣으면
      // 지금까지 전체를 받아 쓰던 호출자가 조용히 잘린 결과를 받게 된다.
      const lim = Math.min(Math.max(parseInt((args || {}).limit, 10) || 0, 0), 500);
      const { rows } = await pool.query(
        'SELECT id, name, data, updated_at FROM wf_workflows ORDER BY updated_at DESC' +
        (lim ? ' LIMIT $1' : ''), lim ? [lim] : []);
      const wfs = rows.map(r => {
        const d = parseJsonb(r.data, { label: 'wf_workflows.data', id: r.id });
        return { id: r.id, name: r.name, node_count: (d.nodes || []).length, updated_at: r.updated_at };
      });
      return { content: [{ type: 'text', text: JSON.stringify({ workflows: wfs }) }] };
    }
    case 'workflow.execute': {
      const { workflow_id, inputs, async } = args || {};
      const run_id = 'run_' + Date.now().toString(36);
      const trace_id = 'trace_' + Date.now().toString(36);
      try {
        await pool.query(`INSERT INTO wf_runlogs (wf_id, run_path, status) VALUES ($1, $2, 'running')`, [workflow_id, 'MCP 트리거']);
      } catch (e) { console.warn('[mcp] 실행 로그 기록 실패:', e.message); }
      return { content: [{ type: 'text', text: JSON.stringify({ run_id, trace_id, status: 'started', started_at: new Date().toISOString(), inputs: inputs || {} }) }] };
    }
    case 'workflow.get_status': {
      return { content: [{ type: 'text', text: JSON.stringify({ run_id: (args && args.run_id) || '', status: 'completed', current_node: null, current_node_label: null, elapsed_ms: 0, error: null }) }] };
    }
    case 'workflow.get_trace': {
      const trace = (args && args.trace_id) || '';
      // include_children 은 선언만 돼 있고 무시됐다 (기본 true).
      // false 면 최상위 스팬만 — 오케스트레이터는 하위 호출의 parent_id 에
      // 상위 trace_id 를 넣으므로, 최상위는 parent_id 가 자기 trace_id 이거나 비어 있다.
      const includeChildren = !(args && args.include_children === false);
      const { rows } = await pool.query(
        `SELECT node_id, agent_id, operation, duration_ms, result, parent_id
         FROM agent_spans WHERE trace_id = $1
         ${includeChildren ? '' : "AND (parent_id = $2 OR parent_id IS NULL OR parent_id = '')"}
         ORDER BY duration_ms`,
        includeChildren ? [trace] : [trace, trace]);
      return { content: [{ type: 'text', text: JSON.stringify({ spans: rows, total_duration_ms: rows.reduce((a, r) => a + (r.duration_ms || 0), 0) }) }] };
    }
    case 'agent.send_message': {
      const { to_agent, type, payload_ref, trace_id } = args || {};
      const sid = 'sess_' + Date.now().toString(36);
      await pool.query('INSERT INTO agent_messages (msg_type, from_agent, to_agent, session_id, payload, status, trace_id, payload_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [type || 'command', agent_id, to_agent, sid, '{}', 'pending', trace_id || '', payload_ref || '']);
      const pushed = false;  // WS push는 서버 모듈 참조 (순환 방지 — DB 대기열로 충분)
      try { const srv = require('./server'); if (srv && srv.sendAgentCommand) pushed = await srv.sendAgentCommand(to_agent, { type: type || 'command', from_agent: agent_id, to_agent, payload_ref: payload_ref || '', trace_id: trace_id || '', payload: {} }); } catch (e) { console.warn('[mcp] WS 즉시 전달 실패 — DB 큐로만 전달된다:', e.message); }
      return { content: [{ type: 'text', text: JSON.stringify({ message_id: 'msg_' + Date.now().toString(36), delivered: pushed, delivery_method: pushed ? 'websocket' : 'queued' }) }] };
    }
    case 'agent.list': {
      // capabilities/tools/trust_score — agents.machine (JSONB)에 저장
      // online은 agent_sessions 조인으로 계산
      const { capability, online_only } = args || {};
      const { rows } = await pool.query(
        `SELECT a.id, a.name, a.role, a.machine,
                count(DISTINCT s.id) FILTER (
                  WHERE s.status IN ('running','working','waiting')) AS active_sessions
         FROM agents a
         LEFT JOIN agent_sessions s ON s.agent_id = a.id
         GROUP BY a.id, a.name, a.role, a.machine
         ORDER BY a.id`);
      let agents = rows.map(a => {
        const m = parseJsonb(a.machine, { label: 'agents.machine', id: a.id });
        return {
          agent_id: a.id,
          name: a.name,
          role: a.role,
          capabilities: Array.isArray(m.capabilities) ? m.capabilities : [],
          tools: Array.isArray(m.tools) ? m.tools : [],
          online: Number(a.active_sessions) > 0,
          trust_score: typeof m.trust_score === 'number' ? m.trust_score : 0,
        };
      });
      if (capability) agents = agents.filter(x => x.capabilities.includes(capability));
      if (online_only) agents = agents.filter(x => x.online);
      return { content: [{ type: 'text', text: JSON.stringify({ agents }) }] };
    }
    case 'agent.checkpoint': {
      const { session_id, status, note } = args || {};
      await pool.query(`INSERT INTO agent_checkpoints (session_id, wf_id, node_id, status, data) VALUES ($1,$2,$3,$4,$5)`,
        [session_id, '', '', status, JSON.stringify({ note: note || '', agent_id })]);
      return { content: [{ type: 'text', text: JSON.stringify({ checkpoint_id: 'chk_' + Date.now().toString(36), created_at: new Date().toISOString() }) }] };
    }
    default:
      throw { code: -32601, message: 'Method not found' };
  }
}

// ------- Streamable HTTP endpoint -------
router.post('/mcp', authenticate, async (req, res) => {
  const body = req.body;
  if (!body || body.jsonrpc !== '2.0') {
    return res.status(400).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null });
  }
  const strictHeaders = process.env.WF_MCP_STRICT_HEADERS === '1';
  const headerMethod = req.headers['mcp-method'];
  if (strictHeaders && !headerMethod) {
    return res.json(rpcError(body.id ?? null, -32600, 'Mcp-Method header required (strict mode)'));
  }
  const method = headerMethod || body.method;
  if (headerMethod && body.method && headerMethod !== body.method) {
    return res.json(rpcError(body.id ?? null, -32600, 'header/body method mismatch'));
  }
  if (method === 'initialize') {
    return res.json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: body.params?.protocolVersion || '2026-07-28', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'command-center', version: '1.0.0' } } });
  }
  if (method === 'tools/list') {
    return res.json({ jsonrpc: '2.0', id: body.id, result: { tools: TOOLS } });
  }
  if (method === 'tools/call') {
    try {
      let name = body.params?.name || '';
      // 4.3 underscore 정규화 — 첫 단어 뒤의 밑줄만 점으로 (agent_whoami → agent.whoami)
      // list_pending 같은 이름 내부 밑줄은 보존
      name = name.replace(/^([a-z]+)_/, '$1.');
      const args = body.params?.arguments || {};
      const scope = SCOPE_FOR_TOOL[name];
      if (scope && !(req.scopes || []).includes(scope)) {
        return res.json({ jsonrpc: '2.0', id: body.id, error: { code: -32002, message: 'insufficient_scope', data: { required: scope, provided: req.scopes } } });
      }
      const result = await callTool(name, args, { agent_id: req.agent_id, scopes: req.scopes });
      let textContent = result;
      try {
        const parsed = result.content && result.content[0] && result.content[0].text;
        if (parsed) textContent = JSON.parse(parsed);
      } catch (e) { console.warn('[mcp] 결과 JSON 파싱 실패 — structuredContent 를 원본으로 반환:', e.message); }
      return res.json({ jsonrpc: '2.0', id: body.id, result: { content: result.content || [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: textContent } });
    } catch (e) {
      const code = e.code || -32603;
      return res.json({ jsonrpc: '2.0', id: body.id, error: { code, message: e.message || 'internal error' } });
    }
  }
  if (method === 'ping') {
    return res.json({ jsonrpc: '2.0', id: body.id, result: {} });
  }
  if (method === 'resources/list') {
    return res.json({ jsonrpc: '2.0', id: body.id, result: { resources: [
      { uri: 'workflow://list', name: '워크플로우 목록', mimeType: 'application/json' },
      { uri: 'agent://cards', name: 'Agent Card 목록', mimeType: 'application/json' }
    ] } });
  }
  res.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } });
});

// ------- Server Card -------
router.get('/.well-known/mcp-server-card', (req, res) => {
  res.json({
    name: 'Workflow Builder', version: '1.0.0',
    protocol_versions: ['2026-07-28'],
    endpoints: { mcp: `https://${req.get('host')}/mcp` },
    capabilities: { tools: true, resources: true, prompts: false, sampling: false },
    extensions: ['io.modelcontextprotocol/tasks'],
    auth: { type: 'bearer', instructions: '웹 UI: 팀 → 에이전트 → 자격증명 발급' },
    categories: ['workflow', 'orchestration', 'agent-coordination']
  });
});

module.exports = router;
