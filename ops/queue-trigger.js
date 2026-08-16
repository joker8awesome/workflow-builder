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
// 상태 파일이 놓이는 곳. 기본은 ops/ 지만 테스트는 임시 디렉터리를 가리킨다.
// 예전엔 경로가 박혀 있어서 VPS 에서 npm test 를 돌리면 트리거의 seen 이 지워지고
// 잠금까지 뺏겼다 — 아직 pending 인 지시가 다시 기동되는 사고로 이어진다.
// (할매봇이 지시서 #22 검증 중에 잠금 경합으로 발견했다)
const DIR = process.env.WF_TRIGGER_DIR || path.join(ROOT, 'ops');
const STATE = path.join(DIR, '.queue-trigger-seen.json');
const OUT = path.join(DIR, '.queue-trigger.json');

const LOCK = path.join(DIR, '.queue-trigger.lock');
const LOCK_STALE_MS = 15 * 60 * 1000;   // 기동 명령 타임아웃(10분)보다 넉넉히

function log(...a) { console.log(`[${new Date().toISOString()}]`, ...a); }

/**
 * 잠금은 이 스크립트 안에서 잡는다 — WF_TRIGGER_CMD 에 flock 을 두면 안 된다.
 *
 * cron 은 1분마다 도는데 기동은 수 분 걸릴 수 있다. 명령 쪽에서 잠그면
 * 이 스크립트는 "실행했다"고 믿고 seen 에 기록해 버린다. 그런데 실제로는
 * 잠금에 막혀 아무것도 안 했으므로, 그 지시는 영원히 처리되지 않는다.
 * 여기서 잠그면 "시도조차 못 했다"를 알 수 있어 seen 을 남기지 않고 다음 분에 재시도한다.
 */
function acquireLock() {
  try {
    fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') { console.warn('[trigger] 잠금 오류:', e.message); return false; }
    // 죽은 프로세스가 남긴 잠금이면 회수한다 — 안 그러면 영영 막힌다
    try {
      const age = Date.now() - fs.statSync(LOCK).mtimeMs;
      if (age > LOCK_STALE_MS) {
        log(`오래된 잠금 회수 (${Math.round(age / 1000)}초 경과)`);
        fs.unlinkSync(LOCK);
        fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' });
        return true;
      }
    } catch (e2) { /* 경합 — 아래에서 false */ }
    return false;
  }
}
function releaseLock() { try { fs.unlinkSync(LOCK); } catch (e) {} }

// 기동에 몇 번까지 다시 도전할지. 넘으면 포기하고 크게 알린다.
const MAX_TRIES = Number(process.env.WF_TRIGGER_MAX_TRIES || 3);

function loadState() {
  // 처리한 id 를 파일에 남긴다. 메모리에만 두면 cron 은 매번 새 프로세스라
  // 같은 지시로 계속 기동하게 된다.
  try {
    const j = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    return { seen: new Set(j.seen || []), tries: j.tries || {} };
  } catch (e) { return { seen: new Set(), tries: {} }; }
}
function saveState(st) {
  const arr = [...st.seen].slice(-500);   // 무한 증가 방지
  // 이미 seen 인 건 시도 기록을 들고 있을 이유가 없다
  const tries = {};
  for (const [k, v] of Object.entries(st.tries)) if (!st.seen.has(k)) tries[k] = v;
  try { fs.writeFileSync(STATE, JSON.stringify({ seen: arr, tries }, null, 0)); }
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

  // 잠금을 먼저 잡는다. 못 잡으면 seen 을 건드리지 않고 그대로 나간다 —
  // 다음 분에 같은 지시를 다시 보게 된다.
  if (!acquireLock()) {
    process.exit(1);   // 이전 기동이 아직 진행 중
  }
  process.on('exit', releaseLock);
  process.on('SIGINT', () => { releaseLock(); process.exit(130); });
  process.on('SIGTERM', () => { releaseLock(); process.exit(143); });

  let tasks;
  try { tasks = await listPending(); }
  catch (e) { console.error('[trigger] 큐 조회 실패:', e.message); process.exit(2); }

  const st = loadState();
  const fresh = tasks.filter(t => !st.seen.has(t.message_id));

  if (!fresh.length) {
    process.exit(1);   // 조용히 종료 — cron 로그를 더럽히지 않는다
  }

  log(`새 지시 ${fresh.length}건 (${AGENT})`);
  for (const t of fresh) {
    const n = (st.tries[t.message_id] || 0) + 1;
    st.tries[t.message_id] = n;
    log(`  ${t.message_id} | ${t.from_agent} | trace=${t.trace_id || '-'} | ref=${t.payload_ref || '-'}`
      + (n > 1 ? ` | ${n}번째 시도` : ''));
  }

  // 트리거 파일 — 기동된 쪽이 이걸 읽어 무엇을 할지 안다
  try {
    fs.writeFileSync(OUT, JSON.stringify({
      agent: AGENT, detected_at: new Date().toISOString(), tasks: fresh,
    }, null, 2));
  } catch (e) { console.warn('[trigger] 트리거 파일 기록 실패:', e.message); }

  // 시도 횟수는 기동 **전에** 저장한다.
  // 프로세스가 중간에 죽어도(타임아웃·SIGKILL) 횟수는 남아야 무한 재시도를 막는다.
  //
  // seen 은 여기서 넣지 않는다. 예전엔 넣었는데, 기동이 실패해도 "봤다"가 돼서
  // 그 지시가 영영 사라졌다 — 실제로 msg_176 이 그렇게 묻혀 사람이 파일을 지워야 했다.
  // 매분 무한 재기동은 막되 일시적 실패는 넘기도록, 횟수를 세어 MAX_TRIES 까지만 다시 한다.
  saveState(st);

  if (!CMD) {
    log('WF_TRIGGER_CMD 미설정 — 트리거 파일만 남긴다. 에이전트는 기동되지 않는다');
    for (const t of fresh) st.seen.add(t.message_id);
    saveState(st);
    process.exit(0);
  }

  log(`기동: ${CMD}`);
  try {
    const out = execSync(CMD, { cwd: ROOT, encoding: 'utf8', timeout: 10 * 60 * 1000, stdio: 'pipe' });
    if (out) log(out.trim().slice(0, 2000));
    for (const t of fresh) st.seen.add(t.message_id);
    saveState(st);
    log('기동 완료');
  } catch (e) {
    console.error('[trigger] 기동 실패:', e.message);
    if (e.stdout) console.error(String(e.stdout).slice(0, 1000));
    if (e.stderr) console.error(String(e.stderr).slice(0, 1000));

    // 횟수를 넘긴 건은 포기한다. 조용히 넘기면 매분 같은 실패를 반복한다.
    const done = fresh.filter(t => (st.tries[t.message_id] || 0) >= MAX_TRIES);
    for (const t of done) st.seen.add(t.message_id);
    saveState(st);
    if (done.length) {
      console.error(`[trigger] ${MAX_TRIES}회 실패로 포기: ${done.map(t => t.message_id).join(', ')}`);
      console.error('[trigger] 이 지시들은 자동으로 다시 시도하지 않는다. 사람이 확인할 것.');
    } else {
      const left = fresh.map(t => `${t.message_id}(${st.tries[t.message_id]}/${MAX_TRIES})`).join(', ');
      console.error(`[trigger] 다음 회차에 다시 시도한다: ${left}`);
    }
    process.exit(2);
  }
  process.exit(0);
})();
