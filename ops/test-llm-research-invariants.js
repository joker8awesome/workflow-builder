#!/usr/bin/env node
/**
 * /api/llm/research 불변식 정적 검사 + ssrf-guard 단위 검사 (지시서 #46).
 *
 * 이 라우트는 외부 LLM(Nous) + 외부 웹 조회를 수행해 비용·보안이 함께 나가는 경로다.
 * - SSRF 방어(사설망·클라우드 메타데이터 차단) 상수가 코드에 배선돼 있는지
 * - used_sources 감사 게이트(출처 없는 합성 답 반려)가 배선돼 있는지
 * 를 소스에서 고정한다. 런타임(HTTP 부팅) 검증은 CI 불변식(네트워크 없음)과 충돌하므로
 * "불변식이 코드에 배선돼 있음" + "순수 판정(IP 분류)이 정확함" 까지만 증명한다.
 *
 * DNS 해석 검증(validateWebUrl 의 호스트명 → 사설 IP 차단)은 네트워크가 필요하므로
 * 여기서는 IP 리터럴·스킴·호스트명 리터럴 경로(네트워크 불필요)만 검사한다.
 *
 * 실행: node ops/test-llm-research-invariants.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const { isPrivateIP, isInternalHostname, validateWebUrl } = require(path.join(ROOT, 'ssrf-guard.js'));

let fails = [];
function check(name, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (!cond && detail ? '\n         ' + detail : ''));
  if (!cond) fails.push(name);
}

// --- 1) server.js 정적 검사 (research 블록 전체: 헬퍼 + 엔드포인트) ---
const BLOCK_START = '// === 웹 리서치 워커';
const blockStartIdx = SRV.indexOf(BLOCK_START);
const body = blockStartIdx >= 0 ? SRV.slice(blockStartIdx).split('\n// === LLM 프록시')[0] : '';

console.log('1) /api/llm/research 불변식 (정적)');
check('requireScope 로 인증 보호', /app\.post\('\/api\/llm\/research',\s*requireScope\(\s*pool,\s*'mcp:execute'/.test(body),
  '인증이 없으면 공개 LLM+웹 프록시가 된다');
check('rate limit 배선 (분당 10회)', /rateLimit\('research:/.test(body),
  '폭주 방지가 없으면 비용이 새 나간다');
check('used_sources 가 응답에 포함', /used_sources/.test(body),
  '출처 기록이 없으면 검증 불가 답을 구분 못 한다');
check('no_sources_used 게이트 존재', /no_sources_used/.test(body),
  '출처 없는 합성 답을 성공으로 포장한다');
check('web_search 도구 존재', /name:\s*'web_search'/.test(body),
  '검색 도구가 빠졌다');
check('web_fetch 도구 존재', /name:\s*'web_fetch'/.test(body),
  '조회 도구가 빠졌다');
check('max_iters 상한 10 클램프', /Math\.min\(Math\.max\(Number\(max_iters\)\s*\|\|\s*5,\s*1\),\s*10\)/.test(body),
  '무한루프 방지 상한이 없다');
check('SSRF validateWebUrl 사용 (webFetchBackend)', /validateWebUrl\(url\)/.test(body),
  'SSRF 검증 없이 URL 을 가져오면 사설망이 샌다');
check('fetch 개수 상한 8', /FETCH_COUNT_LIMIT\s*=\s*8/.test(body),
  'fetch 폭주 상한이 없다');
check('fetch 본문 truncate 20KB', /FETCH_TEXT_LIMIT\s*=\s*20000/.test(body),
  '응답 본문을 자르지 않으면 메모리가 샌다');
check('리다이렉트 매 홉 재검사 (redirect: manual)', /redirect:\s*'manual'/.test(body),
  '리다이렉트를 따라가며 재검사하지 않으면 우회된다');
check('엔진 venv 파이썬 경로 (ENGINE_PYTHON)', /ENGINE_PYTHON/.test(body),
  '시스템 python3(curl_cffi 미설치)로 호출하면 엔진이 조용히 실패한다');
check('엔진 curl-only 호출 (--no-playwright)', /--no-playwright/.test(body),
  'node/playwright 폴백이 서버 fetch 경로에서 느린 브라우저를 띄운다');
check('엔진 JSON 본문 파싱 (j.content)', /j\.content/.test(body),
  '엔진 --json 출력에서 본문을 안 꺼내면 메타데이터만 LLM에 간다');
check('엔진 최종 URL SSRF 재검증 (final_url)', /validateWebUrl\(j\.final_url\)/.test(body),
  '엔진이 내부 리다이렉트를 따라가도 최종 URL 을 재검증하지 않으면 우회된다');

// --- 2) ssrf-guard — isPrivateIP 순수 판정 (네트워크 없음) ---
console.log('\n2) isPrivateIP — 사설/공인 분류');
const private4 = ['127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1'];
for (const ip of private4) check(`${ip} → 사설`, isPrivateIP(ip), '사설 IP 를 통과시킨다 (SSRF 허점)');
const private6 = ['::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1'];
for (const ip of private6) check(`${ip} → 사설`, isPrivateIP(ip), '사설 IPv6 를 통과시킨다 (SSRF 허점)');
const publicIp = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '192.169.0.1'];
for (const ip of publicIp) check(`${ip} → 공인`, !isPrivateIP(ip), '공인 IP 를 오차단한다');

// --- 3) validateWebUrl — 네트워크 불필요 경로만 ---
console.log('\n3) validateWebUrl — 스킴·IP 리터럴·호스트명 리터럴');
(async () => {
  const cases = [
    ['file:///etc/passwd', true, '파일 스킴을 통과시킨다'],
    ['ftp://example.com/file', true, 'ftp 스킴을 통과시킨다'],
    ['http://127.0.0.1/', true, '루프백 IP 를 통과시킨다'],
    ['http://169.254.169.254/latest/meta-data', true, '클라우드 메타데이터를 통과시킨다'],
    ['https://localhost/', true, 'localhost 를 통과시킨다'],
    ['http://10.0.0.1:8080/', true, '사설 IP 를 통과시킨다'],
    ['not a url', true, '형식 오류를 통과시킨다'],
  ];
  for (const [u, shouldReject, detail] of cases) {
    const v = await validateWebUrl(u);
    const rejected = !!v.error;
    check(`${u} → ${shouldReject ? '거부' : '통과'}`, rejected === shouldReject,
      shouldReject ? detail : '정상 URL 을 거부한다: ' + v.error);
  }
  check('isInternalHostname("foo.internal") → 내부', isInternalHostname('foo.internal'), '내부 서픽스를 놓친다');
  check('isInternalHostname("example.com") → 공개', !isInternalHostname('example.com'), '공개 호스트명을 오차단한다');

  console.log('\n' + (fails.length ? `실패 ${fails.length}건: ${fails.join(', ')}` : '전부 통과'));
  process.exit(fails.length ? 1 : 0);
})();
