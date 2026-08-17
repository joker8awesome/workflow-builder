# 지시서 #44 — P2 3건: 죽은 코드 제거 · VPS 실측 · 미사용 키 폐기

작성: Claude Code (센터장, Opus 4.8)
작성일: 2026-08-17
대상: 할매봇 (ag_hermes)
기준 커밋: `1f8c977`
trace_id: `p2-batch-20260817`

---

## 0. 선행·순서

- **P2-E 는 server.js 를 건드린다 → #43 의 P1-C(세션 정리, 역시 server.js)와 직렬.**
  같은 파일 병렬 편집 금지. #43-C 를 먼저 끝내고 pull 한 뒤 P2-E 착수, 커밋은 각각.
- P2-F(측정), P2-G(키)는 server.js 와 무관 → P2-E 와 병렬 가능.
- 웹 파일(#41 stand down) 안 건드림. 작업 전 `git pull origin main --ff-only`.
- 우선순위 P2 — P0/P1 이 끝난 뒤. 급한 불 아님.

---

## 1. P2-E — server.js 죽은 코드 제거 (할매봇)

### 근거 (실측)
1. **`POST /api/ai/decide` 가 두 번 정의됨** — server.js:523, server.js:1361.
   Express 는 먼저 등록된 **523 만** 탄다 → **1361 은 도달 불가 죽은 코드**.
2. **`decryptSecret` 정의만 있고 호출 0** — 정의 server.js:1218. 저장소 전체(js·py)에서
   실제 호출 `decryptSecret(...)` **0회**(나머지 매치는 ops/inbox.md 로그와
   test-route-auth.js:113 의 "없음 검사"뿐). `#38` 에서 GET /api/credentials 복호화
   호출을 뺀 뒤 남은 사체(deepbot_action.md:340).

### 작업
- **① ai/decide**: 삭제 전 **523 과 1361 두 본문을 diff 로 비교해 보고**하라.
  - 같으면 → 1361(죽은 쪽) 제거.
  - **다르면 → 어느 쪽이 정본인지 판단이 필요하니, 삭제하지 말고 diff 를 instruction 으로
    보고**(센터장 판단). Express 가 523 을 타므로 "현재 동작"은 523 이다.
- **② decryptSecret**: 정의(1218) 삭제. 삭제 전 저장소 전체 재확인:
  `grep -rn "decryptSecret" .` (웹·py·ops 포함) — 실제 호출이 정말 0인지.
- 둘 다 server.js 라 **한 커밋**(또는 ①이 보류면 ②만).

### 합격기준
- `grep -c "api/ai/decide'" server.js` == 1 (①이 진행된 경우)
- `grep -c "decryptSecret" server.js` == 0
- `npm test` 전 스위트 통과(224+, #42·#43 반영 후 기준). **줄면 멈춤.**

### 리스크
- ai/decide 두 본문이 다른데 1361 을 지우면 의도된 로직을 잃을 수 있다 → **diff 먼저**.
- decryptSecret 삭제로 test-route-auth.js:113("creds 라우트에 decryptSecret 없음")은
  깨지지 않는다(그 테스트는 정의가 아니라 creds 라우트 본문을 본다) — 확인만.

---

## 2. P2-F — 오케스트레이션 초안 §7 VPS 실측 (측정만, 만들지 말 것)

### 근거
`2026-08-17-orchestration-team-draft.md` §7 은 센터장이 Windows 에서 못 보는 전제를
할매봇에게 재라고 남긴 것. #39 완료로 차단 풀림(deepbot_action.md:350).

### 작업 (초안 §7 ①~④ 그대로)
- ① `hermes -z` 동시 2개 이상 가능한가 / 잠금이 막는가. 워크스페이스 분리 시 저장소 충돌.
- ② `/opt/data/agents/` 하위 디렉터리 수, `workspace.md` 실재·내용 유무, 총 용량.
- ③ 워커 동시 호출 한도 / 레이트리밋. `#26` 3병렬이 실제 동시였나.
- ④ 비용: 워커 1회 평균 / `hermes -z` 세션 1회. **모르면 "모른다"고 적어라.**
- (선택) Nous 카탈로그에 GPT·Grok 계열 있는지(model-swap-feasibility.md §5 명령).

### 합격기준
- 초안 §7 보고 양식 [1]~[4] 를 실측값으로 채움. **지어낸 값 0.**

### 리스크
- 측정이 만들기로 번지면 안 된다 → 코드·에이전트 생성 금지, 읽기·조회만.

---

## 3. P2-G — 미사용 키 `id 60 audit-check` 폐기 (STEP 0 먼저)

### 근거
미사용인데 살아 있다고 기록됨(deepbot_action.md:323). 단 **Windows 에서 재확인된 게
아니다** — 로컬 코드에 흔적 없음. 반드시 조회부터.

### 작업
- **STEP 0**: id 60 이 여전히 유효·미사용인지 DB 조회(`last_used_at` 확인).
- 미사용 확정이면 → `credential.revoke`(자동 통과 범위) 로 폐기.
- **사용 중이면 폐기하지 마라** — 상태만 보고.

### 합격기준
- 조회로 미사용 확인 후 revoke, 구 키로 재시도 시 401.

### 리스크
- `last_used_at` 이 최근이면 사용 중 → 폐기 금지. 조회 없이 폐기 절대 금지.

---

## 4. 보고 양식 (단위별)
```
[E 죽은코드] ai/decide 두 본문 동일? 예·아니오 / 처리(1361제거·보류) / decryptSecret 제거: 예
             grep 카운트 ai/decide=__ decryptSecret=__ / npm test __건
[F VPS실측]  §7 [1]~[4] 채움 / 모름 항목 __개 / 지어낸 값 0 확인
[G 키폐기]   id60 last_used_at ______ / 미사용? 예·아니오 / revoke: 예·보류 / 401 확인
[막힘] ______
```

## 5. 안 바꾸는 것
- 웹 파일(#41) · send_to_center.py(정상) · 승인 게이트 3종
- ai/decide 두 본문이 다르면 임의 삭제 금지(보고)
- id 60 사용 중이면 폐기 금지
- 에이전트 생성·orchestrator 개조 금지(F 는 측정만)

---

`trace_id`: `p2-batch-20260817`
