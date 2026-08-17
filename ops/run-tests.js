#!/usr/bin/env node
/**
 * run-tests.js — 모든 테스트를 한 번에 돌린다.
 *
 * 테스트가 4종으로 늘었는데 각각 따로 실행해야 해서 하나를 빠뜨리기 쉬웠다.
 * package.json 의 test 스크립트가 `exit 1` 인 채로 남아 있던 것도 같은 이유다.
 *
 * 실행:
 *   npm test                       # 전체
 *   node ops/run-tests.js          # 동일
 *   node ops/run-tests.js --list   # 목록만
 *
 * 종료 코드: 0 = 전부 통과, 1 = 하나라도 실패
 *
 * 파이썬 인터프리터는 VPS(.agentenv) → python3 → python 순으로 찾는다.
 * DB·네트워크 없이 도는 테스트만 넣는다 — CI 어디서나 같은 결과가 나와야 한다.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SUITES = [
  { name: '자격증명 인증 (auth-credential)', file: 'ops/test-auth-credential.js', runner: 'node', expect: 17 },
  { name: '승인 게이트·알림 (approval/notify)', file: 'ops/test-approval-notify.js', runner: 'node', expect: 19 },
  { name: '텔레그램 웹훅 (telegram-webhook)', file: 'ops/test-telegram-webhook.js', runner: 'node', expect: 27 },
  { name: '세션 상태 전이 (session-status)', file: 'ops/test-session-status.py', runner: 'python', expect: 11 },
  { name: '조용한 예외 삼킴 없음 (no-silent-catch)', file: 'ops/test-no-silent-catch.js', runner: 'node', expect: 11 },
  { name: 'MCP 툴 계약 (mcp-contract)', file: 'ops/test-mcp-contract.js', runner: 'node', expect: 24 },
  { name: 'JSONB 파싱 일원화 (jsonb)', file: 'ops/test-jsonb.js', runner: 'node', expect: 19 },
  { name: '라우트 인증 (route-auth)', file: 'ops/test-route-auth.js', runner: 'node', expect: 5 },
  { name: '스케줄러 큐 필터 (scheduler-queue)', file: 'ops/test-scheduler-queue.py', runner: 'python', expect: 12 },
  { name: '큐 트리거 (queue-trigger)', file: 'ops/test-queue-trigger.js', runner: 'node', expect: 36 },
  { name: '메시지 상태 어휘 (message-status)', file: 'ops/test-message-status.js', runner: 'node', expect: 15 },
  { name: 'LLM 워커 불변식 (llm-worker-invariants)', file: 'ops/test-llm-worker-invariants.js', runner: 'node', expect: 10 },
  { name: '프론트엔드 계약 (frontend-contract)', file: 'ops/test-frontend-contract.js', runner: 'node', expect: 10 },
];

function findPython() {
  const candidates = [
    path.join(ROOT, '.agentenv', 'bin', 'python'),
    path.join(ROOT, '.agentenv', 'Scripts', 'python.exe'),
    'python3',
    'python',
  ];
  for (const c of candidates) {
    if (c.includes(path.sep) && !fs.existsSync(c)) continue;
    const r = spawnSync(c, ['--version'], { encoding: 'utf8', shell: false });
    if (!r.error && r.status === 0) return c;
  }
  return null;
}

if (process.argv.includes('--list')) {
  console.log('테스트 스위트:');
  for (const s of SUITES) console.log(`  ${s.file}  (${s.expect}건 기대)  — ${s.name}`);
  process.exit(0);
}

const PY = findPython();
let failed = 0, skipped = 0, total = 0;
const results = [];

console.log('━'.repeat(64));
for (const s of SUITES) {
  const abs = path.join(ROOT, s.file);
  if (!fs.existsSync(abs)) {
    console.log(`⏭  ${s.name}\n   파일 없음: ${s.file}`);
    results.push({ ...s, status: 'missing' });
    skipped++; continue;
  }
  let cmd = s.runner === 'python' ? PY : process.execPath;
  if (s.runner === 'python' && !PY) {
    console.log(`⏭  ${s.name}\n   파이썬을 찾을 수 없어 건너뜀`);
    results.push({ ...s, status: 'no-python' });
    skipped++; continue;
  }

  const r = spawnSync(cmd, [abs], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const pass = (out.match(/^\s*PASS\s/gm) || []).length;
  const fail = (out.match(/^\s*FAIL\s/gm) || []).length;
  total += pass;

  if (r.status === 0 && fail === 0) {
    const warn = s.expect && pass !== s.expect ? `  ⚠ 기대 ${s.expect}건과 다름` : '';
    console.log(`✅ ${s.name}  —  ${pass}건 통과${warn}`);
    results.push({ ...s, status: 'pass', pass });
  } else {
    console.log(`❌ ${s.name}  —  통과 ${pass} / 실패 ${fail}`);
    // 실패 상세만 뽑아 보여준다 (전체 출력은 길다)
    for (const line of out.split('\n')) {
      if (/^\s*FAIL\s/.test(line) || /^실패 \d+건/.test(line) || /Error|Traceback/.test(line)) {
        console.log('     ' + line.trim());
      }
    }
    results.push({ ...s, status: 'fail', pass, fail });
    failed++;
  }
}
console.log('━'.repeat(64));

const okCount = results.filter(r => r.status === 'pass').length;
console.log(`스위트 ${okCount}/${SUITES.length} 통과 · 검사 ${total}건 통과` +
  (skipped ? ` · ${skipped}개 건너뜀` : '') +
  (failed ? ` · ${failed}개 실패` : ''));

if (skipped && !failed) {
  console.log('\n⚠ 건너뛴 스위트가 있다. 전부 통과했다고 볼 수 없다.');
}
process.exit(failed ? 1 : 0);
