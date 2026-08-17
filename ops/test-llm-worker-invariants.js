#!/usr/bin/env node
/**
 * /api/llm/worker 불변식 정적 검사 — 과금·환각 길목의 계약을 소스에서 고정한다.
 *
 * 이 라우트는 외부 LLM(Nous) 을 호출해 실제 비용이 나가는 경로다.
 * 런타임(HTTP 부팅) 검증은 CI 불변식(DB·네트워크 없음)과 충돌하므로 이 스위트는
 * "불변식이 코드에 배선돼 있음"까지만 증명한다 — 실동작은 별도 하네스 범위다.
 *
 * 검증 대상 (지시서 #43-D, server.js:1727~1808):
 *   1. max_tokens 클램프 — 하한 100 · 상한 4000 리터럴 존재
 *   2. truncated 플래그 — 응답과 report 양쪽에 노출
 *   3. LLM 호출 실패(!r.ok) — 502 응답 + report(status='pending') 기록
 *
 * #25 때 404 를 success:true 로 포장한 버그가 바로 이 라우트다 — 회귀선을 지킨다.
 *
 * 실행: node ops/test-llm-worker-invariants.js
 */
const fs = require('fs');
const path = require('path');

const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// 워커 핸들러 본문만 잘라낸다 — 파일 전체를 보면 다른 라우트의 리터럴에 오탐이 난다.
const START = "app.post('/api/llm/worker'";
const startIdx = SRV.indexOf(START);
if (startIdx < 0) {
  console.log('FAIL  핸들러를 찾지 못함');
  process.exit(1);
}
// 핸들러 끝은 "    res.json({" 뒤에 등장하는 "  });" 를 찾아 잘라내기보다,
// 다음 최상위 "// ===" 주석 섹션 직전까지로 잡는 게 안전하다.
const rest = SRV.slice(startIdx);
const nextSection = rest.indexOf('\n\n// ===');
const body = nextSection > 0 ? rest.slice(0, nextSection) : rest;

let fails = [];
function check(name, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (!cond && detail ? '\n         ' + detail : ''));
  if (!cond) fails.push(name);
}

console.log('1) max_tokens 클램프 — 상·하한 리터럴');
// server.js:1737  Math.min(Math.max(Number(max_tokens) || 1500, 100), 4000)
check('하한 100 존재', /Math\.max\(Number\(max_tokens\)\s*\|\|\s*1500,\s*100\)/.test(body),
  '하한 리터럴 100 이 없다 — 클램프 하한이 풀렸다');
check('상한 4000 존재', /Math\.min\([^;]*,\s*4000\)/.test(body),
  '상한 리터럴 4000 이 없다 — 클램프 상한이 풀렸다');
check('기본값 1500 존재', /Number\(max_tokens\)\s*\|\|\s*1500/.test(body),
  '기본값 1500 이 없다 — max_tokens 미지정 시 폭주할 수 있다');

console.log('\n2) truncated 플래그 — 응답과 report 양쪽 노출');
// server.js:1792  finish_reason === 'length'
check('절단 조건이 finish_reason==="length" 로 배선',
  /finish_reason === 'length'/.test(body),
  '절단 판정이 사라졌다 — 잘린 답을 완성된 답으로 읽게 된다');
// server.js:1800  report payload { result, ok:!truncated, truncated }
check('report 에 ok:!truncated + truncated 기록',
  /ok: !truncated, truncated/.test(body),
  'report 가 절단을 알리지 않는다 — 로그를 봐도 미완성인지 모른다');
// server.js:1803~1806  응답에 truncated, max_tokens 노출
check('응답에 truncated + max_tokens 노출',
  /truncated, max_tokens: maxTokens/.test(body),
  '응답이 절단을 알리지 않는다 — 호출자가 미완성 답을 결론으로 쓴다');

console.log('\n3) 실패 경로 — 502 응답 + report(status=pending)');
// server.js:1769  if (!r.ok || !text)
check('실패 판정이 !r.ok || !text',
  /!\s*r\.ok\s*\|\|\s*!text/.test(body),
  '실패를 감지 못 하면 제공자 오류가 성공으로 포장된다');
// server.js:1780  502 llm_failed
check('실패 시 502 + llm_failed 응답',
  /res\.status\(502\)\.json\(\{ success: false, error: 'llm_failed'/.test(body),
  '오류를 success:true 로 돌려주면 워커 결과를 믿는 쪽이 거짓을 받는다');
// server.js:1775~1777  report INSERT ... 'pending'
check('실패 report 도 status=pending 으로 기록',
  /VALUES \('report', \$1, \$2, \$3, 'pending', \$4\)/.test(body),
  '실패 보고가 pending 이 아니면 큐에서 보이지 않는다');
check('실패 report payload 가 ok:false',
  /ok: false, error: detail/.test(body),
  'ok:true 로 남으면 나중에 로그를 봐도 실패를 못 찾는다');

console.log('\n' + (fails.length ? `실패 ${fails.length}건: ${fails.join(', ')}` : '전부 통과'));
process.exit(fails.length ? 1 : 0);
