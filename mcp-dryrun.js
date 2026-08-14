// Full dry-run: simulates Claude Desktop client executing the 3-step flow
// against local server using exact agent_id from user's config
const { newDb } = require('pg-mem');
const express = require('express');
const http = require('http');

const memDb = newDb();
const { Pool } = memDb.adapters.createPg();
const pool = new Pool();
const db = { query: (sql, params) => pool.query(sql, params) };

const PORT = 4739;

function req(method, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const r = http.request({
      hostname: '127.0.0.1', port: PORT, method, path,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
        ...(data && { 'Content-Length': Buffer.byteLength(data) }),
      }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const mcpCall = (toolName, args, key) => req('POST', '/mcp', {
  headers: {
    Authorization: `Bearer ${key}`,
    'Mcp-Method': 'tools/call',
    'Mcp-Name': toolName,
  },
  body: { jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
          params: { name: toolName, arguments: args } },
});

async function bootstrap() {
  await pool.query(`
    CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT, role TEXT, machine JSONB);
    CREATE TABLE agent_credentials (
      id SERIAL PRIMARY KEY, agent_id TEXT, name TEXT DEFAULT 'default',
      key_hash TEXT, key_prefix TEXT,
      scopes TEXT[] DEFAULT ARRAY['mcp:read','mcp:execute'],
      created_at TIMESTAMPTZ DEFAULT now(),
      last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, expires_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX idx_ac ON agent_credentials(key_hash)
      WHERE revoked_at IS NULL AND key_hash IS NOT NULL;
    CREATE TABLE agent_messages (
      id SERIAL PRIMARY KEY, type TEXT, from_agent TEXT, to_agent TEXT,
      payload_ref TEXT, task_status TEXT, trace_id TEXT,
      timestamp TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE agent_spans (
      id SERIAL PRIMARY KEY, trace_id TEXT, agent_id TEXT, operation TEXT,
      duration_ms INT, result JSONB
    );
    CREATE TABLE agent_checkpoints (
      id SERIAL PRIMARY KEY, agent_id TEXT, trace_id TEXT, status TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE wf_results (
      id SERIAL PRIMARY KEY, payload JSONB, created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE audit_logs (
      id SERIAL PRIMARY KEY, actor TEXT, action TEXT, resource TEXT,
      timestamp TIMESTAMPTZ DEFAULT now()
    );

    -- 사용자 config와 동일한 agent
    INSERT INTO agents (id, name, role, machine) VALUES
      ('ag_claude_desktop', 'Claude Desktop 세션',
       'MCP 클라이언트',
       '{"workspace":"/opt/data/agents/ag_claude_desktop"}');
  `);
}

function section(title) {
  console.log('\n' + '='.repeat(72));
  console.log(title);
  console.log('='.repeat(72));
}

async function main() {
  await bootstrap();
  const app = express();
  app.use('/', require('./credentials-api')(db));
  app.use('/', require('./mcp-router')(db));
  const server = app.listen(PORT);
  await new Promise(r => server.on('listening', r));

  // ==================================================================
  section('STEP 0. 자격증명 발급 (웹 UI에서 하는 것과 동일)');
  // ==================================================================
  const issRes = await req('POST', '/api/agents/ag_claude_desktop/credentials', {
    body: { name: 'claude-desktop-dryrun' }
  });
  console.log('Response status:', issRes.status);
  console.log('Response body:');
  console.log(JSON.stringify(issRes.body, null, 2));
  const key = issRes.body.key;

  // ==================================================================
  section('STEP 0.5 Preflight — curl agent.whoami (Claude Desktop 열기 전 확인용)');
  // ==================================================================
  console.log('\n실행할 curl (사용자 측):');
  console.log(`curl -sX POST http://localhost:3737/mcp \\\n` +
              `  -H "Authorization: Bearer <YOUR_KEY>" \\\n` +
              `  -H "Content-Type: application/json" \\\n` +
              `  -H "Mcp-Method: tools/call" \\\n` +
              `  -H "Mcp-Name: agent.whoami" \\\n` +
              `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"agent.whoami","arguments":{}}}'`);
  console.log('\n샌드박스에서 실제 실행 결과:');
  const whoami = await mcpCall('agent.whoami', {}, key);
  console.log('HTTP status:', whoami.status);
  console.log('Response body:');
  console.log(JSON.stringify(whoami.body, null, 2));
  console.log('\n>>> structuredContent.agent_id =', whoami.body.result.structuredContent.agent_id);
  console.log('>>> 이 값이 사용자 실제 서버에서도 "ag_claude_desktop" 이어야 통과');

  // ==================================================================
  section('STEP 1. 시드 SQL — 웹 UI에서 워크플로우 실행하는 것과 동일 효과');
  // ==================================================================
  console.log('\n실행할 SQL (사용자 측):');
  const seedSql = `WITH r AS (
  INSERT INTO wf_results (payload, created_by)
  VALUES ('{"task":"AI 뉴스 3개 요약","keywords":["AI","2026"]}'::jsonb, 'orchestrator')
  RETURNING id
)
INSERT INTO agent_messages (type, from_agent, to_agent, payload_ref, trace_id, timestamp)
SELECT 'command', 'orchestrator', 'ag_claude_desktop',
       'result_'||id,
       'trace_e2e_' || extract(epoch from now())::bigint,
       now()
FROM r
RETURNING trace_id, payload_ref;`;
  console.log(seedSql);
  console.log('\n샌드박스 실행 결과 (pg-mem이 CTE INSERT 미지원이라 2단계 분리 실행):');
  const r1 = await pool.query(
    `INSERT INTO wf_results (payload, created_by)
     VALUES ('{"task":"AI 뉴스 3개 요약","keywords":["AI","2026"]}', 'orchestrator')
     RETURNING id`);
  const resultId = r1.rows[0].id;
  const traceId = `trace_e2e_${Date.now()}`;
  const seedPayloadRef = `result_${resultId}`;
  await pool.query(
    `INSERT INTO agent_messages (type, from_agent, to_agent, payload_ref, trace_id, timestamp)
     VALUES ('command', 'orchestrator', 'ag_claude_desktop', $1, $2, now())`,
    [seedPayloadRef, traceId]);
  console.log(`trace_id: ${traceId}`);
  console.log(`payload_ref: ${seedPayloadRef}`);

  // ==================================================================
  section('STEP 2. Claude Desktop이 실제로 할 툴 호출 시퀀스');
  // ==================================================================

  console.log('\n[2.1] "펜딩 작업 확인해줘" → agent.tasks.list_pending');
  const pending = await mcpCall('agent.tasks.list_pending', {}, key);
  console.log('Response.structuredContent:');
  console.log(JSON.stringify(pending.body.result.structuredContent, null, 2));

  const task = pending.body.result.structuredContent.tasks
    .find(t => t.trace_id === traceId);
  console.log(`\n>>> 위 시드 명령이 tasks[]에 나타남: ${!!task}`);
  console.log(`>>> 실제 서버에서 사용자가 "1건 있어" 응답 받으면 OK`);

  console.log('\n[2.2] Claude가 payload.get로 파라미터 확인');
  const payload = await mcpCall('agent.payload.get',
    { payload_ref: task.payload_ref }, key);
  console.log('Response.structuredContent:');
  console.log(JSON.stringify(payload.body.result.structuredContent, null, 2));

  console.log('\n[2.3] Claude가 실제 작업 수행 (여기선 mock)');
  const mockResult = {
    articles: [
      { title: 'GPT-6 발표', summary: '차세대 모델 성능 향상 발표' },
      { title: 'Anthropic Series F', summary: '2026 대규모 투자 유치' },
      { title: 'MCP 2026-07-28 릴리스', summary: 'stateless 전환' },
    ],
    generated_at: new Date().toISOString(),
  };
  console.log('작업 결과 (mock):', JSON.stringify(mockResult, null, 2).slice(0, 200) + '...');

  console.log('\n[2.4] "처리 완료" → agent.report');
  const t0 = Date.now();
  const report = await mcpCall('agent.report', {
    trace_id: traceId,
    task_status: 'completed',
    result: mockResult,
    duration_ms: 1420,
  }, key);
  const t1 = Date.now();
  console.log(`Report 응답 시간: ${t1 - t0}ms`);
  console.log('Response.structuredContent:');
  console.log(JSON.stringify(report.body.result.structuredContent, null, 2));

  // ==================================================================
  section('STEP 3. DB 검증 SQL (사용자가 실제 psql에서 실행할 것)');
  // ==================================================================

  const verifySql = `SELECT
  (SELECT task_status FROM agent_messages
   WHERE trace_id = '${traceId}' AND type='command') AS cmd_status,
  (SELECT COUNT(*) FROM agent_messages
   WHERE trace_id = '${traceId}' AND type='report')::int AS report_count,
  (SELECT status FROM agent_checkpoints
   WHERE trace_id = '${traceId}') AS checkpoint,
  (SELECT duration_ms FROM agent_spans
   WHERE trace_id = '${traceId}') AS span_duration;`;
  console.log('\n실행할 SQL:');
  console.log(verifySql);
  console.log('\n샌드박스 실행 결과:');
  const verify = await pool.query(verifySql);
  console.log(JSON.stringify(verify.rows[0], null, 2));

  const v = verify.rows[0];
  const ok = v.cmd_status === 'completed' &&
             v.report_count === 1 &&
             v.checkpoint === 'done' &&
             v.span_duration > 0;
  console.log(`\n>>> 기대값 매치: ${ok ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log('    cmd_status=completed:', v.cmd_status === 'completed');
  console.log('    report_count=1:      ', v.report_count === 1);
  console.log('    checkpoint=done:     ', v.checkpoint === 'done');
  console.log('    span_duration>0:     ', v.span_duration > 0);

  // ==================================================================
  section('추가: 실전에서 나올 수 있는 이슈 재확인');
  // ==================================================================

  console.log('\n[Report 재시도 시나리오]');
  console.log('Claude가 네트워크 타임아웃 후 같은 report 재전송하면?');
  const report2 = await mcpCall('agent.report', {
    trace_id: traceId,
    task_status: 'completed',
    result: mockResult,
    duration_ms: 1420,
  }, key);
  console.log('두 번째 report 상태:', report2.status);
  console.log('두 번째 report에서 에러 반환?', !!report2.body.error);
  const dbAfter = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM agent_messages WHERE trace_id='${traceId}' AND type='report')::int AS reports,
      (SELECT COUNT(*) FROM agent_checkpoints WHERE trace_id='${traceId}')::int AS checkpoints,
      (SELECT COUNT(*) FROM agent_spans WHERE trace_id='${traceId}')::int AS spans
  `);
  console.log('중복 후 DB 상태:', JSON.stringify(dbAfter.rows[0]));
  const dup = dbAfter.rows[0];
  if (dup.reports > 1 || dup.checkpoints > 1 || dup.spans > 1) {
    console.log('>>> 관찰 4.2 재확인: 중복 report가 그대로 통과. 실전 하드닝 필요.');
  }

  console.log('\n[감사 로그 확인 — 실제 서버에서도 audit_logs에 기록되는지]');
  const audit = await pool.query(
    `SELECT action, COUNT(*)::int AS n FROM audit_logs
     WHERE actor='ag_claude_desktop' GROUP BY action ORDER BY action`);
  console.log('audit_logs 요약:');
  console.log(JSON.stringify(audit.rows, null, 2));

  server.close();
  console.log('\n' + '='.repeat(72));
  console.log('DRY RUN 완료. 위 결과가 실제 사용자 서버에서도 동일하면 정상.');
  console.log('='.repeat(72));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
