#!/usr/bin/env node
/**
 * jsonb 헬퍼 검증 + 수제 파싱 재발 가드.
 *
 * pg 는 JSONB 를 이미 객체로 준다. 그 객체에 JSON.parse() 를 다시 걸면
 * "[object Object]" 로 강제 변환되어 SyntaxError 가 난다.
 * workflow.list 의 node_count 가 전 행 0 이던 버그가 이것이었고,
 * 같은 타입 분기를 여러 곳에서 손으로 반복하다 한 곳만 고쳐진 상태였다.
 *
 * 실행: node ops/test-jsonb.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { parseJsonb, parseJsonbStrict } = require(path.join(ROOT, 'jsonb'));

let fails = [];
function check(name, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (!cond && detail ? '\n         ' + detail : ''));
  if (!cond) fails.push(name);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('1) 관대 모드 — 목록·집계용');
check('pg 가 준 객체는 그대로', eq(parseJsonb({ nodes: [1, 2] }), { nodes: [1, 2] }));
check('문자열은 파싱', eq(parseJsonb('{"nodes":[1]}'), { nodes: [1] }));
check('null → fallback', eq(parseJsonb(null), {}));
check('빈 문자열 → fallback', eq(parseJsonb('   '), {}));
check('JSON null → fallback', eq(parseJsonb('null'), {}));
check('배열도 통과', eq(parseJsonb('[1,2]'), [1, 2]));
check('fallback 지정 가능', eq(parseJsonb(null, { fallback: [] }), []));
check('깨진 값은 던지지 않고 fallback', eq(parseJsonb('{bad', { label: 't' }), {}));

console.log('\n2) 실제 버그 재현 — 객체에 JSON.parse 를 걸면');
let raw;
try { JSON.parse({ nodes: [1] }); raw = 'no-throw'; } catch (e) { raw = 'throw'; }
check('맨손 JSON.parse(객체) 는 실패한다', raw === 'throw',
  '이 전제가 깨지면 헬퍼의 존재 이유가 사라진다');
check('헬퍼는 같은 입력을 정상 처리', eq(parseJsonb({ nodes: [1] }), { nodes: [1] }));
check('node_count 계산이 0 이 아니다',
  (parseJsonb({ nodes: [1, 2, 3] }).nodes || []).length === 3);

console.log('\n3) 엄격 모드 — 단일 레코드로 동작 수행 직전');
check('정상 값은 동일하게 반환', eq(parseJsonbStrict({ a: 1 }), { a: 1 }));
check('null 은 {} 로 허용', eq(parseJsonbStrict(null), {}));
let threw = null;
try { parseJsonbStrict('{bad', { label: 'wf.data', id: 'wf_x' }); } catch (e) { threw = e; }
check('깨진 값은 던진다', threw !== null,
  '빈 객체로 "성공"하면 손상을 숨기게 된다');
check('코드로 식별 가능', threw && threw.code === 'JSONB_PARSE_FAILED', threw && threw.code);
check('메시지에 위치 정보', threw && /wf\.data/.test(threw.message) && /wf_x/.test(threw.message),
  threw && threw.message);

console.log('\n4) 재발 가드 — 수제 타입 분기가 남아 있지 않은가');
const TARGETS = ['server.js', 'mcp-router.js', 'credentials-api.js'];
const HANDROLLED = /typeof\s+\w+(\.\w+)*\s*===\s*'string'\s*\?[^\n]*JSON\.parse/;
for (const f of TARGETS) {
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) { console.log(`  SKIP  ${f}`); continue; }
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  const hits = lines
    .map((l, i) => (HANDROLLED.test(l) ? `${f}:${i + 1}  ${l.trim().slice(0, 70)}` : null))
    .filter(Boolean);
  check(`${f} 수제 파싱 없음`, hits.length === 0,
    hits.join('\n         ') + '\n         → jsonb.js 의 parseJsonb / parseJsonbStrict 를 쓸 것');
}

console.log('\n' + (fails.length ? `실패 ${fails.length}건: ${fails.join(', ')}` : '전부 통과'));
process.exit(fails.length ? 1 : 0);
