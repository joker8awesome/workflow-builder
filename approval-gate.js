/**
 * approval-gate.js — 어떤 작업이 사람 승인을 거쳐야 하는가.
 *
 * 범위를 A/B/C 같은 등급 글자로 두지 않는다. 등급은 "무엇이 포함되는가"가
 * 읽는 사람마다 달라져 위험한 쪽으로 오해되기 쉽다. 대신 **작업 이름을 그대로
 * 나열**한다. 설정을 보면 무엇이 사람을 거치는지 한눈에 보인다.
 *
 * 환경 변수:
 *   WF_APPROVAL_REQUIRED  쉼표 구분 작업 목록. 미설정 시 아래 기본값.
 *   예) WF_APPROVAL_REQUIRED=deploy,schema.change
 *
 * 기본값은 **넓게(안전하게)** 잡는다. 좁히는 것은 명시적 선택이어야 한다.
 */

// 알려진 작업 — 게이트에 넣을 수 있는 전체 목록
const KNOWN_ACTIONS = [
  'workflow.execute',   // 워크플로우 실행 (프로덕션 부작용)
  'deploy',             // git pull + pm2 restart
  'credential.issue',   // 자격증명 발급
  'credential.revoke',  // 자격증명 폐기
  'schema.change',      // DB 스키마 변경
  'rollback',           // 배포 되돌리기
  'code.change',        // 코드 수정 반영
  'agent.write',        // 에이전트 레지스트리 변경
];

// 미설정 시 기본 — 되돌리기 어렵거나 외부에 영향이 가는 것 전부
const DEFAULT_REQUIRED = [
  'workflow.execute',
  'deploy',
  'credential.issue',
  'credential.revoke',
  'schema.change',
  'rollback',
];

function requiredActions() {
  const raw = process.env.WF_APPROVAL_REQUIRED;
  if (raw === undefined) return DEFAULT_REQUIRED.slice();
  // 빈 문자열은 "승인 없음"이라는 명시적 선택으로 존중한다
  const list = raw.split(',').map(s => s.trim()).filter(Boolean);
  const unknown = list.filter(a => !KNOWN_ACTIONS.includes(a));
  if (unknown.length) {
    console.warn('[approval] 알 수 없는 작업 이름 무시:', unknown.join(', '),
      '\n            사용 가능:', KNOWN_ACTIONS.join(', '));
  }
  return list.filter(a => KNOWN_ACTIONS.includes(a));
}

/** 이 작업이 사람 승인을 거쳐야 하는가 */
function requiresApproval(action) {
  return requiredActions().includes(action);
}

/** 현재 설정 요약 — 부팅 로그와 상태 API 에서 쓴다 */
function describe() {
  const req = requiredActions();
  return {
    required: req,
    auto: KNOWN_ACTIONS.filter(a => !req.includes(a)),
    source: process.env.WF_APPROVAL_REQUIRED === undefined ? 'default' : 'env',
  };
}

/** 부팅 시 1회 — 자동 통과 항목을 눈에 띄게 남긴다 */
function logConfig() {
  const d = describe();
  console.log(`[approval] 승인 필요(${d.source}): ${d.required.join(', ') || '(없음)'}`);
  if (d.auto.length) {
    console.log(`[approval] ⚠ 자동 통과: ${d.auto.join(', ')}`);
  }
  if (!d.required.length) {
    console.warn('[approval] ⚠⚠ 모든 작업이 승인 없이 실행된다. 의도한 설정인지 확인할 것.');
  }
}

module.exports = { requiresApproval, requiredActions, describe, logConfig, KNOWN_ACTIONS, DEFAULT_REQUIRED };
