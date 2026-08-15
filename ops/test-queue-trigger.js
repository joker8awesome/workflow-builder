#!/usr/bin/env node
/**
 * queue-trigger 검증 — 로컬 목 서버로 확인. 프로덕션 큐를 건드리지 않는다.
 *
 * 이 스크립트는 cron 이 1분마다 돌린다. 두 가지가 특히 중요하다:
 *   1) 같은 지시로 반복 기동하지 않을 것 — seen 을 파일에 남겨야 한다.
 *      메모리에만 두면 cron 은 매번 새 프로세스라 매분 다시 기동한다.
 *   2) 기동 명령이 실패해도 같은 지시로 계속 재시도하지 않을 것 —
 *      실패는 로그로 알리고 재시도는 사람이 판단한다.
 *
 * 실행: node ops/test-queue-trigger.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'ops', 'queue-trigger.js');
const STATE = path.join(ROOT, 'ops', '.queue-trigger-seen.json');
const OUT = path.join(ROOT, 'ops', '.queue-trigger.json');
const MARK = path.join(ROOT, 'ops', '.trigger-test-marker');

let fails = [];
function check(name, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) fails.push(name);
}
function cleanup() { for (const f of [STATE, OUT, MARK]) { try { fs.unlinkSync(f); } catch (e) {} } }

// 목 MCP 서버 — list_pending 응답을 마음대로 바꾼다
let TASKS = [];
const srv = http.createServer((rq, rs) => {
  let b = '';
  rq.on('data', c => { b += c; });
  rq.on('end', () => {
    rs.setHeader('Content-Type', 'application/json');
    rs.end(JSON.stringify({
      jsonrpc: '2.0', id: 1,
      result: { content: [{ type: 'text', text: JSON.stringify({ tasks: TASKS }) }] },
    }));
  });
});

// spawnSync 를 쓰면 안 된다 — 목 서버가 같은 프로세스에 있어서
// 동기 실행이 이벤트 루프를 막아 요청에 응답하지 못한다(데드락).
function run(env = {}) {
  return new Promise(resolve => {
    execFile(process.execPath, [SCRIPT], {
      cwd: ROOT, encoding: 'utf8',
      env: { ...process.env, WF_MCP_KEY: 'test-key', WF_MCP_URL: URL_, WF_AGENT_ID: 'ag_test', ...env },
    }, (err, stdout, stderr) => {
      resolve({ status: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
  });
}

let URL_;
srv.listen(0, '127.0.0.1', async () => {
  URL_ = `http://127.0.0.1:${srv.address().port}/mcp`;
  cleanup();

  console.log('1) 대기 건이 없으면 조용히 끝난다');
  TASKS = [];
  let r = await run();
  check('종료코드 1', r.status === 1, String(r.status));
  check('트리거 파일 안 만듦', !fs.existsSync(OUT));

  console.log('\n2) 새 지시가 있으면 기록하고 기동한다');
  TASKS = [{ message_id: 'msg_1', from_agent: 'ag_claude_desktop', trace_id: 't1', payload_ref: 'h.md@abc' }];
  r = await run({ WF_TRIGGER_CMD: `node -e "require('fs').writeFileSync('${MARK.replace(/\\/g, '\\\\')}','1')"` });
  check('종료코드 0', r.status === 0, String(r.status) + ' ' + (r.stderr || '').slice(0, 200));
  check('트리거 파일 생성', fs.existsSync(OUT));
  check('기동 명령 실행됨', fs.existsSync(MARK), 'WF_TRIGGER_CMD 가 실행되지 않았다');
  if (fs.existsSync(OUT)) {
    const j = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    check('트리거 파일에 지시 내용 포함',
      j.tasks && j.tasks[0] && j.tasks[0].message_id === 'msg_1', JSON.stringify(j).slice(0, 150));
  }

  console.log('\n3) 같은 지시로 다시 기동하지 않는다 (cron 반복 방지)');
  try { fs.unlinkSync(MARK); } catch (e) {}
  r = await run({ WF_TRIGGER_CMD: `node -e "require('fs').writeFileSync('${MARK.replace(/\\/g, '\\\\')}','1')"` });
  check('종료코드 1', r.status === 1, String(r.status));
  check('기동 명령 재실행 안 됨', !fs.existsSync(MARK),
    'seen 이 파일에 남지 않으면 cron 이 매분 같은 지시로 기동한다');

  console.log('\n4) 새 지시가 추가되면 다시 기동한다');
  TASKS.push({ message_id: 'msg_2', from_agent: 'ag_claude_desktop', trace_id: 't2', payload_ref: 'h2.md@def' });
  r = await run({ WF_TRIGGER_CMD: `node -e "require('fs').writeFileSync('${MARK.replace(/\\/g, '\\\\')}','1')"` });
  check('종료코드 0', r.status === 0, String(r.status));
  check('새 건만 대상', fs.existsSync(OUT) &&
    JSON.parse(fs.readFileSync(OUT, 'utf8')).tasks.length === 1);

  console.log('\n5) 기동 명령이 실패해도 같은 지시를 반복하지 않는다');
  TASKS.push({ message_id: 'msg_3', from_agent: 'x', trace_id: 't3', payload_ref: '' });
  r = await run({ WF_TRIGGER_CMD: 'node -e "process.exit(3)"' });
  check('실패를 종료코드 2로 알림', r.status === 2, String(r.status));
  r = await run({ WF_TRIGGER_CMD: 'node -e "process.exit(3)"' });
  check('재시도하지 않음', r.status === 1,
    '실패한 지시로 매분 재기동하면 로그가 폭주하고 부작용이 반복된다');

  console.log('\n6) 키가 없으면 명확히 실패');
  r = await run({ WF_MCP_KEY: '' });
  check('종료코드 2', r.status === 2, String(r.status));

  cleanup();
  srv.close();
  console.log('\n' + (fails.length ? `실패 ${fails.length}건: ${fails.join(', ')}` : '전부 통과'));
  process.exit(fails.length ? 1 : 0);
});
