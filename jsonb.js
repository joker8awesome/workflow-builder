/**
 * jsonb.js — Postgres JSONB 컬럼을 안전하게 읽는 단일 지점.
 *
 * pg 드라이버는 JSONB 를 이미 자바스크립트 객체로 준다. 그런데 그 객체에
 * JSON.parse() 를 다시 걸면 "[object Object]" 로 강제 변환되어 SyntaxError 가 나고,
 * 빈 catch 가 그걸 삼키면 값이 조용히 {} 가 된다.
 * workflow.list 의 node_count 가 전 행 0 이던 버그가 정확히 이것이었다.
 *
 * 같은 타입 분기를 여러 곳에서 손으로 반복하면 한 곳만 고쳐지고 나머지는 남는다
 * (실제로 mcp-router 와 server 가 각자 다르게 처리하고 있었다). 여기로 모은다.
 *
 * 두 가지 모드를 구분한다 — 이 구분이 이 모듈의 요점이다:
 *
 *   parseJsonb  (관대)  목록·집계용. 한 행이 깨져도 나머지는 보여줘야 한다.
 *                       실패 시 경고를 남기고 fallback 을 반환한다.
 *   parseJsonbStrict    단일 레코드로 실제 동작을 수행하기 직전용.
 *                       실패 시 던진다 — 빈 객체로 "성공"하면 손상을 숨기게 된다.
 *                       (예: 워크플로우 실행 직전에 data 가 깨졌다면,
 *                        노드 0개짜리 실행을 성공으로 보고하는 편이 더 나쁘다)
 */

/**
 * 관대 모드. 실패해도 던지지 않는다.
 * @param {*} value        DB 컬럼 값 (객체 또는 문자열)
 * @param {object} [opts]
 * @param {string} [opts.label]     경고에 남길 이름 (예: 'wf_workflows.data')
 * @param {string} [opts.id]        경고에 남길 행 식별자
 * @param {*}      [opts.fallback]  실패 시 반환값 (기본 {})
 */
function parseJsonb(value, opts = {}) {
  const fallback = 'fallback' in opts ? opts.fallback : {};
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  const s = value.trim();
  if (!s) return fallback;
  try {
    const parsed = JSON.parse(s);
    return parsed == null ? fallback : parsed;
  } catch (e) {
    console.warn(`[jsonb] 파싱 실패 (${opts.label || 'unknown'}${opts.id ? ' id=' + opts.id : ''}): ${e.message}`);
    return fallback;
  }
}

/**
 * 엄격 모드. 실패 시 던진다.
 * 손상된 데이터로 동작을 수행하느니 요청을 실패시키는 편이 낫다.
 */
function parseJsonbStrict(value, opts = {}) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') {
    throw new TypeError(`[jsonb] ${opts.label || 'unknown'}: 예상치 못한 타입 ${typeof value}`);
  }
  const s = value.trim();
  if (!s) return {};
  try {
    return JSON.parse(s) || {};
  } catch (e) {
    const err = new Error(`[jsonb] ${opts.label || 'unknown'}${opts.id ? ' id=' + opts.id : ''} 파싱 실패: ${e.message}`);
    err.code = 'JSONB_PARSE_FAILED';
    throw err;
  }
}

module.exports = { parseJsonb, parseJsonbStrict };
