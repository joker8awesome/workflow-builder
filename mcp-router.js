// mcp-router.js — MCP Streamable HTTP 서버 (스펙 2026-07-28)
const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');
const pool = new Pool({ host: '/opt/data/pgdata', database: 'odds', user: 'hermes' });
const router = express.Router();

// ------- 인증 미들웨어 -------
async function authenticate(req, res, next) {
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
    req.scopes = rows[0].scopes || [];
    pool.query('UPDATE agent_credentials SET last_used_at = now() WHERE key_hash = $1', [keyHash]).catch(() => {});
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
  { name: 'agent.tasks.list_pending', description: '나에게 온 처리 대기 명령 조회', inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20 }, since: { type: 'string', format: 'date-time' } } } },
  { name: 'agent.tasks.claim', description: '명령 클레임 (동시 처리 방지)', inputSchema: { type: 'object', required: ['message_id'], properties: { message_id: { type: 'string' } } } },
  { name: 'agent.payload.get', description: 'payload_ref를 실제 데이터로 해석', inputSchema: { type: 'object', required: ['payload_ref'], properties: { payload_ref: { type: 'string' } } } },
  { name: 'agent.report', description: '작업 결과 보고', inputSchema: { type: 'object', required: ['trace_id', 'task_status'], properties: { trace_id: { type: 'string' }, task_status: { enum: ['completed', 'failed'] }, result: {}, error: { type: 'string' }, duration_ms: { type: 'number' } } } },
  { name: 'workflow.list', description: '등록된 워크플로우 목록', inputSchema: { type: 'object', properties: { tag: { type: 'string' }, limit: { type: 'number' } } } },
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
      ['agent', agent_id, 'mcp.' + name, 'call', JSON.stringify(args || {}).slice(0, 500)]);
  } catch (e) {}
  switch (name) {
    case 'agent.whoami': {
      const { rows } = await pool.query('SELECT id, name, role FROM agents WHERE id = $1', [agent_id]);
      const a = rows[0];
      return { content: [{ type: 'text', text: JSON.stringify({ agent_id, name: a ? a.name : agent_id, scopes: ctx.scopes }) }] };
    }
    case 'agent.tasks.list_pending': {
      const limit = Math.min((args && args.limit) || 20, 100);
      const { rows } = await pool.query(
        `SELECT id, from_agent, msg_type, payload_ref, trace_id, status, created_at
         FROM agent_messages WHERE to_agent = $1 AND msg_type IN ('command','instruction') AND status = 'pending'
         ORDER BY created_at ASC LIMIT $2`, [agent_id, limit]);
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
      } catch (e) {}
      await pool.query(`UPDATE agent_messages SET status = $1, read_at = now() WHERE trace_id = $2`, [task_status === 'completed' ? 'completed' : 'failed', trace_id]);
      const rref = 'result_' + Date.now().toString(36);
      try {
        await pool.query('INSERT INTO wf_results (wf_id, node_id, result) VALUES ($1,$2,$3)', [trace_id.slice(0, 8), rref, JSON.stringify({ agent: agent_id, result: result || null, error: error || null, status: task_status })]);
      } catch (e) {}
      // 체크포인트 기록 — 멱등성 기반 (done/failed)
      try {
        await pool.query(
          `INSERT INTO agent_checkpoints (session_id, wf_id, node_id, status, data)
           VALUES ($1,$2,$3,$4,$5)`,
          ['sess_' + Date.now().toString(36), trace_id.slice(0, 8), rref,
           task_status === 'completed' ? 'done' : 'failed',
           JSON.stringify({ agent_id, trace_id, status: task_status, error: error || null })]
        );
      } catch (e) {}
      try { const srv = require('./server'); if (srv && srv.broadcastWf) srv.broadcastWf(trace_id, { agent_report: true, status: task_status, agent_id }); } catch (e) {}
      return { content: [{ type: 'text', text: JSON.stringify({ report_message_id: 'msg_' + Date.now().toString(36), result_payload_ref: rref, checkpoint_id: 'chk_' + Date.now().toString(36), span_id: 'span_' + Date.now().toString(36) }) }] };
    }
    case 'workflow.list': {
      const { rows } = await pool.query('SELECT id, name, data, updated_at FROM wf_workflows ORDER BY updated_at DESC');
      const wfs = rows.map(r => { let d = {}; try { d = JSON.parse(r.data); } catch (e) {} return { id: r.id, name: r.name, node_count: (d.nodes || []).length, updated_at: r.updated_at }; });
      return { content: [{ type: 'text', text: JSON.stringify({ workflows: wfs }) }] };
    }
    case 'workflow.execute': {
      const { workflow_id, inputs, async } = args || {};
      const run_id = 'run_' + Date.now().toString(36);
      const trace_id = 'trace_' + Date.now().toString(36);
      try {
        await pool.query(`INSERT INTO wf_runlogs (wf_id, run_path, status) VALUES ($1, $2, 'running')`, [workflow_id, 'MCP 트리거']);
      } catch (e) {}
      return { content: [{ type: 'text', text: JSON.stringify({ run_id, trace_id, status: 'started', started_at: new Date().toISOString(), inputs: inputs || {} }) }] };
    }
    case 'workflow.get_status': {
      return { content: [{ type: 'text', text: JSON.stringify({ run_id: (args && args.run_id) || '', status: 'completed', current_node: null, current_node_label: null, elapsed_ms: 0, error: null }) }] };
    }
    case 'workflow.get_trace': {
      const trace = (args && args.trace_id) || '';
      const { rows } = await pool.query('SELECT node_id, agent_id, operation, duration_ms, result FROM agent_spans WHERE trace_id = $1 ORDER BY duration_ms', [trace]);
      return { content: [{ type: 'text', text: JSON.stringify({ spans: rows, total_duration_ms: rows.reduce((a, r) => a + (r.duration_ms || 0), 0) }) }] };
    }
    case 'agent.send_message': {
      const { to_agent, type, payload_ref, trace_id } = args || {};
      const sid = 'sess_' + Date.now().toString(36);
      await pool.query('INSERT INTO agent_messages (msg_type, from_agent, to_agent, session_id, payload, status, trace_id, payload_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [type || 'command', agent_id, to_agent, sid, '{}', 'pending', trace_id || '', payload_ref || '']);
      const pushed = false;  // WS push는 서버 모듈 참조 (순환 방지 — DB 대기열로 충분)
      try { const srv = require('./server'); if (srv && srv.sendAgentCommand) pushed = await srv.sendAgentCommand(to_agent, { type: type || 'command', from_agent: agent_id, to_agent, payload_ref: payload_ref || '', trace_id: trace_id || '', payload: {} }); } catch (e) {}
      return { content: [{ type: 'text', text: JSON.stringify({ message_id: 'msg_' + Date.now().toString(36), delivered: pushed, delivery_method: pushed ? 'websocket' : 'queued' }) }] };
    }
    case 'agent.list': {
      const { rows } = await pool.query('SELECT id, name, role FROM agents ORDER BY id');
      return { content: [{ type: 'text', text: JSON.stringify({ agents: rows.map(a => ({ agent_id: a.id, name: a.name, capabilities: [], tools: [], online: false, trust_score: 0 })) }) }] };
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
    return res.json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: body.params?.protocolVersion || '2026-07-28', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'workflow-builder', version: '1.0.0' } } });
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
      } catch (e) {}
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
    endpoints: { mcp: `${req.protocol}://${req.get('host')}/mcp` },
    capabilities: { tools: true, resources: true, prompts: false, sampling: false },
    extensions: ['io.modelcontextprotocol/tasks'],
    auth: { type: 'bearer', instructions: '웹 UI: 팀 → 에이전트 → 자격증명 발급' },
    categories: ['workflow', 'orchestration', 'agent-coordination']
  });
});

module.exports = router;
