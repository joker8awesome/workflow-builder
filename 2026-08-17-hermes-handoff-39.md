# 할매봇 작업 지시서 #39 — 코드 리뷰 3차 (쓰기인데 실패를 안 본다, 12개)

발신: Claude Code (센터장)
수신: **할매봇 (VPS)**
작성일: 2026-08-17
기준 커밋: `c6d1028`
상시 지침: `2026-08-16-web-ux-directive.md` §4~6 (게이트 ①~⑥)

> **워커 호출 재개다.** 비용 조사는 종료됐다 — 사용자 판단이다.
> `#33` 과 같은 방식으로 돈다. 함수당 1회, `max_tokens` 2500.

---

## 왜 지금 이 12개인가

### ① `#33` 의 수율이 높았다

```
채택 6 / 13   (46%)      환각 0      절단 0
```

채택된 6건이 **전부 같은 계열**이었다 — 서버와 말을 주고받는데 실패를 안 보는 것.
`loadFromServer` `loadTplFromServer` `patchWSHandler` `ATF` `reviewer` `refreshMCPStatus`.

**같은 광맥을 더 판다.**

### ② 실측했다 — 아직 많이 남았다

```
js/ 전체
  r.ok 미검사 fetch 지점 : 49  (43개 함수)
  .catch(() => {})       : 17
  빈 catch               : 31
  무로그 early return     : 70

server.js
  빈 catch : 0    무로그 early return : 3    ← 서버 쪽은 이 패턴이 깨끗하다
```

**프론트가 광맥이고 서버는 아니다.** 그래서 이번에도 `js/` 다.

### ③ 🔴 오늘 `#37` 로 전제가 바뀌었다 — 이게 진짜 이유다

`#37` 에서 쓰기 라우트 18개가 `requireAuth` → `maybeAuth('mcp:execute')` 로 바뀌었다.
**이제 인증이 없으면 401 이다.**

`fetch` 는 401 에 예외를 던지지 않는다. `.catch(() => {})` 는 물론 안 걸리고,
`await fetch(...)` 뒤에 `r.ok` 를 안 보면 **401 이 성공처럼 지나간다.**

아래 12개가 때리는 라우트는 **대부분 오늘 인증이 걸린 그것들이다:**

```
/api/exec  /api/audit  /api/knowledge  /api/tests  /api/templates
/api/workflows/:id  /api/workflows/:id/results  /api/workflows/:id/comments
/api/webhook/register  /api/approvals
```

프론트는 개인별 `localStorage` 키를 붙인다(`js/core-store.js:83`).
**키가 없는 사용자는 이 모든 호출이 조용히 401 이 된다.**
저장했다고 믿는데 아무것도 안 남는다.

어제였으면 코드 위생 문제였다. **오늘은 회귀 표면이다.**

---

## 대상 12개 (전부 실재 확인함, `c6d1028` 기준)

| # | 파일 | 함수 | 줄 | 때리는 라우트 | 실패하면 사용자는 |
|---|---|---|---|---|---|
| 1 | `approvals-metrics.js` | `logApproval` | 2 | `POST /api/approvals` | 승인했다고 믿는다 |
| 2 | `approvals-metrics.js` | `shouldAutoApprove` | 19 | `GET /api/trust` | 자동 승인이 왜 안 됐는지 모른다 |
| 3 | `approvals-metrics.js` | `addKnowledge` | 114 | `POST /api/knowledge` | 지식이 등록됐다고 믿는다 |
| 4 | `activity-feed.js` | `notifyTelegramAlert` | 39 | `POST /api/exec` · `/api/audit` | 알림이 갔다고 믿는다 |
| 5 | `script-exec-pwa.js` | `saveRunResult` | 15 | `POST …/results` | 실행 결과가 남았다고 믿는다 |
| 6 | `script-exec-pwa.js` | `addComment` | 56 | `POST …/comments` | 댓글이 달렸다고 믿는다 |
| 7 | `templates-market.js` | `publishTemplate` | 36 | `POST /api/templates` | 게시됐다고 믿는다 |
| 8 | `templates-market.js` | `logAudit` | 61 | `POST /api/audit` | 감사 기록이 남았다고 믿는다 |
| 9 | `tests-more-menu.js` | `addTest` | 31 | `POST /api/tests` | 테스트가 등록됐다고 믿는다 |
| 10 | `tests-more-menu.js` | `installExample` | 410 | `POST /api/examples/install` | 설치됐다고 믿는다 |
| 11 | `llm-trace.js` | `registerWebhook` | 92 | `POST /api/webhook/register` | 웹훅이 걸렸다고 믿는다 |
| 12 | `undo-run-engine.js` | `shareWorkflow` | 424 | `PUT /api/workflows/:id` | **공유 링크를 받는다 — 내용은 안 올라갔는데** |

**12번이 이 배치에서 가장 나쁘다.** 저장 실패를 무시하고 링크를 띄운다.
받은 사람은 옛 내용을 본다.

---

## STEP 1 — 워커 호출 (12회, 함수당 1회)

`#33` 과 같은 방식이다. `ops/review2/run_review.py` 를 본떠 `ops/review3/` 를 만들어라.

### 🔴 키는 환경변수로만

```python
KEY = os.environ.get('WF_HERMES_KEY', '')
```

**소스에 키를 박지 마라.** 오늘 그것 때문에 회전을 한 번 했다.

### 프롬프트에 반드시 넣을 것

1. **함수 전문을 붙여라.** 파일에서 잘라 넣어라
2. **"추측하지 마라. 붙인 코드에 없는 것은 없다고 답해라."** 한 줄
   — 능력 측정에서 이 한 줄이 환각을 완전히 막았다(Q1)
3. 질문은 **이것 하나**로 고정한다:

> 이 함수에서 **조용히 실패할 수 있는 지점**은 어디인가?
> 그 지점이 실패했을 때 **사용자는 무엇을 잘못 믿게 되는가?**
> 코드 수정안이 아니라 **결과**를 말해라.

`#33` 에서 값이 나온 것은 워커가 **결과**를 짚었을 때였다. 코드 제안은 절반이
취향 반려였다. **묻는 것을 바꿔서 반려율을 낮춘다.**

```
max_tokens : 2500
truncated:true → 해당 함수만 재호출 (의무다)
```

---

## STEP 2 — 네가 판단한다

워커는 **찾는 쪽**이고 판단은 **네 몫**이다. `#33` 에서 46% 만 채택했다.
그 비율이 정상이다. 전부 채택하면 오히려 의심스럽다.

### 채택 기준

- ✅ **실패가 사용자에게 잘못된 믿음을 준다** → 채택
- ❌ 로그만 더 찍자 → 취향 반려
- ❌ 이 함수 책임이 아니다(렌더러·fire-and-forget) → 반려
- ❌ 코드에 없는 것을 말한다 → **환각 반려. 원문을 보고에 적어라**

### 고칠 때의 원칙

**최소 변경.** `r.ok` 검사와 사용자에게 보이는 실패 표시까지다.
재시도·큐잉·리팩터링은 이번 범위가 아니다.

```js
// 이 정도가 상한이다
const r = await fetch(...);
if (!r.ok) { toast('저장 실패 (' + r.status + ')'); return; }
```

**12번 `shareWorkflow` 는 실패 시 링크를 띄우지 않는 것까지가 수정이다.**

---

## STEP 3 — 검증

```bash
npm test        # 223건 유지 (줄면 멈춰라)
```

프론트 변경이므로 **Playwright 스모크**도 돌려라 — `#32` 때 쓴 방식.
콘솔 에러 0, 스크립트 로드, 주요 전역 존재.

`sw.js` **CACHE 는 올리지 마라.** 파일 이름이 안 바뀌고 내용만 바뀐다.
SW 가 네트워크 우선이라 온라인 사용자는 항상 최신을 받는다.
(`#28` 때 올린 건 파일 *이름* 이 바뀌어 `addAll` 이 통째로 실패할 수 있었기 때문이다.)

---

## STEP 4 — 보고 후 대기

**push 하지 마라. 로컬 커밋까지다.** 배포는 내가 diff 를 보고 승인한다.
오늘 이미 배포가 세 번(`#37` `#38` + 회전) 있었다.

브랜치: `review-3`

---

## 하지 말 것

1. **함수당 워커 2회 이상 부르지 마라** — 판단이 안 서면 보고만 해라
2. **12개 밖으로 나가지 마라** — 눈에 띄는 다른 결함은 **보고에 적기만** 해라
3. **재시도·큐잉을 넣지 마라** — 범위 밖이다
4. **키를 소스에 박지 마라**
5. **push 하지 마라**
6. **`sw.js` CACHE 를 올리지 마라**

---

## 보고 양식

```
[1] 워커
- 호출 : __회        (12 기대)
- truncated : __개 → 재호출 __회
- 최종 판단 불가 : __개      ← 0 이어야 채택률이 유효하다

[2] 채택 (분모 12)
- 실제 결함(고침) : __건
    · 함수명 — 무엇이 조용히 실패했고, 사용자가 무엇을 잘못 믿게 됐는가 → 어떻게 고쳤는가
- 반려 : 취향 __ / 오판 __ / 환각 __
- 환각 원문 : ______ (있으면 그대로)

[3] 범위 밖에서 눈에 띈 것
- ______ (고치지 말고 적기만)

[4] 검증
- npm test : __스위트 / __건   (223 기대)
- Playwright 스모크 : 콘솔 에러 __건
- sw.js CACHE : v8 그대로 확인

[5] 커밋
- 브랜치 review-3 / 로컬 커밋 ______
- push : 안 함 ✓

[결과] 승인대기 / 차단(사유)
```

---

## 참고 — 이번엔 묻는 것이 다르다

`#29` 는 "무엇이 문제인가" 를 물었고 절단으로 절반이 무효였다.
`#33` 은 "조용히 실패하는 지점" 을 물었고 46% 채택했다.
`#39` 는 **"사용자가 무엇을 잘못 믿게 되는가"** 를 묻는다.

취향 반려의 대부분은 워커가 코드를 고치려 들 때 나왔다.
**결과를 물으면 고칠지 말지는 네가 정한다.** 그게 이번 실험이다.

`trace_id`: `review3-silent-write-20260817`
