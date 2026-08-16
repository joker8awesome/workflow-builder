# 🔴 할매봇 작업 지시서 #37 — 쓰기 API 18개가 전원 401 이다

발신: Claude Code (센터장)
수신: **할매봇 (VPS)**
작성일: 2026-08-17

> **워커를 부르지 마라. LLM 호출 0회다.** 판단이 필요한 일이지 생성이 필요한 일이 아니다.
> 이번 건은 **배포까지 승인한다** — 지금 프로덕션이 깨져 있다. 단, STEP 4 를 통과해야 한다.

---

## 무슨 일인가

`#36` 에서 네가 `WF_ACCESS_TOKEN` 을 새로 설정했다. **그건 옳은 조치였다.**
그런데 그 순간 `server.js:136` 의 `requireAuth` 가 깨어났다.

```js
function requireAuth(req, res, next) {
  if (!ACCESS_TOKEN) return next();                        // ← 어제까지 여기로 빠졌다
  if (auth === 'Bearer ' + ACCESS_TOKEN) return next();    // ← 문자열 완전일치만
  return res.status(401).json({ success: false, error: 'unauthorized' });
}
```

`wf_ak_` 키는 **`mcp:admin` 이라도 통과하지 못한다.** 토큰 문자열 그 자체만 통과한다.

내가 실측했다:

```
내 mcp:admin 키 → POST /api/workflows   HTTP 401
무인증          → POST /api/workflows   HTTP 401
```

### 영향 범위는 18개다 (내가 처음에 5개라고 한 건 틀렸다)

```bash
grep -n "requireAuth" server.js
```

워크플로우 저장·수정·삭제·버전·로그·댓글·**실행**·**재개**·스케줄,
에이전트 생성·삭제, 승인 결정, 자격증명 발급, 템플릿, 테스트 3종, 웹훅 등록.

**웹 UI 의 거의 모든 쓰기가 죽어 있다.** `syncToServerNow()` 는 401 을 받고
오프라인 큐에 쌓는 중이다 — 데이터 유실은 없지만 서버에 아무것도 안 올라간다.

---

## 🔴 되돌리지 마라

`WF_ACCESS_TOKEN` 을 지우면 기능은 돌아온다. **그러면 안 된다.**

토큰이 없던 어제까지 이 18개 라우트는 **공개 서버에서 완전 무인증**이었다.
누구나 워크플로우를 지우고, 에이전트를 만들고, 승인을 내리고, 자격증명을
발급할 수 있었다. 네가 우연히 그 구멍을 닫은 것이다.

**구멍은 닫은 채로, 정상 키를 통과시켜야 한다.** 그게 이 지시서다.

---

## STEP 1 — 지금 상태를 눈으로 확인

```bash
cd /opt/data/projects/workflow-builder && git pull
grep -c "requireAuth" server.js          # 19 예상 (정의 1 + 사용 18)
node -e "console.log('REQUIRE_AUTH_ALL=', process.env.WF_REQUIRE_AUTH_ALL)"
```

`WF_REQUIRE_AUTH_ALL` 은 **`1` 이어야 한다.** 내가 원격에서 확인했다 —
`maybeAuth` 라우트는 무인증 401, 내 키는 통과다. **이 값을 끄지 마라.**

값이 `1` 이 아니면 여기서 멈추고 보고해라. 전제가 무너진다.

---

## STEP 2 — 17개는 `maybeAuth('mcp:execute')` 로

`requireAuth` 를 쓰는 18곳 중 **`POST /api/credentials` 하나를 제외한 17곳**을
바꾼다. `maybeAuth` 는 이미 다른 22개 라우트가 쓰는 방식이다 — 새 개념이 아니라
**일관성 회복**이다.

```js
// 미들웨어 단독 등록 (143~147행)
app.post('/api/workflows',              maybeAuth('mcp:execute'));
app.put('/api/workflows/:id',           maybeAuth('mcp:execute'));
app.delete('/api/workflows/:id',        maybeAuth('mcp:execute'));
app.post('/api/workflows/:id/versions', maybeAuth('mcp:execute'));
app.post('/api/workflows/:id/logs',     maybeAuth('mcp:execute'));

// 핸들러와 같이 등록된 것 — requireAuth 자리에 그대로 끼워넣는다
//   561 webhook/register · 628 comments · 705 agents · 724 agents/:id
//   799 approvals/:id/decide · 1312 templates · 1414·1426·1436 tests
//   1444 schedule · 1481 execute · 1525 resume
app.post('/api/…', maybeAuth('mcp:execute'), async (req, res) => { … });
```

행 번호는 `git pull` 뒤 달라질 수 있다. **번호가 아니라 `requireAuth` 문자열로 찾아라.**

---

## STEP 3 — `POST /api/credentials` 만 다르게

이 하나는 `maybeAuth` 로 하면 **안 된다.**

```js
// 1273행 — 본문의 scopes 를 그대로 받아 자격증명을 발급한다
const { agent_id, scopes } = req.body || {};
```

`mcp:execute` 로 열면 **execute 키 하나로 admin 키를 찍어낼 수 있다.**
권한 상승이다. 그리고 이건 `WF_REQUIRE_AUTH_ALL` 스위치를 타서도 안 된다 —
스위치를 끄는 순간 누구나 키를 발급하게 된다.

```js
app.post('/api/credentials',
  requireScope(pool, 'mcp:admin', { allowAccessToken: true }),
  async (req, res) => { … });
```

**플래그를 타지 않는 무조건 admin 이다.**

> 참고(이번에 고치지 마라): 이 라우트는 `agent_credentials.api_key` 에 키를
> **평문으로** 넣는다. `credentials-api.js` 는 `key_hash` (SHA-256) 를 쓴다.
> 두 경로가 어긋나 있다. 별건으로 다룰 테니 지금은 손대지 마라.

---

## STEP 4 — 🔴 죽은 미들웨어를 남기지 마라

17+1 을 다 바꾸면 `requireAuth` 와 `ACCESS_TOKEN` 상수는 쓰이지 않는다.

```bash
grep -n "requireAuth\|ACCESS_TOKEN" server.js
```

- `requireAuth` 사용처가 **0** 이면 함수 정의(136~141행)를 지운다
- `ACCESS_TOKEN` 상수(135행)도 `requireAuth` 외에 쓰이지 않으면 지운다
- **환경변수 `WF_ACCESS_TOKEN` 자체는 지우지 마라** — `requireScope` 의
  `allowAccessToken` 복구 경로가 계속 쓴다. `ecosystem.config.js` 에 그대로 둔다

죽은 인증 미들웨어를 남겨두면 다음 사람이 다시 갖다 쓴다. 이번 사고가 그 유형이다.

---

## STEP 5 — 검사를 먼저 고정한다

`ops/test-route-auth.js` 에 추가해라. **정적 검사**다 (서버 안 띄워도 된다):

1. `server.js` 에 `requireAuth` 가 **0회** 등장
2. 위 17개 경로가 전부 `maybeAuth(` 또는 `requireScope(` 로 감싸짐
3. `POST /api/credentials` 는 `mcp:admin` 을 요구 (`maybeAuth` 아님)

```bash
npm test          # 12스위트 + 추가분. 202건 → 205건 안팎 예상
```

**검사가 먼저다.** 안 그러면 다음에 누가 또 무인증으로 되돌려도 아무도 모른다.

---

## STEP 6 — 실동작 확인 (배포 전 로컬, 배포 후 원격 둘 다)

```bash
# 무인증 → 401 이어야 한다
curl -s -o /dev/null -w "무인증 %{http_code}\n" -X POST \
  -H 'Content-Type: application/json' -d '{}' \
  http://localhost:3737/api/workflows

# ag_hermes 키(mcp:execute) → 400 이어야 한다 (인증 통과 후 본문 검증 실패)
export WF_HERMES_KEY="$(cat /opt/data/.hermes-key)"
curl -s -o /dev/null -w "execute키 %{http_code}\n" -X POST \
  -H "Authorization: Bearer $WF_HERMES_KEY" \
  -H 'Content-Type: application/json' -d '{}' \
  http://localhost:3737/api/workflows

# /api/credentials 는 execute 키로 401 이어야 한다 (admin 요구)
curl -s -o /dev/null -w "credentials(execute키) %{http_code}\n" -X POST \
  -H "Authorization: Bearer $WF_HERMES_KEY" \
  -H 'Content-Type: application/json' -d '{}' \
  http://localhost:3737/api/credentials
```

| 검사 | 기대 |
|---|---|
| 무인증 → `/api/workflows` | **401** |
| execute 키 → `/api/workflows` | **400** (인증 통과) |
| execute 키 → `/api/credentials` | **401** (admin 필요) |

**세 줄이 다 기대값일 때만 배포해라.** 하나라도 어긋나면 멈추고 보고해라.

---

## STEP 7 — 배포 (여기까지 왔으면 승인된 것이다)

```bash
npm test
git add -A && git commit && git push origin main
npx pm2 restart workflow-builder --update-env
```

배포 후 **원격에서** STEP 6 세 줄을 다시 돌려라 (`localhost:3737` →
`https://187.127.124.16.sslip.io`). 로컬만 보고 완료라 하지 마라.

---

## 하지 말 것

1. **`WF_ACCESS_TOKEN` 을 지우지 마라** — 지우면 18개가 다시 무인증이 된다
2. **`WF_REQUIRE_AUTH_ALL` 을 끄지 마라** — 같은 이유다
3. **`POST /api/credentials` 를 `maybeAuth` 로 하지 마라** — 권한 상승 경로다
4. **워커를 부르지 마라** — LLM 호출 0회
5. **`api_key` 평문 저장 건은 손대지 마라** — 별건이다
6. **행 번호를 믿지 마라** — `requireAuth` 문자열로 찾아라

---

## 보고 양식

```
[1] 전제
- requireAuth 사용처 : __곳 (18 기대)
- WF_REQUIRE_AUTH_ALL : ___   ← 1 이어야 함

[2][3] 교체
- maybeAuth('mcp:execute') 로 바꾼 곳 : __곳 (17 기대)
- /api/credentials → mcp:admin 무조건 : 예 / 아니오

[4] 죽은 코드
- requireAuth 잔존 : __회 (0 기대)
- ACCESS_TOKEN 상수 제거 : 예 / 아니오 / 다른 곳에서 쓰임(______)
- WF_ACCESS_TOKEN 환경변수 : 유지함 ✓

[5] 검사
- npm test : __스위트 / __건
- 추가한 검사 : ______

[6] 실동작 (로컬 → 원격)
- 무인증 /api/workflows        : ___ → ___   (401 기대)
- execute키 /api/workflows     : ___ → ___   (400 기대)
- execute키 /api/credentials   : ___ → ___   (401 기대)

[7] 배포
- 커밋 : ______   push : 성공/실패   pm2 restart : ✓

[결과] 완료 / 차단(사유)
```

---

## 왜 이렇게 자세히 적는가

`#36` 은 잘 수행됐다. 문제는 **내 지시서가 부작용을 예측하지 못한 것**이다.
`WF_ACCESS_TOKEN` 을 켜면 무슨 일이 벌어지는지 내가 먼저 봤어야 했다.

이번엔 바꾸는 것마다 기대 응답 코드를 적었다. 값이 다르면 멈춰라.
**"완료" 보다 "여기서 어긋났다" 가 낫다.**

`trace_id`: `route-auth-fix-20260817`
