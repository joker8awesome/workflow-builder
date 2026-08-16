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
    conditional: /maybeAuth|approvalsAuth/.test(rest),   // 환경변수 플래그로만 적용
  });
}
// 별도 줄로 거는 형태: app.post('/x', requireAuth);  또는  app.post('/x', maybeAuth('mcp:execute'));
const preGuarded = new Set(
  [...SRC.matchAll(/app\.(?:post|put|delete|patch)\('([^']+)',\s*(?:requireAuth|maybeAuth)\(/g)].map(m => m[1])
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

console.log('\n4) 플래그로만 보호되는 라우트');
check('조건부 보호 라우트가 존재', conditional.length > 0,
  '조건부 인증 래퍼가 없다. 되돌려졌는지 확인할 것');
const byApprovals = [...SRC.matchAll(/app\.post\('([^']+)',\s*approvalsAuth\(\)/g)].map(m => m[1]);
console.log(`         총 ${conditional.length}개.`);
console.log(`         · WF_REQUIRE_AUTH_ALL=1 : ${conditional.length - byApprovals.length}개`);
console.log(`         · WF_APPROVALS_AUTH=1   : ${byApprovals.length}개  ${byApprovals.join(', ')}`);
console.log('         플래그가 꺼져 있는 동안은 여전히 무인증이다 — 배포만으로는 닫히지 않는다.');
check('/api/approvals 가 조건부 보호에 포함', byApprovals.includes('/api/approvals'),
  '승인 요청은 사용자 휴대폰으로 알림을 보낸다. 무방비면 알림 폭탄이 가능하다');

console.log('\n5) #37 지시서 정적 검사 — requireAuth 잔존·교체·/api/credentials admin');
check('server.js 에 requireAuth 가 0회', !/requireAuth/.test(SRC),
  'requireAuth 가 아직 남아 있다. 17곳 maybeAuth + 1곳 requireScope 교체 후 함수 정의를 지울 것');

const EXPECTED_MAYBE = [
  '/api/workflows', '/api/workflows/:id', '/api/workflows/:id/versions',
  '/api/workflows/:id/logs', '/api/workflows/:id/comments',
  '/api/workflows/:id/schedule', '/api/workflows/:id/execute', '/api/workflows/:id/resume',
  '/api/webhook/register', '/api/agents', '/api/agents/:id',
  '/api/approvals/:id/decide', '/api/templates',
  '/api/tests', '/api/tests/:id/result', '/api/tests/:id',
];
for (const p of EXPECTED_MAYBE) {
  const r = routes.find(x => x.path === p);
  check(`${p} → maybeAuth(또는 requireScope)`, r ? (r.conditional || r.guarded) : false,
    'maybeAuth(mcp:execute) 로 교체되지 않았다');
}

// /api/credentials 는 무조건 mcp:admin 이어야 한다 (maybeAuth 아님)
const credsRoute = routes.find(x => x.path === '/api/credentials');
check('/api/credentials → requireScope(mcp:admin)', credsRoute && /requireScope/.test(SRC.match(new RegExp(`app\\.post\\('/api/credentials',[^\\n]*`))?.[0] || ''),
  '/api/credentials 가 maybeAuth 로 열려 있다 — execute 키로 admin 키 발급 가능');
check('/api/credentials 가 maybeAuth 가 아님', credsRoute && !credsRoute.conditional,
  '/api/credentials 에 maybeAuth 가 붙어 있다');

console.log('\n' + (fails.length ? `실패 ${fails.length}건` : '전부 통과'));
const warned = Object.entries(ALLOWED_PUBLIC).filter(([, v]) => v.startsWith('⚠'));
if (warned.length) {
  console.log('\n⚠ 의도적으로 열어둔 항목 중 위험 표시:');
  for (const [k, v] of warned) console.log(`   ${k}\n     ${v}`);
}
process.exit(fails.length ? 1 : 0);
