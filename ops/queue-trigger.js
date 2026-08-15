#!/usr/bin/env node
/**
 * queue-trigger.js — 큐에 지시가 들어오면 로컬에서 에이전트를 기동한다.
 *
 * 왜 텔레그램이 아니라 파일·프로세스인가:
 *   깨우기를 텔레그램으로 시도했으나 게이트웨이가 봇이 보낸 메시지를 걸러
 *   세션이 시작되지 않았다. 봇끼리의 루프를 막으려는 표준 동작이라 우회가 어렵다.
 *   스케줄러와 에이전트는 같은 VPS 안에 있으므로 외부 API 를 경유할 이유가 없다.
 *   텔레그램을 빼면 봇 필터·레이트리밋·네트워크 장애에서도 자유롭다.
 *
 * 하는 일:
 *   1. 해당 에이전트 앞으로 온 pending command/instruction 을 조회
 *   2. 새 건이 있으면 트리거 파일(ops/.queue-trigger.json)에 기록
 *   3. WF_TRIGGER_CMD 가 설정돼 있으면 그 명령을 실행 (에이전트 기동)
 *
 * 사용법 (VPS cron, 1분 간격 권장):
 *   * * * * * cd /opt/data/projects/workflow-builder && \
 *     WF_AGENT_ID=ag_hermes WF_MCP_KEY=... node ops/queue-trigger.js >> ops/queue-trigger.log 2>&1
 *
 * 종료 코드: 0 = 새 지시 있음(기동함), 1 = 없음, 2 = 오류
 *
 * 환경 변수:
 *   WF_AGENT_ID     대상 에이전트 (기본 ag_hermes)
 *   WF_MCP_KEY      해당 에이전트의 wf_ak_ 키 (mcp:read 이상)
 *   WF_MCP_URL      기본 https://187.127.124.16.sslip.io/mcp
 *   WF_TRIGGER_CMD  새 지시 발견 시 실행할 명령. 미설정이면 파일만 남긴다
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const AGENT = process.env.WF_AGENT_ID || 'ag_hermes';
const MCP = process.env.WF_MCP_URL || 'https://187.127.124.16.sslip.io/mcp';
const KEY = process.env.WF_MCP_KEY || '';
const CMD = process.env.WF_TRIGGER_CMD || '';
const STATE = path.join(ROOT, 'ops', '.queue-trigger-seen.json');
const OUT = path.join(ROOT, 'ops', '.queue-trigger.json');

function log(...a) { console.log(`[${new Date().toISOString()}]`, ...a); }

function loadSeen() {
  // 처리한 id 를 파일에 남긴다. 메모리에만 두면 cron 은 매번 새 프로세스라
  // 같은 지시로 계속 기동하게 된다.
  try { return new Set(JSON.parse(fs.readFileSync(STATE, 'utf8')).seen || []); }
  catch (e) { return new Set(); }
}
function saveSeen(set) {
  const arr = [...set].slice(-500);   // 무한 증가 방지
  try { fs.writeFileSync(STATE, JSON.stringify({ seen: arr }, null, 0)); }
  catch (e) { console.warn('[trigger] 상태 저장 실패:', e.message); }
}

async function listPending() {
  const r = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'agent.tasks.list_pending', arguments: { limit: 20 } },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'mcp_error');
  const txt = j.result?.content?.[0]?.text;
  return txt ? (JSON.parse(txt).tasks || []) : [];
}

(async () => {
  if (!KEY) { console.error('WF_MCP_KEY 필요'); process.exit(2); }

  let tasks;
  try { tasks = await listPending(); }
  catch (e) { console.error('[trigger] 큐 조회 실패:', e.message); process.exit(2); }

  const seen = loadSeen();
  const fresh = tasks.filter(t => !seen.has(t.message_id));

  if (!fresh.length) {
    process.exit(1);   // 조용히 종료 — cron 로그를 더럽히지 않는다
  }

  log(`새 지시 ${fresh.length}건 (${AGENT})`);
  for (const t of fresh) {
    log(`  ${t.message_id} | ${t.from_agent} | trace=${t.trace_id || '-'} | ref=${t.payload_ref || '-'}`);
    seen.add(t.message_id);
  }

  // 트리거 파일 — 기동된 쪽이 이걸 읽어 무엇을 할지 안다
  try {
    fs.writeFileSync(OUT, JSON.stringify({
      agent: AGENT, detected_at: new Date().toISOString(), tasks: fresh,
    }, null, 2));
  } catch (e) { console.warn('[trigger] 트리거 파일 기록 실패:', e.message); }

  // seen 은 명령 실행 전에 저장한다.
  // 명령이 실패해도 같은 지시로 매분 재기동하는 것을 막기 위해서다
  // (실패는 로그로 알리고, 재시도는 사람이 판단한다).
  saveSeen(seen);

  if (!CMD) {
    log('WF_TRIGGER_CMD 미설정 — 트리거 파일만 남긴다. 에이전트는 기동되지 않는다');
    process.exit(0);
  }

  log(`기동: ${CMD}`);
  try {
    const out = execSync(CMD, { cwd: ROOT, encoding: 'utf8', timeout: 10 * 60 * 1000, stdio: 'pipe' });
    if (out) log(out.trim().slice(0, 2000));
    log('기동 완료');
  } catch (e) {
    console.error('[trigger] 기동 실패:', e.message);
    if (e.stdout) console.error(String(e.stdout).slice(0, 1000));
    if (e.stderr) console.error(String(e.stderr).slice(0, 1000));
    process.exit(2);
  }
  process.exit(0);
})();
