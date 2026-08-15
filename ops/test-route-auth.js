#!/usr/bin/env node
/**
 * 변경 라우트에 인증이 걸려 있는가 — 새로 생기는 무인증 라우트를 막는다.
 *
 * 왜 필요한가: /api/llm/worker 가 인증 없이 추가돼 외부 LLM 을 호출하고 있었다.
 * URL 만 알면 누구나 사용자의 크레딧으로 LLM 을 쓸 수 있는 상태였고,
 * 아무도 눈치채지 못했다. 자격증명 API 무인증 노출과 같은 유형이다.
 *
 * 이 검사는 "지금 무인증인 라우트 목록"을 고정한다.
 * 새 라우트를 인증 없이 추가하면 실패한다 — 목록에 넣으려면 이유를 적어야 하므로
 * 의식적인 결정이 된다. 기존 항목을 줄이는 것은 팀 도구 전환 3단계의 일이다.
 *
 * 실행: node ops/test-route-auth.js
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// 의도적으로 인증 없이 두는 라우트 — 각 항목에 이유가 있어야 한다.
// ⚠ 여기에 추가하는 것은 "인증 없이 공개해도 된다"는 선언이다.
const ALLOWED_PUBLIC = {
  '/api/telegram/webhook': '텔레그램이 호출한다. 자체 secret_token + chat_id 검증이 있다',
  '/api/webhook/:token': 'URL 의 token 자체가 자격이다',
  '/api/approvals': '⚠ 승인 요청 생성. scheduler.py 가 인증 없이 POST 한다. '
    + '악용 시 사용자 텔레그램에 알림을 다량 보낼 수 있다 — 스케줄러에 키를 주고 닫을 것',

  // 아래 라우트들은 maybeAuth 로 감싸져 WF_REQUIRE_AUTH_ALL=1 이면 인증이 걸린다.
  // 플래그가 꺼져 있을 때만 무인증이므로 이 목록에는 넣지 않는다.
};

let fails = [];
function check(name, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (!cond && detail ? '\n         ' + detail : ''));
  if (!cond) fails.push(name);
}

// 인라인 미들웨어 형태
const routes = [];
for (const m of SRC.matchAll(/app\.(post|put|delete|patch)\(\s*'([^']+)'\s*,([^\n]*)/g)) {
  const rest = m[3];
  routes.push({
    method: m[1].toUpperCase(), path: m[2],
    guarded: /requireAuth|requireScope/.test(rest),
    conditional: /maybeAuth/.test(rest),   // WF_REQUIRE_AUTH_ALL=1 일 때만 적용
  });
}
// 별도 줄로 거는 형태: app.post('/x', requireAuth);
const preGuarded = new Set(
  [...SRC.matchAll(/app\.(?:post|put|delete|patch)\('([^']+)',\s*requireAuth\);/g)].map(m => m[1])
);

const unguarded = routes.filter(r => !r.guarded && !r.conditional && !preGuarded.has(r.path));
const conditional = [...new Set(routes.filter(r => r.conditional).map(r => r.path))];
const paths = [...new Set(unguarded.map(r => r.path))];

console.log(`변경 라우트 ${routes.length}개 · 인증 없음 ${paths.length}개\n`);

console.log('1) 목록에 없는 무인증 변경 라우트가 새로 생기지 않았는가');
const unexpected = paths.filter(p => !(p in ALLOWED_PUBLIC));
check('신규 무인증 라우트 없음', unexpected.length === 0,
  unexpected.map(p => `${p}  ← 인증을 걸거나, 이유와 함께 ALLOWED_PUBLIC 에 넣을 것`).join('\n         '));

console.log('\n2) 목록에 있는데 실제로는 인증이 걸린 항목 (정리 대상)');
const nowGuarded = Object.keys(ALLOWED_PUBLIC).filter(p => !paths.includes(p));
check('목록이 최신 상태', nowGuarded.length === 0,
  nowGuarded.map(p => `${p}  ← 보호됨. ALLOWED_PUBLIC 에서 제거할 것`).join('\n         '));

console.log('\n3) 비용이 나가는 라우트는 반드시 보호돼야 한다');
const COSTLY = ['/api/llm/worker'];
for (const p of COSTLY) {
  const r = routes.find(x => x.path === p);
  check(`${p} 인증됨`, r ? r.guarded : true,
    r ? '외부 LLM 을 호출한다. 무인증이면 공개 LLM 프록시가 된다' : '');
}

console.log('\n4) 플래그로 보호되는 라우트 (팀 도구 3단계)');
check('조건부 보호 라우트가 존재', conditional.length > 0,
  'maybeAuth 로 감싼 라우트가 없다. 3단계가 되돌려졌는지 확인할 것');
console.log(`         ${conditional.length}개가 maybeAuth 로 감싸져 있다.`);
console.log('         WF_REQUIRE_AUTH_ALL=1 이어야 실제로 인증이 걸린다.');
console.log('         플래그가 꺼져 있는 동안은 여전히 무인증이다 — 배포만으로 닫히지 않는다.');

console.log('\n' + (fails.length ? `실패 ${fails.length}건` : '전부 통과'));
const warned = Object.entries(ALLOWED_PUBLIC).filter(([, v]) => v.startsWith('⚠'));
if (warned.length) {
  console.log('\n⚠ 의도적으로 열어둔 항목 중 위험 표시:');
  for (const [k, v] of warned) console.log(`   ${k}\n     ${v}`);
}
process.exit(fails.length ? 1 : 0);
