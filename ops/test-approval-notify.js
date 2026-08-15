#!/usr/bin/env node
/**
 * approval-gate + notify 검증 — 외부 전송 없이 확인.
 * 실행: node ops/test-approval-notify.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const gate = require(path.join(ROOT, 'approval-gate'));
const notify = require(path.join(ROOT, 'notify'));

let fails = [];
function check(name, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) fails.push(name);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function withEnv(v, fn) {
  const had = 'WF_APPROVAL_REQUIRED' in process.env;
  const old = process.env.WF_APPROVAL_REQUIRED;
  if (v === undefined) delete process.env.WF_APPROVAL_REQUIRED;
  else process.env.WF_APPROVAL_REQUIRED = v;
  try { return fn(); } finally {
    if (had) process.env.WF_APPROVAL_REQUIRED = old;
    else delete process.env.WF_APPROVAL_REQUIRED;
  }
}

console.log('1) 기본값 — 미설정 시 넓게(안전하게)');
withEnv(undefined, () => {
  check('deploy 는 승인 필요', gate.requiresApproval('deploy'));
  check('workflow.execute 는 승인 필요', gate.requiresApproval('workflow.execute'));
  check('credential.issue 는 승인 필요', gate.requiresApproval('credential.issue'));
  check('rollback 은 승인 필요', gate.requiresApproval('rollback'));
  check('code.change 는 기본적으로 자동', !gate.requiresApproval('code.change'));
  check('source=default', gate.describe().source === 'default');
});

console.log('\n2) 명시 설정이 기본값을 이긴다');
withEnv('deploy', () => {
  check('deploy 만 승인', gate.requiresApproval('deploy'));
  check('workflow.execute 는 자동으로 바뀜', !gate.requiresApproval('workflow.execute'));
  check('source=env', gate.describe().source === 'env');
  check('auto 목록에 나머지가 들어감',
    gate.describe().auto.includes('workflow.execute'), JSON.stringify(gate.describe().auto));
});

console.log('\n3) 빈 문자열 = "승인 없음"이라는 명시적 선택');
withEnv('', () => {
  check('아무것도 승인 안 함', eq(gate.requiredActions(), []));
  check('전 작업이 auto', gate.describe().auto.length === gate.KNOWN_ACTIONS.length);
});

console.log('\n4) 알 수 없는 이름은 조용히 무시하지 않고 걸러낸다');
withEnv('deploy,없는작업,rollback', () => {
  check('유효한 것만 남음', eq(gate.requiredActions(), ['deploy', 'rollback']),
    JSON.stringify(gate.requiredActions()));
});

console.log('\n5) notify — 미설정이면 전송하지 않고 실패로 보고');
(async () => {
  const hadT = process.env.WF_TELEGRAM_TOKEN, hadC = process.env.WF_TELEGRAM_CHAT_ID;
  delete process.env.WF_TELEGRAM_TOKEN; delete process.env.WF_TELEGRAM_CHAT_ID;
  check('enabled()=false', notify.enabled() === false);
  const r = await notify.send('테스트');
  check('sent=false, reason=not_configured', r.sent === false && r.reason === 'not_configured', JSON.stringify(r));
  const r2 = await notify.approvalRequest({ id: 1, action: 'deploy', detail: 'x', requester: 'ag_hermes' });
  check('승인 요청도 예외 없이 실패 반환', r2.sent === false);
  if (hadT) process.env.WF_TELEGRAM_TOKEN = hadT;
  if (hadC) process.env.WF_TELEGRAM_CHAT_ID = hadC;

  console.log('\n6) MarkdownV2 이스케이프');
  check('예약문자 이스케이프', notify.esc('a_b*c[d]') === 'a\\_b\\*c\\[d\\]', notify.esc('a_b*c[d]'));
  check('백슬래시도 처리', notify.esc('a\\b') === 'a\\\\b', notify.esc('a\\b'));
  check('null 안전', notify.esc(null) === '');

  console.log('\n' + (fails.length ? `실패 ${fails.length}건: ${fails.join(', ')}` : '전부 통과'));
  process.exit(fails.length ? 1 : 0);
})();
