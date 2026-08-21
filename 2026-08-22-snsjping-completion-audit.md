# SNS자판기(sns-jping) 완료도 감사 — 2026-08-22

감사자: 센터장 세션 · 대상: `D:\naver\SNS자판기_소스` (= `github.com/joker8awesome/sns-jping` main `9d70d42`)
방법: 계획문서(PRD·pipeline_session.md Part 2) ↔ 실제 코드 대조 + 회귀 실행 + 엔진 직접 호출 재현

---

## 0. 결론

**계획된 기능은 전부 코드에 들어와 있고 회귀 68/68 PASS.** 그러나 **"구현은 됐는데 실사용에서 도달할 수 없는" 구멍 1건**과 **명시 요구사항을 한 칸 빼먹은 것 1건**이 있다. 나머지는 문서·일관성 문제다.

기반 상태 (전부 정상):
- `_소스` = `_실행본/app` md5 동일(7파일) = `origin/main` **3자 동기**, working tree clean
- 회귀 `tests/golden_regression.py` → **골든 68/68 PASS, FAIL 0** (G21·N24·S6·PM5·PC4·PS4·PF4)
- 라이브 앱 `localhost:8501` HTTP 200

---

## 1. 계획 대비 이행 — 전부 이행됨

**PRD §1 사전수정 9건 (v6.0.6):** FIX-1~6 코드 반영, FIX-7(키 수명)·FIX-8(텔레메트리 큐 상한) SPEC §9·§14에 문서화, FIX-9 회귀 케이스 추가. **9/9 완료.**

**PRD §2 고도화 14건:** E1·E2·E3·P1·P2·M1·D1·D2·D3·U1·U2·U3 = **12건 구현**, M2(headless 렌더)·M3(STT) = **보류 확정**(무설치 포터블 원칙, `core/media.py:232-241` 스텁 + SPEC §18 명시). 누락 없음.

**pipeline_session.md Part 2:** 2-1 프로필 3종 ✅ · 2-2 룰 4종 ✅ · 2-3 리포트 필드 ✅(`app.py:286-`, 축별점수 포함) · 2-4 정책 스냅샷 소스 ⏸(외부 의존, 아래 §2-6).

---

## 2. 미완성·중단 항목

### 2-1. 🔴 U3 임계값 프로필 — 설정 UI가 없어 실사용 도달 불가

- `config.json.threshold_profiles` 6종(default·commercial·informational·ig-sports·persona-threads·persona-x) 정의됨
- `accounts.threshold_profile` 컬럼 있음(`database.py:17`, 마이그레이션 `:79`), 읽기 배선 `account_thresholds()` → `analyze(thresholds=)` (`app.py:211-213`) 있음
- **그러나 이 값을 쓰는 코드가 어디에도 없다.** 계정 추가 폼(`app.py:770-773`)은 platform·name·main_topic·default_content_type만 받고, `UPDATE accounts` 문 자체가 없다
- 라이브 DB 실측: 4계정 전부 `'default'`

```
(1,'기본 계정','naver_blog','default') (2,…,'instagram','default')
(3,…,'threads','default')             (4,…,'x','default')
```

**파급:** `persona-x` **전략 게이트(`9d70d42`)도 이 프로필로만 켜진다** → 서하린 X 본문 URL REVIEW 승격이 **실사용에서 절대 발동하지 않는다.** 회귀는 `analyze(thresholds=…)`로 직접 주입해 통과하므로 이 구멍을 못 잡는다.

**읽기 경로는 완전히 살아 있다(확인함):** 사이드바 계정 selectbox(`app.py:356`) → `account_id`(`:357`) → `full_qa(…, account_id)`(`:450`,`:460`) → `account_thresholds()`(`:212`) → `analyze(thresholds=)`(`:213`). 계정별로 제대로 흐른다. **끊긴 곳은 쓰기 한 곳뿐.**

**필요한 것:** 계정 폼/관리 탭에 `threshold_profile` selectbox + `UPDATE accounts` 1건 — 이게 수정의 전부다.

### 2-2. 🔴 `persona_suggestive` — negation 한 칸이 통째로 빠짐

Part 2-2는 룰당 **positive·benign·negation·scope 4종**을 요구했다. 4개 룰 중 이것만 negation이 없다.

| 룰 | `negation_aware` | 골든 negation 케이스 |
|---|---|---|
| persona_meetup_dm | `true` | PM3 ✅ |
| persona_medical_claim | `true` | PC3 ✅ |
| persona_false_affiliation | `true` | PF3 ✅ |
| **persona_suggestive** | **없음(None)** | **없음** (PS1 pos·PS2 benign·PS3 pos(x)·PS4 scope) |

엔진 직접 호출로 오탐 재현(형제 룰 대조군 포함):

```
X 오탐 | fired=['persona_suggestive'] | "'노출 컷' 같은 표현은 올리면 안 됩니다"
X 오탐 | fired=['persona_suggestive'] | "속옷 화보는 금지라고 공지했어요"
OK     | fired=[]                     | "'무조건 빠진다' 같은 문구 금지입니다"   (medical, negation_aware=true)
OK     | fired=[]                     | "'전속 모델' 같은 표현 하면 안 됩니다"   (false_affiliation, 동)
```

**피해 범위(과대평가 금지):** 위 출력대로 threads에서는 세 줄 다 `verdict=PASS`다 — 이 오탐이 단독으로 판정을 뒤집지는 않는다. 실제 손해는 ① **MD 리포트에 없는 위반이 evidence 줄로 찍혀** 플랫폼 세션이 그걸 재작성 지시로 읽는 것, ② recommendation/distribution 축 가산으로 **경계선 건이 REVIEW로 넘어갈 수 있는 것** 두 가지다.

**필요한 것:** `rules.json` persona_suggestive에 `negation_aware: true` + 골든 PS5(negation) 추가.

### 2-3. 🟠 배치 검사(U1)가 프로필 임계값을 무시

`app.py:213` 단건 경로만 `thresholds=_th`를 넘긴다. `app.py:681`(배치 검사)·`app.py:841`(앱 내장 Regression)은 `analyze(d,platform,RULES,history=hist)` — **thresholds·title·target_keyword·account_perf 전부 미전달.** 2-1을 고치면 **같은 본문이 단건 검사와 배치 검사에서 다른 verdict**를 내게 된다.

### 2-4. 🟠 UI 문구가 사실과 다름

`app.py:869` — 사용자에게 **"semantic_change는 미구현입니다"** 라고 표시한다. 실제로는 `23ebfde`에서 `_policy_semantic_change()`(임베딩 코사인, `app.py:119-127`)로 구현돼 `app.py:167`에서 호출된다. 구현하면서 안내 문구만 안 고쳤다.

### 2-5. 🟠 SPEC.md 부분 갱신 — `702184a`(vending v2)가 SPEC을 안 건드림

`9d70d42`는 SPEC에 전략 게이트(§4)·프로필 목록(§4 표)을 반영했으나, 그 직전 `702184a`가 추가한 **persona 룰 4종이 SPEC §7 규칙 카탈로그에 전혀 없다**(grep 0건).

| 위치 | SPEC 표기 | 실제 |
|---|---|---|
| §3 파일설명 (64행) | 규칙 16 | **20** |
| §7 헤더 (154행) | 규칙 카탈로그 — 16 규칙 + 엔진 검출 2 | **20 + 2**, persona 4종 누락 |
| §15 (295행) | 규칙 51/51 | **68/68** |
| §15 커버리지 (298행) | 규칙 18종 × 매트릭스 | **20종** |
| §16 (327행) | 변경 이력 (main, 8 커밋) | **14 커밋** |

§18 한계 목록은 P1·D2·M2·M3 상태가 정확하게 최신이다(여긴 문제 없음).

### 2-6. 🟡 Part 2-4 정책 스냅샷 소스 등록 — 미착수(외부 의존)

`c:\sns\_shared\threads_algorithm_prd.html`·`x_strategy_advanced.md` 부재. 코디네이터가 문서를 배치해야 착수 가능. 자판기 쪽 결함 아님.

### 2-7. 🟠 D2(규칙 신뢰도→confidence) — 안전 배선만 있고 활성화 경로는 만들어진 적이 없음

`engine.analyze(rule_reliability=)` 수신부와 `database.rule_reliability(con)` 생산부는 둘 다 있다. 그런데 **생산부의 호출자가 0이다** — `app.py:8`의 import 목록에 `rule_reliability`가 **아예 없고**(`connect`·`recompute_rule_stats`·`account_thresholds`만), analyze 호출 3곳 어디도 전달하지 않는다. 유일한 호출자는 회귀 테스트(`golden_regression.py:297-298`)다.

즉 "데이터 성숙 시 활성화"라는 결정은 기록됐지만 **성숙을 관측할 방법도(min_samples=5를 읽는 곳이 없음), 켜는 스위치도 만들어지지 않았다.** 휴면 기능이 아니라 **호출자 없는 죽은 함수**다.

### 2-8. 🟡 파이프라인 `MEDICAL_CLAIM` 드리프트 (기보고)

`D:\로컬LLM\crawl_sns_rss.py`의 필터가 `pipeline_session.md` 원안 패턴 그대로고, 정본 룰만 개선됨(감량·`100 %`·제로 추가). "의도적 복제본, 함께 갱신" 계약 위반. 자판기가 BLOCK할 표현이 소재 수집 단계는 통과한다.

---

## 3. 우선순위

| | 항목 | 근거 |
|---|---|---|
| P0 | 2-1 프로필 설정 UI | 프로필 3종·전략 게이트가 **전부 사문화** 상태 |
| P0 | 2-2 persona_suggestive negation | 오탐 실측 재현, 명시 요구사항 미충족 |
| P1 | 2-3 배치 thresholds 전달 | 2-1 수정 시 즉시 불일치로 드러남 |
| P1 | 2-4 UI 문구 | 사용자에게 잘못된 정보 표시 |
| P2 | 2-5 SPEC 갱신 | 문서 신뢰도 |
| P2 | 2-8 파이프라인 동기화 | 수집 단계 누수 |
| P2 | 2-7 D2 활성화 경로 | 생산부 호출자 0 — 결정은 기록됐으나 구현 안 됨 |
| P3 | 2-6 정책 소스 | 외부 문서 의존(자판기 결함 아님) |
