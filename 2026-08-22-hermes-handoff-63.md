# 지시서 #63 — #61·#62 폐기 + 할매봇 생존확인 & SPEC 정합성 전수 대조

발행: 센터장(Opus 5) · 2026-08-22 · trace_id: `hermes-resync-20260822`
대상: 할매봇(ag_hermes, VPS)
승인게이트: read/pull/clone 자동통과. **sns-jping에 write 금지.** Comment_Center는 `deepbot_action.md`만 append.

---

## 0. 선행 — 이전 지시서 2건 폐기

- **지시서 #61 (SUPERSEDED)** — 수행 불필요. 기록 대상 URL은 아래 §2에 흡수했다.
- **지시서 #62 (SUPERSEDED)** — 수행 불필요. **전제가 이미 깨졌다:** #62는 "main HEAD가 `c6be9b2`인지 확인"을 요구하지만, sns-jping main은 그 뒤로 5커밋 진행해 현재 **`9d70d42`** 다. 옛 HEAD 기준으로 확인하면 잘못된 결론이 난다.

두 건 모두 2026-08-20T21:43Z(#60 보고) 이후 수행 흔적이 없다 — `deepbot_action.md` 기록 없음, `ops/inbox.md` 메시지 없음.

---

## 1. 생존확인 보고 (최우선 — 이것만이라도 먼저 보내라)

`deepbot_action.md`에 append + 센터장 report:

- 마지막으로 **실제 수행 완료한** 지시서 번호와 시각
- **#61·#62를 왜 못 받았는지** — VPS git 폴러(cron/스크립트) 상태, 마지막 pull 시각, 폴러가 죽었다면 그 원인(로그 있으면 요지)
- 지금 폴링이 살아있는지 여부

> 이게 이번 지시서의 **1순위**다. §3이 막히더라도 §1·§2는 반드시 보고할 것.

---

## 2. 로그 1줄 기록 (#61에서 승계)

`deepbot_action.md`에 append:

```
[2026-08-22] 지시서 #63 — 2026-08-21 세션요약 대시보드(비공개 아티팩트): https://claude.ai/code/artifact/03ad40d2-4855-4962-8a7f-dc8084330cc4 · #61·#62 폐기(SUPERSEDED), sns-jping HEAD 9d70d42 기준 재동기화 (trace: hermes-resync-20260822)
```

⚠ 위 URL은 **claude.ai 비공개 아티팩트**다. 열람 안 되는 게 정상 — **접근 시도·재시도·스크래핑 금지.** URL 문자열만 기록한다.

---

## 3. SPEC.md 정합성 전수 대조 (본 작업, 비파괴)

### 3-1. pull
```
git clone --depth 1 https://github.com/joker8awesome/sns-jping.git /tmp/sns-jping-63
# 또는 기존 clone에서 git pull
```
- **main HEAD가 `9d70d42`인지 확인.** 다르면 그 해시를 보고에 적고 그 상태로 진행.

### 3-2. 대조 (SPEC.md ↔ 실제 코드/설정)

`SPEC.md`는 `c6be9b2`에 처음 작성된 뒤 `d76d014`·`2b2e94d`·`23ebfde`·`9d70d42`에서 갱신됐다. **갱신이 빠진 구석이 있는지** 아래를 실제 파일로 세어서 대조하라. **추측 금지 — 파일에서 센 수만 적을 것.**

| # | 대조 항목 | 확인 방법 | 센터장 실측 기대값 |
|---|---|---|---|
| A | 규칙 개수·id 목록 | `rules.json`의 rules 배열 | **20종** (기준선 6 + 고도화 10 + persona 4) |
| B | 임계값 프로필 | `config.json` — **키 이름이 `threshold_profiles`** | **3종**: `ig-sports`·`persona-threads`·`persona-x` |
| C | app_version | `config.json.app_version` | **`6.1.0`** |
| D | persona 룰 스코프 | `rules.json` persona_* 4종의 `platforms` | `[threads, x]` — 다른 플랫폼에 새면 지적 |
| E | **persona 룰 `negation_aware`** | `rules.json` persona_* 4종 | **미확인 항목.** 실제로 켜져 있는지 세고, SPEC 서술과 맞는지 대조 |
| F | 전략 게이트 | `config.json.threshold_profiles["persona-x"].strategy.body_url_review` + engine 처리 | verdict만 PASS→REVIEW, **total·confidence·축 불변**, `type="STRATEGY"`, BLOCK 승격 금지 — SPEC §전략게이트 서술과 일치하는지 |
| G | DB 테이블 수 | `core/database.py` | SPEC이 말하는 수와 일치? |
| H | 회귀 골든 수 | `tests/golden_regression.py` | SPEC이 25/51 등 **옛 숫자를 남겨두었으면 지적**. 센터장 로컬 실측 = **68/68 PASS, FAIL 0** |

### 3-3. 회귀 실행 (가능하면)
VPS에 python·의존성이 있으면 `python -s -E tests/golden_regression.py` 실행 후 결과를 보고. **의존성 설치·pip install 금지** — 안 되면 "실행 불가(사유)"로 보고하면 된다. 센터장 로컬 기준값은 **68/68 PASS**.

### 3-4. 정리
임시 clone 사용 시 `rm -rf /tmp/sns-jping-63`.

---

## 4. 참고 — 착각하기 쉬운 함정 2개

1. **`D:\SNS자판기\SNS자판기_소스`는 죽은 사본이다.** git repo가 아니고 `6.0.5-branding`·규칙 10종·프로필 키가 `profiles`다. sns-jping과 무관하니 이 경로 이야기가 나오는 문서(구 `c:\sns\vending\STATUS.md` 등)를 근거로 삼지 말 것. **정본은 sns-jping / `D:\naver\SNS자판기_소스`.**
2. **커밋 저자 `Hermes Agent`는 네가 아니다.** 센터장 PC의 git `user.name`이 그렇게 잡혀 있다. sns-jping의 최근 커밋(`+0900`, `xowlsdk7@gmail.com`)은 전부 로컬 세션 작업이다. 네 작업으로 보고하지 말 것.

---

## 5. 완료 조건

§1 생존확인 + §2 로그 1줄 + §3 대조표(A~H 각 항목: 실측값 / SPEC 서술 / **부합 or 불일치**) 를 `deepbot_action.md` append + 커밋 + push origin main, 그리고 센터장 report.

## 6. 범위 밖

- **sns-jping 수정·커밋·push 금지**(읽기 전용). SPEC.md 고치지 말고 **지적만** 하라.
- force push·설정 변경·파일 삭제(임시 clone 제외) 금지. pip/apt 설치 금지.
- 아티팩트 URL 접근 시도 금지.
- workflow-builder에는 위 로그 1줄 요지만.
