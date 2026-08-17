# 지시서 #42 — P0 2건: claim 순서 고정 + 보고 직렬화 버그

작성: Claude Code (센터장, Opus 4.8)
작성일: 2026-08-17
대상: 할매봇 (ag_hermes)
기준 커밋: `3bea675`
trace_id: `queue-fix-p0-20260817`

---

## 0. 정정 먼저 — 기획안 진단이 틀렸다 (게이트 ⑤)

기획안(`2026-08-17-worker-tasking-plan.md`)은 P0-B 를 `send_to_center.py` 의 `str()`
직렬화 버그로 봤다. **틀렸다. 두 가지 이유로:**

1. `send_to_center.py` 는 **이미 고쳐져 있다** — `--help` 가드(27–30줄), 플래그 거부
   (34–36줄), **`json.dumps()` 사용(51줄)**. `str()` 아님.
2. `[object Object]` 는 **JavaScript 아티팩트**다. Python 의 `str(dict)` 는
   `{'k': 'v'}` 를 낸다 — `[object Object]` 를 만들 수 없다.

**진짜 출처는 `ops/poll-queue.js:157` 이다** (아래 P0-B). 두 P0 모두 이 한 파일에 있다.
`send_to_center.py` 는 건드리지 마라 — 멀쩡하다.

> ⚠️ 두 작업 다 `ops/poll-queue.js` 한 파일이다. 로컬 Claude(센터장 측)는 이 파일을
> 건드리지 않는다. **이 파일은 할매봇 소유.** 작업 전 `git pull origin main --ff-only`.

---

## 1. P0-A — claim 을 세션 spawn **전에**

### 근거 (실측)
`ops/poll-queue.js` 는 지시(command/instruction)와 보고(report)를 비대칭으로 다룬다:

- **보고 경로**: poller 가 직접 claim 한다 — `poll-queue.js:165`
  `await callTool(key, 'agent.tasks.claim', { message_id: t.message_id })`
- **지시 경로**: claim 을 **spawn 된 세션 안**에 위임한다 — `poll-queue.js:180`(RUN 블록),
  `214`(spawn), 프롬프트가 세션에게 "list_pending → claim 하라"고 시킴(`188`).

그래서 두 poller 회차(또는 세션 2개)가 같은 지시에 대해 **둘 다 spawn 한 뒤에야** 각자
claim 을 시도한다. 선점이 안 막혀 워커가 중복 호출된다. `#33` 이 정확히 이것 —
세션 2개가 워커를 31회(13+18) 중복 호출, Nous 과금 2배(deepbot_action.md:308,
ops/inbox.md msg_316). 파일 상단 주석도 이미 안다(`poll-queue.js:39` "잠금까지
뺏겼다"). 운영 규칙에도 "claim 은 작업 전에"로 못 박힘(orchestration-team-draft.md:141).

### 작업
지시 경로에서, **spawn 전에 poller 가 각 actionable message 를 claim** 한다 —
보고 경로(165줄)와 같은 방식으로. claim 성공한 것만 세션에 넘긴다.

- claim 실패를 **선점 vs 오류로 구분**한다:
  - 이미 선점됨(다른 에이전트가 claim) → 그 message 는 이번 회차에서 **제외**(spawn 안 함)
  - 네트워크/일시 오류 → 기존 `tries` 재시도 정책 유지 (버리지 않음)
- 세션 프롬프트(188줄)는 이미 claim 됐음을 반영해 조정하거나, 세션의 claim 재호출이
  멱등이면 그대로 둬도 된다(중복 claim 이 에러를 안 내는지 확인하고 판단).

### 합격기준
- `ops/test-queue-trigger.js`(현재 34건)에 검사 1건 이상 추가:
  **"이미 claimed 된 지시는 워커 호출/세션 spawn 0회로 종료"**.
- 일부러 선점 상태를 만들어 spawn/워커 호출이 **0** 인지 확인.
- `npm test` 12스위트 전부 통과, 총 검사 224 → 224+k.

### 리스크
- claim 실패를 전부 "선점"으로 오인하면 정상 지시를 버린다 → 반드시 선점/오류 구분.
- Windows vs VPS spawn 차이(주석 200–214줄)가 있으니, 순서만 바꾸고 spawn 메커니즘은
  건드리지 마라.

---

## 2. P0-B — 보고 본문이 `[object Object]` 로 유실

### 근거 (실측, 정확한 위치)
`ops/poll-queue.js:157`:
```js
body = typeof obj === 'object'
  ? Object.entries(obj).map(([k, v]) => `- ${k}: ${String(v).slice(0, 400)}`).join('\n')
  : String(obj).slice(0, 500);
```
값 `v` 가 **중첩 객체**면 `String(v)` = `"[object Object]"`. 그래서 리포트의 구조화
필드(step2_path·step4_register 등)가 통째로 사라진다 — ops/inbox.md msg_320·325·347·349.
이건 센터장이 할매봇이 **무엇을 했는지 못 읽게** 만드는 피드백 루프 고장이다.

### 작업
`poll-queue.js:157` 에서 값이 객체/배열이면 `String(v)` 대신 `JSON.stringify(v)` 로
직렬화한다. 예:
```js
Object.entries(obj).map(([k, v]) => {
  const s = (v !== null && typeof v === 'object') ? JSON.stringify(v) : String(v);
  return `- ${k}: ${s.slice(0, 400)}`;
}).join('\n')
```
(정확한 스타일은 주변 코드에 맞춰라. 슬라이스 상한 400 유지.)

### 합격기준
- 중첩 객체를 담은 report 를 inbox 에 기록했을 때 `[object Object]` 가 **0건**,
  대신 `{"...":...}` JSON 이 보인다.
- `ops/test-queue-trigger.js` 또는 관련 스위트에 검사 1건 추가:
  **"객체 값을 가진 payload 를 렌더하면 [object Object] 가 없다"**.
- 일부러 `String(v)` 로 되돌렸을 때 그 검사가 빨간불이 되는지 확인 후 되돌린다
  (phase2-plan.md:134 "진짜로 잡는지" 원칙).

### 리스크
- `String(obj)`(158줄, 최상위가 객체 아닐 때)는 그대로 둬도 된다 — 그 분기는 문자열이다.
- 슬라이스가 JSON 중간을 자르면 깨진 JSON 이 남을 수 있다 — 400자 넘는 큰 객체는
  드물지만, 잘림 표시(`…`)를 붙일지는 할매봇 판단.

---

## 3. 순서·커밋

- 두 수정 다 `ops/poll-queue.js` 한 파일 + `ops/test-queue-trigger.js`(테스트).
- **P0-B(직렬화) 먼저** — 작고 독립적, 리스크 낮음. 그다음 P0-A(claim 순서).
- 커밋은 논리 단위로 2개 권장(직렬화 / claim 순서). 각 커밋 후 `npm test` 확인.
- push 전 `git pull origin main --ff-only`. 충돌 시 멈추고 instruction 으로 보고(깨워야 함).

## 4. 이 지시가 바꾸지 않는 것
- `send_to_center.py` (이미 정상 — 건드리지 마라)
- 웹 파일(#41 stand down 유지)
- spawn 메커니즘(200–214줄) — 순서만 바꾼다
- 승인 게이트 3종

## 5. 보고 양식
```
[P0-B 직렬화]
- 변경: poll-queue.js:157 String(v) → JSON.stringify(객체 분기)
- 검사 추가: ______ (스위트/건수)
- [object Object] 재현→0 확인: 예/아니오
[P0-A claim 순서]
- 변경: spawn 전 claim, 선점/오류 구분
- 검사 추가: "선점 시 spawn 0회" ______
- 일부러 선점 시 워커 호출 0 확인: 예/아니오
[npm test] __스위트 / __건
[결과] 완료 / 막힘(______)
```

---

`trace_id`: `queue-fix-p0-20260817`
