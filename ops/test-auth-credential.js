#!/usr/bin/env node
/**
 * auth-credential 검증 — DB 없이 스텁으로 확인.
 *
 * 실행: node ops/test-auth-credential.js
 */
const path = require('path');
const { parseScopes, requireScope } = require(path.join(__dirname, '..', 'auth-credential'));

let fails = [];
function check(name, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) fails.push(name);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('1) parseScopes — 실제 DB 형태');
check('Postgres 배열 리터럴',
  eq(parseScopes('{"mcp:read","mcp:execute"}'), ['mcp:read', 'mcp:execute']),
  JSON.stringify(parseScopes('{"mcp:read","mcp:execute"}')));
check('admin 포함 3종',
  eq(parseScopes('{"mcp:read","mcp:execute","mcp:admin"}'), ['mcp:read', 'mcp:execute', 'mcp:admin']));
check('이미 배열이면 그대로', eq(parseScopes(['mcp:read']), ['mcp:read']));
check('JSON 배열 문자열', eq(parseScopes('["mcp:read"]'), ['mcp:read']));
check('null/빈값', eq(parseScopes(null), []) && eq(parseScopes(''), []) && eq(parseScopes(undefined), []));

console.log('\n2) 부분 문자열 오판 방지 (기존 .includes 버그)');
const s = parseScopes('{"mcp:read","mcp:execute"}');
check('admin 없음을 정확히 판정', s.includes('mcp:admin') === false);
check('부분 문자열 mcp:exec 는 불일치', s.includes('mcp:exec') === false,
  '문자열이었다면 true 가 되어 통과했을 것');
check('mcp:read 는 일치', s.includes('mcp:read') === true);
// 문자열 그대로 썼을 때 실제로 오판이 나는지 대조
const raw = '{"mcp:read","mcp:execute"}';
check('대조: 문자열 .includes 는 mcp:exec 를 통과시킨다', raw.includes('mcp:exec') === true,
  '이 검사가 실패하면 전제가 바뀐 것');

console.log('\n3) requireScope 미들웨어');
const db = {
  query: async (sql, params) => {
    if (sql.includes('SELECT agent_id')) {
      const hash = params[0];
      if (hash === HASH_OK) return { rows: [{ agent_id: 'ag_admin', scopes: '{"mcp:read","mcp:admin"}', expires_at: null }] };
      if (hash === HASH_LOW) return { rows: [{ agent_id: 'ag_low', scopes: '{"mcp:read"}', expires_at: null }] };
      if (hash === HASH_EXP) return { rows: [{ agent_id: 'ag_exp', scopes: '{"mcp:admin"}', expires_at: '2000-01-01' }] };
      return { rows: [] };
    }
    return { rows: [] };
  },
};
const crypto = require('crypto');
const h = s => crypto.createHash('sha256').update(s).digest('hex');
const HASH_OK = h('KEY_ADMIN'), HASH_LOW = h('KEY_READONLY'), HASH_EXP = h('KEY_EXPIRED');

function run(mw, headers) {
  return new Promise(resolve => {
    const req = { headers };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b, passed: false }); },
    };
    mw(req, res, () => resolve({ status: 200, body: null, passed: true, agent: req.agent_id, scopes: req.scopes }));
  });
}

(async () => {
  const mw = requireScope(db, 'mcp:admin');

  let r = await run(mw, {});
  check('헤더 없음 → 401', r.status === 401 && !r.passed, JSON.stringify(r));

  r = await run(mw, { authorization: 'Bearer WRONG' });
  check('없는 키 → 401', r.status === 401 && !r.passed);

  r = await run(mw, { authorization: 'Bearer KEY_READONLY' });
  check('스코프 부족 → 403', r.status === 403 && !r.passed, JSON.stringify(r.body));

  r = await run(mw, { authorization: 'Bearer KEY_EXPIRED' });
  check('만료된 키 → 401', r.status === 401 && !r.passed, JSON.stringify(r.body));

  r = await run(mw, { authorization: 'Bearer KEY_ADMIN' });
  check('admin 키 → 통과', r.passed === true && r.agent === 'ag_admin', JSON.stringify(r));

  console.log('\n4) WF_ACCESS_TOKEN 복구 경로');
  const mwTok = requireScope(db, 'mcp:admin', { allowAccessToken: true });
  process.env.WF_ACCESS_TOKEN = 'ROOT_SECRET';
  r = await run(mwTok, { authorization: 'Bearer ROOT_SECRET' });
  check('토큰 일치 → 통과 (ag_root)', r.passed === true && r.agent === 'ag_root', JSON.stringify(r));

  r = await run(mw, { authorization: 'Bearer ROOT_SECRET' });
  check('opt-in 안 한 미들웨어는 토큰 거부', r.passed === false && r.status === 401);

  delete process.env.WF_ACCESS_TOKEN;
  r = await run(mwTok, { authorization: 'Bearer ROOT_SECRET' });
  check('토큰 미설정이면 우회 불가', r.passed === false,
    '미설정 상태에서 통과하면 누구나 아무 문자열로 admin 이 된다');

  console.log('\n' + (fails.length ? `실패 ${fails.length}건: ${fails.join(', ')}` : '전부 통과'));
  process.exit(fails.length ? 1 : 0);
})();
