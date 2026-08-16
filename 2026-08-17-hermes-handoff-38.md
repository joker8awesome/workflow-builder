# 🔴 할매봇 작업 지시서 #38 — 자격증명 API 두 개를 정리한다

발신: Claude Code (센터장)
수신: **할매봇 (VPS)**
작성일: 2026-08-17

> **워커를 부르지 마라. LLM 호출 0회다.**
> **배포까지 승인한다** — 무인증으로 자격증명이 새고 있다. 단 STEP 5 를 통과해야 한다.

---

## 먼저, 내가 틀렸던 것

앞서 나는 이 건을 "키를 평문 저장한다"고 말했다. **틀렸다.**
`encryptSecret()` (AES-256-CTR, `WF_VAULT_KEY`) 로 암호화해서 넣는다.
컬럼 이름이 `api_key` 인 것만 보고 단정했다.

파고 보니 진짜 문제는 두 개고, 둘 다 다른 것이었다.

---

## 문제 1 — `GET /api/credentials` 가 무인증인데 복호화해서 뱉는다 🔴

```js
// server.js:1258 — 미들웨어가 없다
app.get('/api/credentials', async (req, res) => {
  const { rows } = await pool.query('SELECT agent_id, api_key, scopes, encrypted FROM agent_credentials');
  const creds = rows.map(r => ({ ...r, api_key: r.encrypted ? decryptSecret(r.api_key) : r.api_key }));
  res.json({ success: true, credentials: creds });
});
```

**서버가 볼트를 열어서 내보낸다.** 인증은 없다.

내가 원격에서 인증 없이 때려봤다:

```
GET https://187.127.124.16.sslip.io/api/credentials  →  HTTP 200, 67행
  api_key 가 비어있지 않은 행 : 12
  encrypted=true 행           : 11   ← 서버가 풀어서 내보낸다
```

해당 agent 는 전부 테스트 계정이다 —
`ag_key1` `ag_vault1` `ag_mcp_test` `ag_roundtrip` `ag_rt2` `ag_live1`
`ag_spec` `ag_mcp2` `ag_mcp3` `ag_mcp4` `ag_mcp5` `ag_mcp6`

08-15 P0 때 `mcp:admin` 을 건 것은 `credentials-api.js` 의
`/api/agents/:id/credentials` 였다. **server.js 의 이 옛 라우트는 그때 누락됐다.**

---

## 문제 2 — `POST /api/credentials` 는 한 번도 동작한 적이 없다

결함이 셋인데 **각각 단독으로 치명적**이다.

| # | 결함 | 결과 |
|---|---|---|
| ① | `ON CONFLICT (agent_id)` 인데 `agent_id` 에 유니크 제약이 없다 | **항상 500** |
| ② | `key_hash` 를 안 쓴다. `verifyCredential` 은 `key_hash` 로만 조회한다 | 발급돼도 인증 불가 |
| ③ | 기본 scopes 가 `['execute','report']` — 어휘가 틀렸다 (`mcp:read/execute/admin`) | 스코프 검사 실패 |

①은 실측했다:

```
POST /api/credentials → 500
{"error":"there is no unique or exclusion constraint matching the ON CONFLICT specification"}
```

`idx_agent_credentials_agent_id` 는 **비유니크 부분 인덱스**다. 제약이 아니다.

### 🔴 여기서 함정이다 — 뻔한 수정을 하지 마라

`agent_id` 에 유니크 인덱스를 추가하면 500 은 사라진다. **그게 더 나쁘다.**

`key_hash` 없는 행이 생기고, 호출자는 "발급됐다"며 키를 받는다.
그 키는 **영원히 401** 이다. 지금은 시끄럽게 실패하는데, 조용히 실패하게 바뀐다.

**고치지 말고 지워라.** 정상 발급 경로는 `credentials-api.js` 에 이미 있고
잘 돌아간다(`POST /api/agents/:id/credentials` — 해시 저장, prefix, 스코프 배열,
다중 키, 폐기 지원).

---

## STEP 1 — git pull, 현재 상태 확인

```bash
cd /opt/data/projects/workflow-builder && git pull
sed -n '1255,1280p' server.js
curl -s -o /dev/null -w "무인증 GET /api/credentials → %{http_code}\n" \
  http://localhost:3737/api/credentials
```

**200 이 나와야 한다** (아직 안 고친 상태 확인). 401 이 나오면 누가 이미
건드린 것이니 멈추고 보고해라.

---

## STEP 2 — `GET /api/credentials` 를 잠그고, 키를 아예 안 내보낸다

두 가지를 같이 한다. **인증만 걸고 끝내지 마라.**

```js
app.get('/api/credentials',
  requireScope(pool, 'mcp:admin', { allowAccessToken: true }),
  async (req, res) => {
    try {
      // 키 값은 어떤 경우에도 내보내지 않는다. 볼트를 여는 것 자체를 그만둔다.
      const { rows } = await pool.query(
        `SELECT id, agent_id, name, key_prefix, scopes, created_at,
                last_used_at, revoked_at, expires_at
           FROM agent_credentials ORDER BY id DESC`);
      res.json({ success: true, credentials: rows });
    } catch (e) { res.status(500).json({ success: false, error: maskedError(e) }); }
  });
```

### 왜 인증만으로 부족한가

admin 이라도 **남의 키 원문을 볼 이유가 없다.** 발급 시 1회 보여주고 끝이다 —
그게 `credentials-api.js` 가 이미 지키는 규칙이다(`key_hash` 만 저장).
이 라우트가 볼트를 여는 한, `WF_VAULT_KEY` 하나가 새면 전부 새는 구조가 남는다.

`decryptSecret` 이 이 파일의 다른 곳에서 쓰이면 **그건 건드리지 마라.**
여기서 쓰지 않게만 하면 된다.

---

## STEP 3 — `POST /api/credentials` 를 지운다

라우트 전체(`app.post('/api/credentials', …)` 블록)를 삭제해라.

지운 자리에 주석 한 줄을 남겨라 — 다음 사람이 "왜 없지?" 하고 다시 만들지 않도록:

```js
// POST /api/credentials 는 제거했다 (2026-08-17, 지시서 #38).
// ON CONFLICT 대상 제약 부재로 항상 500 이었고, key_hash 를 쓰지 않아
// 설령 INSERT 돼도 그 키로는 인증이 되지 않았다.
// 발급은 credentials-api.js 의 POST /api/agents/:id/credentials 를 쓴다.
```

**호출하는 곳이 없는지 먼저 확인해라:**

```bash
grep -rn "api/credentials" js/ index.html *.py ops/ 2>/dev/null | grep -v node_modules
```

내 쪽에서 확인했을 때 프론트·파이썬 어디서도 안 부른다. **네가 다시 확인해라.**
호출처가 나오면 **멈추고 보고해라** — 지우면 그쪽이 깨진다.

---

## STEP 4 — 테스트 계정 12개 행 정리

`api_key` 가 남아 있는 12행은 전부 테스트 agent 다. 값이 남아 있을 이유가 없다.

```sql
-- 먼저 무엇을 지우는지 눈으로 본다 (값은 찍지 마라)
SELECT id, agent_id, name, (api_key <> '') AS has_key, encrypted,
       (key_hash <> '') AS has_hash, revoked_at
  FROM agent_credentials
 WHERE api_key <> ''
 ORDER BY id;
```

**보고에 이 표를 붙여라. 그다음 내 판단을 기다려라 — STEP 4 는 여기까지다.**

`key_hash` 가 있는 행이 섞여 있으면 실제로 쓰이는 키일 수 있다.
지우기 전에 내가 봐야 한다. **DELETE 도 UPDATE 도 하지 마라.**

---

## STEP 5 — 검사 고정 + 실동작

`ops/test-route-auth.js` 에 추가:

1. `server.js` 에 `app.post('/api/credentials'` 가 **0회**
2. `GET /api/credentials` 가 `requireScope(...'mcp:admin'...)` 로 감싸짐
3. `GET /api/credentials` 핸들러 안에 `decryptSecret` 이 **없음**
4. 응답 SELECT 에 `api_key` 컬럼이 **없음**

```bash
npm test    # 221건 → 225건 안팎
```

실동작 (로컬 → 배포 후 원격 둘 다):

```bash
# 무인증 → 401
curl -s -o /dev/null -w "무인증 GET  %{http_code}\n" http://localhost:3737/api/credentials
# execute 키 → 403 (admin 아님)
export WF_HERMES_KEY="$(cat /opt/data/.hermes-key)"
curl -s -o /dev/null -w "execute GET %{http_code}\n" \
  -H "Authorization: Bearer $WF_HERMES_KEY" http://localhost:3737/api/credentials
# POST 는 사라졌으므로 404
curl -s -o /dev/null -w "POST        %{http_code}\n" -X POST \
  -H "Authorization: Bearer $WF_HERMES_KEY" -H 'Content-Type: application/json' \
  -d '{}' http://localhost:3737/api/credentials
```

| 검사 | 기대 |
|---|---|
| 무인증 `GET` | **401** |
| execute 키 `GET` | **403** |
| `POST` | **404** |

**세 줄이 다 기대값일 때만 배포해라.**

---

## STEP 6 — 배포

```bash
npm test && git add -A && git commit && git push origin main
npx pm2 restart workflow-builder --update-env
```

배포 후 **원격**(`https://187.127.124.16.sslip.io`)에서 STEP 5 세 줄을 다시 돌려라.

---

## 하지 말 것

1. **`agent_id` 에 유니크 인덱스를 추가하지 마라** — 시끄러운 실패가 조용해진다
2. **`POST /api/credentials` 를 고치려 하지 마라** — 지우는 게 맞다
3. **`GET` 에 인증만 걸고 끝내지 마라** — 키를 안 내보내는 것까지가 한 벌이다
4. **STEP 4 에서 DELETE·UPDATE 하지 마라** — 조회해서 보고만
5. **`api_key`·`encrypted` 컬럼을 DROP 하지 마라** — 스키마 변경은 별건이다
6. **워커를 부르지 마라**

---

## 보고 양식

```
[1] 현재 상태
- 무인증 GET /api/credentials : ___ (200 기대)

[2] GET 잠금
- requireScope mcp:admin 적용 : 예 / 아니오
- decryptSecret 제거          : 예 / 아니오
- SELECT 에서 api_key 제거    : 예 / 아니오

[3] POST 제거
- 호출처 검색 결과 : 없음 / 있음(______)  ← 있으면 멈춤
- 라우트 삭제 : 예 / 아니오

[4] 테스트 행 (조회만)
- 표 붙여넣기 (id/agent_id/name/has_key/encrypted/has_hash/revoked_at)
- ⚠ 지우지 않았음 확인

[5] 검사
- npm test : __스위트 / __건
- 추가 검사 4건 : ______

[6] 실동작 (로컬 → 원격)
- 무인증 GET  : ___ → ___   (401)
- execute GET : ___ → ___   (403)
- POST        : ___ → ___   (404)

[7] 배포
- 커밋 : ______  push : ___  pm2 : ___

[결과] 완료 / 차단(사유)
```

---

## 왜 이게 급한가

오늘 우리는 유출된 키 2개를 회전했다. 그런데 **키를 나눠주는 창구 하나가
인증 없이 열려 있었다.** 회전은 유출된 값을 죽이지만, 새는 구멍을 막지는 않는다.

지금 새는 것이 테스트 계정 키뿐인 것은 운이 좋았던 것이지 설계가 막은 게 아니다.

`trace_id`: `cred-api-cleanup-20260817`
