# 할매봇·Kimi 워커 업무 기획안

작성: 로컬 Claude 워커 (기획 담당)
작성일: 2026-08-17
기준 커밋: `4d8374b`
성격: **기획안이다. 지시서가 아니다.** 자동 픽업 대상이 되면 안 되므로 `handoff-N` 이름을 쓰지 않았다.

> 이 문서의 모든 항목은 저장소를 실제로 읽어 file:line 으로 근거를 달았다. 확인 못 한 것은 §4 에 모았다.
> **웹 파일(index.html·js/·css/·sw.js) 업무는 기획하지 않았다** — 지시서 #41 로 로컬 Claude 담당(stand down)이다.

> 🔴 **정정 (2026-08-17, 지시서 #42 에서 확인):** 아래 **P0-B 진단이 틀렸다.**
> `send_to_center.py` 는 이미 `json.dumps()` 로 정상이고, `[object Object]` 는 JS 아티팩트라
> Python 이 만들 수 없다. 실제 출처는 `ops/poll-queue.js:157` `String(v)` 였다.
> 정정된 지시는 `2026-08-17-hermes-handoff-42.md` 참조. 이 기획안은 원본 기록으로 보존한다.

---

## 0. 탐색 요약 (무엇을 읽었나)

| 읽은 것 | 얻은 것 |
|---|---|
| `2026-08-16-deepseek-worker-capability.md` (전문 + Kimi 부록) | Kimi 능력·한계 실측. 코드 붙이면 리뷰 강함, 이름만 물으면 거부, 거짓 전제는 못 거른다 |
| `deepbot_action.md` (355줄 전체) | 미해결 항목·반복 사고·오늘까지의 상태 |
| `2026-08-17-hermes-handoff-39/40/41.md` | #39=전부 js/(웹, 제외), #41=웹 stand down, #40=Phase1 배치 |
| `2026-08-17-orchestration-team-draft.md` | §7 VPS 실측 과제(할매봇용 금맥), 로스터=시뮬레이션 |
| `2026-08-17-model-swap-feasibility.md` | server.js:1744 워커모델, callLLMWithFallback 폴백=하드코딩 |
| `2026-08-16-worker-fleet-plan.md`, `phase2-plan.md`, `web-ux-directive.md` | 워커 운용 규칙·게이트·과거 배분 방식 |
| `ops/inbox.md` (794줄), `ops/run-tests.js`, `ops/test-no-silent-catch.js` | 리포트 실태·테스트 12스위트 구조·백엔드 파일 7종 |
| **서브에이전트 실측**: `server.js`(1,951줄), `mcp-router.js`(326줄), `agent_orchestrator.py`(462줄), `ops/*` 테스트, `package.json` | 라우트 전수·세션 정리 부재·동작테스트 0·orchestrator 시뮬레이션 확정 |

**핵심 판정 3가지 (근거 기반):**
1. **server.js 는 세션을 만들기만 하고 지우지 않는다** — `INSERT INTO agent_sessions`(server.js:1158) 은 있는데 `DELETE FROM agent_sessions` 는 파일 전체에 **0회**. GET 은 `LIMIT 50`(server.js:1164)으로 가릴 뿐. 세션은 19→43→46 으로 누적됐다(deepbot_action.md:201).
2. **server.js 라우트를 HTTP 로 실제 실행하는 테스트가 하나도 없다** — 커버리지는 전부 정적 소스 검사 아니면 목(mock) 서버 재구현이다. `/api/llm/worker`(server.js:1727)는 인증 래핑 정적 확인만 있고, `max_tokens` 상한·`truncated` 플래그·502 실패 보고 로직은 **미검증**.
3. **`callLLMWithFallback` 의 "폴백"은 다른 모델이 아니라 하드코딩 문자열 `'NO'`**(server.js:48). `/api/fallback-log`(server.js:57) 는 0건 — 이 경로는 한 번도 검증된 적이 없다.

---

## 1. 할매봇용 업무 (파일·git·DB·ops·VPS 필요)

> 할매봇은 VPS Docker `hermes -z` 세션. 파일 접근 O, git·pm2·PostgreSQL·셸 O. 5분 폴링.
> 합격기준은 저장소 통화로 적었다 — **`npm test` 스위트/건수**(현재 12스위트 223건)와 실측 명령 결과.

### P0-A. 큐 claim 을 작업 **전에** 하도록 순서 고정

- **근거**: `#33` 에서 같은 지시로 세션이 2개 떴고, 한 세션이 13개 함수를 **다 돌린 뒤에야** `claimed_by:ag_other` 를 확인했다(deepbot_action.md:308). claim 이 선점을 못 막아 워커를 31회(=13+18) 중복 호출했다 — Nous 과금이 그대로 두 배가 됐다(deepbot_action.md:308, ops/inbox.md msg_316). 운영 규칙에도 "claim 은 작업 전에"로 이미 못 박혀 있다(orchestration-team-draft.md:141).
- **작업**: `ops/queue-trigger.js` / `ops/poll-queue.js` 픽업 경로에서 **지시를 잡는 즉시 claim → 실패(이미 선점)면 그 회차 전체 중단**. 워커 호출·파일 편집보다 claim 이 먼저 오게 순서를 바꾼다.
- **합격기준**: `ops/test-queue-trigger.js`(현재 34건)에 "이미 claimed 된 지시는 워커 호출 0회로 종료" 검사 1건 이상 추가. `npm test` 12스위트 → **223+k 건 전부 통과**. 일부러 선점 상태를 만들어 워커 호출이 0인지 확인.
- **리스크**: claim API 실패(네트워크)를 선점으로 오인하면 정상 지시를 버린다 → claim 실패는 "선점"과 "오류"를 구분해서, 오류는 재시도(기존 `tries` 정책), 선점만 중단.

### P0-B. `send_to_center.py` 보고 직렬화 버그 — 리포트 본문이 `[object Object]`

- **근거 (file:line 은 VPS 파일이라 없음 — §4 참조)**: 할매봇 리포트의 구조화 필드가 `[object Object]` 로 찍혀 **내용이 통째로 사라진다** — ops/inbox.md msg_320(step2_path·step4_register 전부 `[object Object]`), msg_325, msg_347, msg_349 모두 동일. 별개로 스크립트에 `--help` 를 인자로 넘겨 무의미 리포트가 3회 발송됐다(msg_234·msg_249, deepbot_action.md:284·289). 이건 센터장이 할매봇이 **무엇을 했는지 읽지 못하게** 만드는, 피드백 루프의 핵심 고장이다.
- **작업**: `send_to_center.py`(VPS `/opt/data` 쪽 할매봇 자기 도구 — 로컬 저장소에 없음)에서 dict/구조 필드를 문자열로 직렬화할 때 `str(obj)` 대신 `json.dumps(obj, ensure_ascii=False)` 로 직렬화. `--help` 등 옵션 인자가 `summary` 로 새지 않게 인자 파싱 가드.
- **합격기준**: 새 리포트 3건 연속에서 `[object Object]` 0건. `--help` 실행 시 리포트 발송 0건. (VPS 스크립트라 저장소 `npm test` 대상 밖 — 할매봇이 실측 로그로 증명)
- **리스크**: 이 파일은 로컬에 없어 file:line 을 못 달았다 — 할매봇이 실제 파일을 열어 직렬화 지점을 특정해야 한다(§4 참조). 구조를 지어내지 말 것.

### P1-C. `agent_sessions` 무한 누적 — 정리 경로 신설

- **근거**: `POST /api/sessions`(server.js:1152) 가 매 실행 `INSERT INTO agent_sessions`(server.js:1158, id=`sess_`+Date.now()) 로 새 행을 만드는데, server.js 전체에 `DELETE FROM agent_sessions` 도 만료 로직도 **없다**(서브에이전트 실측). GET 은 `LIMIT 50`(server.js:1164) 으로 가릴 뿐 실제로는 계속 쌓인다. 19→43→46(deepbot_action.md:201·346). 게다가 이 세션들은 orchestrator 시뮬레이션의 기록이다(§4 참조).
- **작업**: 오래된 종료 세션(`done`/`failed` 이고 N일 경과) 정리 경로 하나. 두 방식 중 택1을 할매봇이 판단:
  (a) scheduler.py 폴링에 하루 1회 sweep, 또는 (b) 관리용 `DELETE` 라우트 + 승인 게이트.
  **프로덕션 DB 쓰기이므로 승인 게이트 대상.** 먼저 현재 세션 수·상태 분포를 실측 보고 후 착수.
- **합격기준**: sweep 후 `SELECT status, count(*) FROM agent_sessions GROUP BY status` 로 `done`/`failed` 만 줄고 `running` 은 보존됨을 확인(2026-08-15 sweep 설계와 동일 원칙 — deepbot_action.md:174). 관련 정적 검사를 `ops/` 에 1건 추가해 `npm test` 증가.
- **리스크**: `running` 을 지우면 진행 중 작업 기록이 사라진다 → 활성 어휘(`ACTIVE_STATUSES`)는 절대 대상에서 제외. 시간 기준을 넉넉히(예: 7일).

### P1-D. `/api/llm/worker` 불변식 정적 테스트 추가 (동작 테스트 공백 메우기)

- **근거**: `/api/llm/worker`(server.js:1727)는 이 팀의 과금·환각이 지나가는 길목인데 검증이 인증 래핑 정적 확인 하나뿐이다(test-route-auth.js). `max_tokens` 클램프(server.js:1737, 100~4000), `truncated` 플래그 배선(server.js:1792·1800·1805), 502 실패 보고(server.js:1769~1780)는 테스트가 없다. `#25` 때 404 를 `success:true` 로 포장하던 버그(deepbot_action.md:262)가 정확히 이 라우트였다 — 회귀 방지선이 필요하다.
- **작업**: `ops/test-route-auth.js` / `ops/test-message-status.js` 와 **같은 정적 소스 검사 방식**으로(=DB·네트워크 불필요, CI 불변식 유지 — run-tests.js:16) `/api/llm/worker` 불변식 검사 스위트 신설: 클램프 상·하한 리터럴 존재, `truncated` 응답 노출 존재, `!r.ok` 실패 시 502+report(status=pending) 존재.
- **합격기준**: 새 스위트를 run-tests.js SUITES 에 등록, `npm test` **12→13 스위트 · 223→223+k 건**(새 검사 k건이 총계에 더해진다 — "223 유지"가 아니다). 일부러 클램프 상한을 지웠을 때 테스트가 빨간불이 되는지 확인 후 되돌린다(phase2-plan.md:134 의 "진짜로 잡는지" 원칙).
- **리스크**: 정적 검사는 문자열 존재만 보므로 로직이 실제로 도는지는 못 본다 → "불변식이 코드에 배선돼 있다"까지가 이 테스트의 약속. 동작 검증은 §4(통합 테스트는 CI 불변식과 충돌)로 남긴다.

### P2-E. server.js 죽은 코드 제거 — `/api/ai/decide` 중복 + `decryptSecret`

- **근거 (둘 다 실측)**:
  - `POST /api/ai/decide` 가 server.js:523 과 server.js:1361 에 **두 번** 정의돼 있다(`grep` 확인 2회 매치). Express 는 먼저 등록된 523 만 타므로 1361 은 **도달 불가 죽은 코드**다.
  - `decryptSecret`(server.js:1218)은 **정의만 있고 호출처가 0**이다(`grep "decryptSecret" server.js` → 1건, 정의뿐). #38 에서 `GET /api/credentials` 의 복호화 호출을 제거하며 남은 사체다(deepbot_action.md:340: "decryptSecret 호출처 0, 정의만 남음"). 호출처가 없으므로 "리뷰"할 라이브 결함이 아니라 **삭제 대상**이다.
- **작업**: 둘 다 죽은 코드다. ai/decide 는 죽은 쪽(1361) 제거(두 본문이 다르면 어느 쪽이 정본인지 먼저 diff 보고), `decryptSecret` 은 정의 삭제. 같은 파일이라 **한 커밋**으로.
- **합격기준**: `grep -c "'/api/ai/decide'" server.js` == 1, `grep -c "decryptSecret" server.js` == 0. `npm test` 223건 유지(줄면 멈춤).
- **리스크**: `decryptSecret` 을 정말 아무도 안 부르는지 삭제 전 `grep -rn decryptSecret` 을 저장소 전체로 재확인(웹·py·ops 포함). ai/decide 두 본문이 다르면 "먼저 등록된 것이 정본"이 사용자 의도와 다를 수 있다 → 제거 전 diff 보고.

### P2-F. 오케스트레이션 팀 초안 §7 VPS 실측 (측정만, 만들지 말 것)

- **근거**: `2026-08-17-orchestration-team-draft.md` §7 은 센터장이 Windows 에서 못 보는 전제를 할매봇에게 재도록 남긴 것이다. 큐 전달은 "#39 완료 후로 보류"였고(deepbot_action.md:350) #39 는 이제 완료됐다(ops/inbox.md msg_344) — **차단이 풀렸다.**
- **작업**: 초안 §7 ①~④ 실측 — `hermes -z` 동시 2개 이상 가능 여부/잠금, `/opt/data/agents/` 15명 워크스페이스 실재·용량, 워커 동시 호출 한도·레이트리밋, 워커 1회/세션 1회 비용. **값을 모르면 "모른다"고 적는다**(초안 §7 지시).
- **합격기준**: 초안 §7 보고 양식 [1]~[4] 를 실측값으로 채움. 지어낸 값 0.
- **리스크**: 측정이 만들기로 번지면 안 된다 → 코드·에이전트 생성 금지, 읽기·조회만.

### P2-G. `credential id 60 audit-check` 상태 확인 후 처리

- **근거**: 미사용인데 살아 있다고 기록됨(deepbot_action.md:323). 단 이건 Windows 에서 확인된 게 아니라 **STEP 0 로 현재 상태를 먼저 재야 한다**(§4).
- **작업**: STEP 0 로 id 60 이 여전히 유효·미사용인지 조회 → 맞으면 `credential.revoke`(자동 통과 범위, bootstrap:117) 로 폐기.
- **합격기준**: 조회로 미사용 확인 후 revoke, 재시도 401.
- **리스크**: 사용 중이면 폐기하지 말 것 — last_used_at 확인 필수.

---

## 2. Kimi 워커용 업무 (텍스트 in/out, 코드 첨부)

> Kimi 워커(ag_deepseek, `moonshotai/kimi-k3`)는 **파일을 못 본다.** 코드를 프롬프트에 붙이고, "추측하지 마라"를 넣어야 한다(capability 보고 §3). 무상태, 1호출=1응답.
> **호출 주체는 할매봇이다** — 아래는 할매봇이 Kimi 에게 보낼 프롬프트의 골격이다. 판단(채택/반려)은 할매봇·센터장이 한다.
> **비용·절단 규칙**: 워커 호출은 Nous 과금이고 비용 동결을 한 번 겪었다(deepbot_action.md:303). **함수당 1회, truncated 면 그 함수만 재호출(최대 2회)**. `max_tokens 2500`(#39 기준). 채택률로 즉시 측정된다(#29 무효 → #33 46% → #39 진행).
> **웹 파일(js/) 리뷰는 이 기획안에서 제외**했다(§4 의 경계 판단 참조).

### P1-H. `callLLMWithFallback` 코드 리뷰 — "폴백"이 사용자를 속이는가

- **근거**: server.js:32~50. 폴백이 다른 모델이 아니라 하드코딩 `'NO'` 문자열(server.js:48)이라, Nous 인증이 없거나 호출이 실패하면 호출처(`/api/ai/decide` 등)가 **`'NO'` 를 진짜 판단 결과로 받는다.** `/api/fallback-log` 0건이라 이 경로는 실전에서 검증된 적이 없다(model-swap-feasibility.md:118). Kimi 는 `queue-trigger.js` seen 버그에서 원자성까지 짚은 실적이 있다(capability 보고 §부록) — 이 유형에 강하다.
- **프롬프트 골격**:
```
아래는 server.js 의 callLLMWithFallback 함수 전문이다.

```js
<server.js:32~50 전문을 붙여넣는다>
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
- **합격기준/리스크**: 앵커가 server.js 에 실재하는지 `grep`(게이트 ①②). 채택은 "사용자/호출처가 잘못 믿는다"일 때만. 고치는 범위는 할매봇 판단(예: 폴백 발동 시 응답에 `fallback:true` 를 호출처가 반드시 보게). **거짓 전제 주의** — 프롬프트에 없는 헬퍼를 심지 말 것(capability 보고 §그대로인 것).

### P1-I. `/api/llm/worker` 핸들러 테스트 케이스 도출 (P1-D 와 짝)

- **근거**: Kimi 는 경계·실패 케이스 도출에 강하다(capability 보고 probe P4: `if (!el) return` 에서 경계조건을 뽑음). P1-D 에서 할매봇이 정적 테스트를 쓸 때, 케이스 목록을 Kimi 가 먼저 뽑으면 빠뜨림이 준다.
- **프롬프트 골격**:
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
- **합격기준/리스크**: 도출된 케이스가 코드의 실제 값(100·4000·`finish_reason==='length'`·502)을 참조하는지 확인. 지어낸 값이 있으면 그 케이스만 버린다. 출력이 길어 절단 위험 → `max_tokens 3000`, truncated 면 재호출.

### P2-J. `deepbot_action.md` 상태 다이제스트 추출 (구조화 요약)

- **근거**: 355줄로 불어난 작업 로그에서 "미해결/확인 필요"만 뽑는 일. Kimi 는 미끼까지 걸러내는 구조화 추출에 강하다(capability 보고 probe P2). 세션 승계(bootstrap) 때 반복 필요.
- **프롬프트 골격**: 로그의 "미해결 / 확인 필요" 표와 최근 로그 40줄을 붙이고 *"아직 닫히지 않은 항목만 목록으로. 원문에 있는 것만."*
- **합격기준/리스크**: 원문에 없는 항목을 추가하면 반려. 저부가가치라 P2 — 세션 승계 시에만.

---

## 3. 병렬/순서 제약 (파일 충돌 회피)

오늘까지 사고로 배운 규칙(orchestration-team-draft.md §6, handoff-41 §3, deepbot_action.md)을 그대로 적용한다.

1. **한 파일 = 한 담당.** `#26` 이 파일 비중첩 3병렬을 이미 증명했다(deepbot_action.md:259). **`server.js` 를 건드리는 할매봇 항목(P1-C 세션정리·P2-E 죽은코드제거)은 서로 직렬로, 한 커밋씩** — 같은 파일이라 병렬 편집 금지.
2. **`ops/` 테스트 추가(P0-A·P1-D)는 서로 다른 파일**(test-queue-trigger.js vs 신규 스위트)이라 병렬 가능. 단 둘 다 `ops/run-tests.js` SUITES 를 건드리면 그 한 줄에서 충돌 → run-tests.js 수정은 마지막에 한 번에.
3. **할매봇은 자기 커밋 전 항상 `git pull origin main --ff-only`**(handoff-41 §3) — 로컬 Claude 가 방금 웹 파일을 push 했을 수 있다.
4. **웹 파일(html/js/css/sw)은 할매봇 읽기 전용.** 이 기획안 항목 중 웹 파일을 쓰는 것은 없다(설계상).
5. **`deepbot_action.md` 편집은 pull → 자기 행만 추가 → 즉시 push**(deepbot_action.md:200). 남의 행 삭제·재정렬 금지.
6. **큐에는 지시서 하나씩.** 겹치면 #33 처럼 세션이 둘 떠 판단이 갈린다(deepbot_action.md:308·350). 워커 배치는 묶어 보내되 지시서는 순차.
7. **Kimi 병렬**: H(callLLMWithFallback)·I(worker 케이스)는 서로 다른 대상이라 동시 호출 가능하나, **동시 호출 한도가 미확인**(P2-F 로 재야 함)이므로 그 전까지는 순차 또는 소수 병렬. J(로그 요약)는 코드가 아니라 독립.

**권장 착수 순서**: P0-A(claim 순서) → P0-B(리포트 직렬화) → P1-C·D(세션·워커테스트) → P1-H·I(Kimi 리뷰·케이스) → P2 나머지.
P0 둘은 **자동화의 정확성/피드백 루프**라 다른 것보다 먼저다.

---

## 4. 미확인·모르는 것 (지어내지 말 것)

이 기획안도 게이트 ⑤(지시 자체의 사실을 먼저 확인)의 대상이다. 아래는 **사실로 단정하지 않은 것**들이다.

| 항목 | 왜 미확인인가 | 어떻게 다뤄야 하나 |
|---|---|---|
| **`send_to_center.py` 정확한 직렬화 지점** | 이 파일은 VPS `/opt/data` 에 있고 **로컬 저장소에 없다** — file:line 을 못 달았다 | P0-B 는 할매봇이 실제 파일을 열어 특정해야 한다. 근거는 inbox.md 리포트 4건 |
| **agent_orchestrator.py 가 도는 그 15명 로스터** | orchestrator 노드 실행부는 LLM 을 안 부르고 시뮬레이션 문자열/화이트리스트 셸만 돈다(execute_node server-side 실측: agent_orchestrator.py:238·246·259). 이건 **아키텍처 문제**라 "업무"가 아니라 초안 §8 반박·설계 결정 사항 | 이 기획안 범위 밖. 초안 v0.1 확장 여부는 사용자 결정(bootstrap:166) |
| **`credential id 60 audit-check` 현재 상태** | deepbot_action.md:323 기록은 Windows 에서 재확인된 게 아니다 | P2-G 는 STEP 0 조회를 반드시 앞에 둔다 |
| **`wf_tpl_team` / `wf_tpl_team_mstiqejr` 중복** | deepbot_action.md:204 에 있으나, 이후 워크플로우를 wf_server1 만 남기고 정리했고(deepbot_action.md:216) 서브에이전트가 백엔드에서 이 문자열을 못 찾았다(js/ 웹 파일에만 존재) | **이미 해소됐을 가능성이 높다.** 업무로 넣지 않았다. 필요하면 할매봇 STEP 0 조회 |
| **`ag_hermes` 키 유출** | 이미 회전 완료(id 68, 구 키 401 — deepbot_action.md:326) | **업무로 넣지 않았다.** 회전 재실행 금지 |
| **8/14 대량 쓰기 원인** | `updated_at` 트리거 미특정(deepbot_action.md:202), Windows 에서 확인 불가 | §4 로만 남긴다. 침해 정황 없음 |
| **Nous 카탈로그에 GPT·Grok 있는지** | VPS 에서만 확인(model-swap-feasibility.md:167) | P2-F 실측에 포함 가능하나 별건 |
| **통합(HTTP 동작) 테스트를 넣을지** | run-tests.js 는 "DB·네트워크 없는 테스트만"이 CI 불변식이다(run-tests.js:16). 라우트를 실제 부팅해 때리는 테스트는 이 불변식과 충돌 | P1-D 는 그래서 **정적 검사**로 설계했다. 진짜 동작 테스트는 별도 하네스(별건, 미기획) |
| **웹 파일 리뷰의 경계** | 지시서 #41 표는 "코드 리뷰·요약·문구"를 Kimi 계속 담당으로 두면서 웹 **편집**만 중단한다 — Kimi 가 js/ 를 *리뷰*하는 건 살아 있다고 읽을 여지가 있다. 하지만 이 작업의 지시는 "웹 파일 업무는 기획하지 마라"로 더 분명하다 | **보수적으로 해석**해 웹 파일은 리뷰 포함 전면 제외했다. 이 모호성을 여기 남긴다 |
| **P0/P1 실화재 여부** | 현재 큐 pending 0, 시스템 안정(bootstrap STEP0). **당장 불난 P0 는 없다** | P0 표기는 "가장 먼저 할 것"의 뜻 — 이미 돈을 쓴 사고(claim 경합)와 피드백 고장(리포트 직렬화)이 그 자격 |

---

## 부록 — 근거 파일:라인 색인 (검증용)

- 세션 정리 부재: server.js:1152(POST) · 1158(INSERT) · 1164(GET LIMIT 50), `DELETE FROM agent_sessions` 0회
- 워커 라우트: server.js:1727(핸들러) · 1737(max_tokens 클램프) · 1744(모델) · 1769~1780(502 보고) · 1792/1800/1805(truncated)
- 폴백: server.js:32(정의) · 48(`'NO'`) · 57(fallback-log)
- ai/decide 중복: server.js:523 · 1361
- decryptSecret 죽은 코드: server.js:1218(정의) · 호출처 0(`grep` 1건), deepbot_action.md:340
- orchestrator 시뮬레이션: agent_orchestrator.py:238 · 246 · 259
- claim 경합: deepbot_action.md:308, ops/inbox.md msg_316
- 리포트 직렬화: ops/inbox.md msg_320·325·347·349, deepbot_action.md:284·289
- 테스트 하네스: ops/run-tests.js:16(CI 불변식) · 24~37(12스위트)

---

`기획안` — 자동 실행 대상 아님. 착수는 센터장이 개별 지시서로 전환할 때.
