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

  // --- 아래는 웹 UI 가 인증 없이 호출 중이라 지금 막으면 UI 가 깨진다 ---
  // 팀 도구 전환 3단계(REST 전체 스코프 적용)에서 프론트 키 전달과 함께 처리한다.
  // 2026-08-15-team-tool-plan.md 참조.
  '/api/ai/generate': '⚠ 유료 LLM 호출. UI 사용 중 — 팀 도구 3단계에서 보호할 것',
  '/api/ai/decide': '⚠ 유료 LLM 호출. UI 사용 중 — 팀 도구 3단계에서 보호할 것',
  '/api/exec': '⚠ UI 사용 중 — 팀 도구 3단계',
  '/api/connector': 'rateLimit 있음. UI 사용 중 — 팀 도구 3단계',
  '/api/agent/report': 'UI/에이전트 사용 중 — 팀 도구 3단계',
  '/api/agent/command': 'UI 사용 중 — 팀 도구 3단계',
  '/api/workflows/:id/results': 'UI 사용 중 — 팀 도구 3단계',
  '/api/workflows/:id/run': 'UI 사용 중 — 팀 도구 3단계',
  '/api/approvals': '에이전트·스케줄러가 승인 요청 생성. 결정(/decide)은 인증 필요',
  '/api/knowledge': 'UI 사용 중 — 팀 도구 3단계',
  '/api/sessions': 'UI 사용 중 — 팀 도구 3단계',
  '/api/sessions/:id': 'UI 사용 중 — 팀 도구 3단계',
  '/api/messages': 'UI 사용 중 — 팀 도구 3단계',
  '/api/redact': 'UI 사용 중 — 팀 도구 3단계',
  '/api/audit': 'UI 사용 중 — 팀 도구 3단계',
  '/api/templates/:id/install': 'UI 사용 중 — 팀 도구 3단계',
  '/api/cache/get': 'UI 사용 중 — 팀 도구 3단계',
  '/api/cache/put': 'UI 사용 중 — 팀 도구 3단계',
  '/api/schedule/parse': 'UI 사용 중 — 팀 도구 3단계',
  '/api/examples/install': 'UI 사용 중 — 팀 도구 3단계',
  '/api/feedback': 'UI 사용 중 — 팀 도구 3단계',
};

let fails = [];
function check(name, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (!cond && detail ? '\n         ' + detail : ''));
  if (!cond) fails.push(name);
}

// 인라인 미들웨어 형태
const routes = [];
for (const m of SRC.matchAll(/app\.(post|put|delete|patch)\(\s*'([^']+)'\s*,([^\n]*)/g)) {
  routes.push({ method: m[1].toUpperCase(), path: m[2], guarded: /requireAuth|requireScope/.test(m[3]) });
}
// 별도 줄로 거는 형태: app.post('/x', requireAuth);
const preGuarded = new Set(
  [...SRC.matchAll(/app\.(?:post|put|delete|patch)\('([^']+)',\s*requireAuth\);/g)].map(m => m[1])
);

const unguarded = routes.filter(r => !r.guarded && !preGuarded.has(r.path));
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

console.log('\n' + (fails.length ? `실패 ${fails.length}건` : '전부 통과'));
if (Object.values(ALLOWED_PUBLIC).some(v => v.startsWith('⚠'))) {
  console.log('\n⚠ ALLOWED_PUBLIC 에 유료 LLM 라우트가 남아 있다 (팀 도구 3단계 대상)');
}
process.exit(fails.length ? 1 : 0);
