# 지시서 #43 — P1 4건: 세션 정리 · 워커 불변식 테스트 · Kimi 리뷰 2건

작성: Claude Code (센터장, Opus 4.8)
작성일: 2026-08-17
대상: 할매봇 (ag_hermes) — C·D 직접, H·I 는 Kimi 배분
기준 커밋: `0cc8c12`
trace_id: `p1-batch-20260817`

---

## 0. 선행·순서

- **선행: 지시서 #42(P0) 완료 후 착수.** #42 와 이 지시서 둘 다 `ops/run-tests.js`
  SUITES 를 건드린다 — 겹치면 그 한 줄에서 충돌한다. #42 를 먼저 끝내고 pull 한 뒤 시작.
- 큐 규칙: 지시서는 순차. 이 안의 4단위는 묶어 받되 **단위별로 보고**한다.
- **착수 순서**: I(Kimi 워커 케이스) → D(그 케이스로 정적 테스트) → H(Kimi 폴백 리뷰) → C(세션 정리).
  I 가 D 를 먹인다. C 는 독립이나 server.js 편집이라 마지막(다른 server.js 작업과 직렬).
- 작업 전 `git pull origin main --ff-only`. 웹 파일은 #41 stand down 유지(안 건드림).

---

## 1. P1-C — `agent_sessions` 무한 누적 정리 경로 (할매봇, server.js)

### 근거 (실측)
- `POST /api/sessions` → `INSERT INTO agent_sessions ... id=sess_+Date.now()` (server.js:1158)
- `DELETE FROM agent_sessions` 는 **파일 전체 0회** (`grep -c` = 0). 만료 로직 없음.
- GET 은 가릴 뿐: `SELECT * FROM agent_sessions ORDER BY created_at DESC LIMIT 50` (server.js:1169)
- 실제 누적: 19→43→46 (deepbot_action.md:201·346).

### 작업
오래된 **종료** 세션(`done`/`failed` 이고 N일 경과, 예: 7일) 정리 경로 하나. 택1(할매봇 판단):
- (a) scheduler 폴링에 하루 1회 sweep, 또는 (b) 관리용 `DELETE` 라우트 + 승인 게이트.
- **먼저 현재 세션 수·상태 분포를 실측 보고** 후 착수:
  `SELECT status, count(*) FROM agent_sessions GROUP BY status`

### 🔒 승인 게이트
- **코드 구현은 자동 통과.** 하지만 **실제 프로덕션 DB 삭제 실행은 승인 게이트 대상**이다.
  구현 → 드라이런(삭제 대상 건수만 SELECT 로 보고) → 승인 후 실삭제.

### 합격기준
- sweep 후 `done`/`failed` 만 줄고 `running`(활성 어휘 `ACTIVE_STATUSES`)은 **보존**됨을 확인.
- `ops/` 에 정적 검사 1건 추가(예: "삭제 경로가 ACTIVE 상태를 제외한다"는 소스 불변식).
- `npm test` 전 스위트 통과.

### 리스크
- `running` 을 지우면 진행 중 기록 소멸 → 활성 어휘 절대 제외. 시간 기준 넉넉히(7일).
- 이 세션들은 orchestrator 시뮬레이션 기록이다(기획안 §4) — 삭제가 다른 지표를 흔드는지 확인.

---

## 2. P1-D — `/api/llm/worker` 불변식 정적 테스트 (할매봇, ops/)

### 근거 (실측)
`/api/llm/worker`(server.js:1727)는 과금·환각 길목인데 검증이 인증 래핑 정적 확인
하나뿐이다. 미검증 불변식:
- `max_tokens` 클램프 `Math.min(Math.max(..,100),4000)` (server.js:1737)
- `truncated` = `finish_reason==='length'` 배선 (server.js:1792), 응답·report 노출(1800·1805)
- 실패 시 502 + report(status='pending') (server.js:1769~1780)
- `#25` 때 404 를 `success:true` 로 포장한 버그가 바로 이 라우트(deepbot_action.md:262) — 회귀선 필요.

### 작업
`ops/test-route-auth.js` / `ops/test-message-status.js` 와 **같은 정적 소스 검사 방식**
(DB·네트워크 불필요 — run-tests.js:16 CI 불변식)으로 신규 스위트:
- 클램프 상·하한 리터럴(100·4000) 존재
- `truncated` 가 응답과 report 에 노출됨
- `!r.ok` 실패 시 502 + report 기록(status='pending') 존재
run-tests.js SUITES 에 등록(**#42 의 run-tests.js 수정과 겹치니 pull 후 마지막에**).

### 합격기준
- 12→13 스위트, 총 검사 +k. 일부러 클램프 상한 리터럴을 지웠을 때 빨간불 되는지 확인 후 되돌림
  (phase2-plan.md:134 "진짜로 잡는지").

### 리스크
- 정적 검사는 "불변식이 코드에 배선됨"까지만 증명한다. 실제 런타임 동작(HTTP 부팅)은
  CI 불변식(DB·네트워크 없음)과 충돌하니 이 스위트 범위 밖 — 별도 하네스는 미기획(§4).

---

## 3. P1-H — Kimi 리뷰: `callLLMWithFallback` 이 사용자를 속이는가

> Kimi 는 파일을 못 본다. **아래 코드를 프롬프트에 붙여** 배분한다. 함수당 1회, truncated 면 재호출.

### 근거 (실측)
server.js:32~57. 폴백이 다른 모델이 아니라 하드코딩이다:
- no-auth: `return { fallback: true, error: 'no auth' }` — **`data` 없음** (server.js:34)
- catch: `return { provider:'rule-based', ok:true, fallback:true, data:{choices:[{message:{content: opts.ruleFallback||'NO'}}]}}` (server.js:48) — **`ok:true`** 로 `'NO'` 를 진짜 답처럼 반환.
- `/api/fallback-log` 0건 — 이 경로 실전 미검증(model-swap-feasibility.md:118).

### Kimi 프롬프트 골격
```
아래는 server.js 의 callLLMWithFallback 함수 전문이다.

```js
<server.js:32~55 전문을 붙여넣는다>
```

이 함수에서 조용히 실패할 수 있는 지점은 어디인가?
그 지점이 실패했을 때, 이 함수를 호출한 쪽은 무엇을 잘못 믿게 되는가?
코드 수정안이 아니라 결과를 말해라.

형식:
앵커: <위 코드에서 그대로 복사한 한 줄>
제안: <설명>

위 코드에 없는 함수·파일·설정은 언급하지 마라.
확실하지 않으면 "확실하지 않음"이라고 답하라. 추측하지 마라.
```
### 합격기준/리스크
- 앵커가 server.js 에 실재하는지 `grep`(게이트 ①②). 채택은 "호출처가 잘못 믿는다"일 때만.
- 수정 범위는 할매봇 판단(예: 폴백 발동 시 응답에 `fallback:true` 를 호출처가 반드시 보게,
  no-auth 분기에 `data` 형태 통일). **거짓 전제 금지** — 없는 헬퍼 심지 마라.

---

## 4. P1-I — Kimi: `/api/llm/worker` 핸들러 테스트 케이스 도출 (D 를 먹인다)

### 근거
Kimi 는 경계·실패 케이스 도출에 강하다(capability §P4). D 의 정적 테스트를 쓰기 전
케이스를 먼저 뽑으면 빠뜨림이 준다.

### Kimi 프롬프트 골격
```
아래는 server.js 의 POST /api/llm/worker 핸들러 전문이다.

```js
<server.js:1727~1808 전문>
```

이 핸들러의 경계·실패 케이스를 목록으로 도출하라.
특히 max_tokens 클램프 경계(하한 100·상한 4000), truncated 플래그가 서는 조건,
LLM 호출 실패(!r.ok) 시 응답과 report 기록을 각각 케이스로.
코드에 실재하는 값만 써라. 없는 것은 지어내지 마라.
```
### 합격기준/리스크
- 케이스가 실제 값(100·4000·`finish_reason==='length'`·502)을 참조하는지 확인.
  지어낸 값이 있으면 그 케이스만 버린다. 출력 길어 절단 위험 → max_tokens 3000, truncated 면 재호출.

---

## 5. 보고 양식 (단위별)
```
[I Kimi 워커 케이스] 도출 __건 / 지어낸 값 버림 __건 / 채택 __건
[D 워커 불변식 테스트] 신규 스위트 __건 / 12→13 / 일부러 깨서 잡힘: 예·아니오
[H Kimi 폴백 리뷰] 앵커 실재 __/__ / 채택 __건 / 반려(환각 __) / 적용 범위 ______
[C 세션 정리] 현재 분포 ______ / 방식 (a·b) / 드라이런 삭제대상 __건 / 승인요청함: 예
[npm test] __스위트 / __건
[막힘] ______
```

## 6. 안 바꾸는 것
- 웹 파일(#41 stand down) · `send_to_center.py`(정상) · spawn 메커니즘 · 승인 게이트 3종
- P1-C 실삭제는 승인 전 실행 금지

---

`trace_id`: `p1-batch-20260817`
