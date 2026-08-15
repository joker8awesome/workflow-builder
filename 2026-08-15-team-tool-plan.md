# 팀 도구 전환 계획 — 인증 통합

결정: **팀 도구로 간다** (공개 읽기전용 아님)
작성일: 2026-08-15 · 기준 커밋 `f5a38a9`

---

## 0. 🔴 먼저 — 자격증명 API가 무인증으로 열려 있다

팀 도구 전환과 **무관하게 지금 즉시** 처리해야 한다. 현재 상태로는 어떤 인증 설계도 의미가 없다.

### 확인된 사실

`server.js:73`:
```js
app.use('/', createCredentialsRouter(pool));   // ← requireAuth 없음
```

`credentials-api.js`의 라우터 자체에도 인증 미들웨어가 없다. 세 엔드포인트 전부 무방비다:

| 엔드포인트 | 기능 |
|---|---|
| `POST /api/agents/:id/credentials` | **새 키 발급** (기본 scopes `mcp:read`+`mcp:execute`) |
| `GET /api/agents/:id/credentials` | 키 목록 조회 |
| `DELETE /api/agents/:id/credentials/:credId` | 키 폐기 |

### 실측 (읽기 전용으로만 확인)

```
$ curl https://187.127.124.16.sslip.io/api/agents/ag_orch/credentials     # 헤더 없음
status=200
{"credentials":[{"id":61,"name":"audit-check","key_prefix":"wf_ak_ag_orch_e-jVDS...",
  "scopes":"{\"mcp:read\",\"mcp:execute\"}", ...}]}
```

**인증 헤더 없이 200이 돌아온다.**

> 쓰기(발급·폐기)는 **실제로 시도하지 않았다.** 같은 라우터에 같은 방식으로 마운트돼 있고
> 코드상 인증 분기가 없으므로 동일하게 열려 있다고 판단한다. 확인이 필요하면
> VPS에서 직접 시험하는 편이 안전하다.

### 영향

- 누구나 `mcp:read`+`mcp:execute` 키를 **스스로 발급**할 수 있다 → MCP로 워크플로우 실행·에이전트 조작
- 키 목록이 노출된다 (prefix·이름·사용시각)
- 남의 키를 **폐기**할 수 있다 (서비스 거부)

### 조치

발급/폐기에 **`mcp:admin` 스코프**를 요구한다. 상세는 아래 2단계에서 통합 설계로 다룬다.

---

## 1. 팀 도구가 부딪히는 구조 문제 — 인증 체계가 둘이다

| | REST (`server.js`) | MCP (`mcp-router.js`) |
|---|---|---|
| 방식 | `WF_ACCESS_TOKEN` **단일 공유 문자열** | `wf_ak_` **사용자별 키** |
| 검증 | `auth === 'Bearer ' + ACCESS_TOKEN` | SHA-256 → `agent_credentials` 조회 |
| 스코프 | 없음 (전부 아니면 전무) | `mcp:read` / `mcp:execute` / `mcp:admin` |
| 폐기 | 불가 (바꾸면 전원 재배포) | 개별 `revoked_at` |
| 만료 | 없음 | `expires_at` |
| 감사 | 없음 | `last_used_at` + `audit_logs` |

**팀 도구에는 오른쪽이 필요하다.** 사람마다 키를 주고, 나갈 때 그 사람 것만 끊을 수 있어야 한다.
`WF_ACCESS_TOKEN` 하나를 팀원 전원이 공유하면 한 명이 유출해도 누구인지 알 수 없고,
바꾸는 순간 전원이 멈춘다.

**결론: REST를 MCP와 같은 자격증명 체계로 통합한다.** 새 체계를 만들지 않는다 — 이미 있는 걸 쓴다.

---

## 2. 설계

### 2-1. 검증 로직을 공용 미들웨어로 추출

`mcp-router.js:16-40`의 검증 코드를 `auth-credential.js`로 뽑아 REST와 MCP가 함께 쓴다.
(지금은 MCP에만 있고 REST는 다른 방식을 쓰는 것이 문제의 뿌리다)

```js
// auth-credential.js
function requireScope(scope) {
  return async (req, res, next) => {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ success:false, error:'unauthorized' });
    const keyHash = crypto.createHash('sha256').update(auth.slice(7)).digest('hex');
    const { rows } = await pool.query(
      `SELECT agent_id, scopes, expires_at FROM agent_credentials
       WHERE key_hash=$1 AND revoked_at IS NULL`, [keyHash]);
    if (!rows.length) return res.status(401).json({ success:false, error:'invalid_credentials' });
    if (rows[0].expires_at && new Date(rows[0].expires_at) < new Date())
      return res.status(401).json({ success:false, error:'expired' });
    if (scope && !parseScopes(rows[0].scopes).includes(scope))
      return res.status(403).json({ success:false, error:'insufficient_scope', need: scope });
    req.agent_id = rows[0].agent_id;
    req.scopes = rows[0].scopes || [];
    pool.query('UPDATE agent_credentials SET last_used_at=now() WHERE key_hash=$1',[keyHash]).catch(()=>{});
    next();
  };
}
```

### 2-1.5. ⚠️ `scopes`는 배열이 아니라 문자열이다 — 현재 검사는 우연히 맞고 있다

실측:

```
scopes raw : '{"mcp:read","mcp:execute"}'
타입       : str          ← 배열 아님 (Postgres 배열 리터럴이 문자열로 온다)
```

그런데 `mcp-router.js:247`은:

```js
if (scope && !(req.scopes || []).includes(scope)) { ... }
```

`req.scopes`가 문자열이므로 이건 **배열 멤버십이 아니라 부분 문자열 검사**다.
`'{"mcp:read","mcp:execute"}'.includes('mcp:admin')` → `false`,
`.includes('mcp:read')` → `true`.

**현재 스코프 3종(`mcp:read`/`mcp:execute`/`mcp:admin`)은 서로의 부분 문자열이 아니라서
결과가 우연히 맞다. 즉 지금 악용 가능한 상태는 아니다.** 그러나:

- `mcp:read`가 `mcp:readonly` 같은 이름 안에 걸린다
- `.includes('mcp:exec')`처럼 줄여 쓰면 통과한다
- 스코프를 하나만 추가해도 조용히 깨진다

> 이번 세션에서 **네 번째로 만나는 같은 유형**이다 — `node_count`, `agent.list` 필터, `online`,
> 그리고 이것. 전부 "코드가 있고, 그럴듯하고, 실제 동작은 다르다".

**조치:** 파싱 헬퍼를 두고 양쪽(REST·MCP)이 함께 쓴다.

```js
function parseScopes(v) {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return [];
  // Postgres 배열 리터럴: {"mcp:read","mcp:execute"}
  return v.replace(/^\{|\}$/g, '').split(',')
          .map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
}
```

`mcp-router.js:247`의 기존 검사도 같이 고쳐야 한다. (컬럼 타입을 `text[]`로 바꾸는 방법도
있으나 마이그레이션이 필요하고, 헬퍼 쪽이 배열·문자열 양쪽을 받아 더 안전하다)

### 2-2. 적용 범위

| 대상 | 요구 스코프 |
|---|---|
| `GET /api/*` (조회) | `mcp:read` |
| `POST/PUT/DELETE /api/*` (편집) | `mcp:execute` |
| `POST/DELETE /api/agents/:id/credentials` (발급·폐기) | **`mcp:admin`** |
| `GET /api/health` | 없음 (헬스체크) |
| `GET /.well-known/mcp-server-card` | 없음 (디스커버리) |

> **읽기에도 인증을 건다.** 팀 도구이므로 공개 URL 방문자에게 워크플로우 내용을 보일 이유가 없다.
> 키 없이 열면 "키를 입력하세요" 화면이 뜬다.

### 2-3. 부트스트랩 문제 — 첫 키는 누가 발급하나

발급에 `mcp:admin`이 필요하면, 아직 키가 없을 때 아무도 발급할 수 없다. 해결:

- 현재 **`ag_claude_desktop` 키가 `mcp:admin`을 보유**하고 있다 (`agent.whoami`로 확인). 이것이 부트스트랩 키다.
- 추가로 `WF_ACCESS_TOKEN`을 **관리자 우회 경로**로 남긴다 — 서버 접근 권한이 있는 사람만 아는 값이므로
  키를 전부 잃었을 때의 복구 수단이 된다.

```js
// 발급 라우트: admin 스코프 또는 WF_ACCESS_TOKEN
router.post('/api/agents/:id/credentials', requireAdminOrToken, ...)
```

### 2-4. 프론트엔드

```js
// index.html
const API_BASE = window.__WF_API__
  || (isLocal ? 'http://localhost:3737' : 'https://187.127.124.16.sslip.io');

const WF_KEY = localStorage.getItem('wf_api_key') || '';
// 모든 fetch에 Authorization: Bearer ${WF_KEY}
// 401 → 키 입력 모달, 403 → "권한 부족" 안내
```

- 키는 `localStorage`에 보관. **소스에 넣지 않는다** (공개 저장소)
- 키 입력/변경/삭제 UI 추가
- CORS는 **이미 준비됨** — `Access-Control-Allow-Headers: Content-Type,Authorization` +
  `OPTIONS → 204` 확인 완료. **서버 CORS 수정 불필요**

---

## 3. 실행 순서

| # | 작업 | 위치 | 비고 |
|---|---|---|---|
| 1 | `auth-credential.js` 추출 + 발급/폐기에 admin 요구 | 로컬 → VPS | **P0. 단독으로 먼저 배포 가능** |
| 2 | 팀원 키 발급 (사람별) | VPS | admin 키로 |
| 3 | REST 전체에 스코프 적용 | 로컬 → VPS | 3 배포 순간부터 무키 접근 차단 |
| 4 | 프론트 키 입력 UI + `API_BASE` 연결 | 로컬 → Pages | 3보다 **먼저** 배포해도 무방 |
| 5 | `WF_ACCESS_TOKEN` 설정 (복구 경로) | VPS | |

> **1번은 지금 당장, 나머지와 분리해서** 처리하는 걸 권한다. 팀 도구 전환을 안 하더라도
> 자격증명 API가 열려 있는 상태는 그 자체로 위험하다.

> **3번과 4번의 순서 주의:** 3을 먼저 배포하면 키를 넣기 전까지 웹 UI가 전부 401이 된다.
> 4를 먼저 배포하면 키 없이도 기존처럼 동작하다가 3 배포 시점에 자연스럽게 전환된다.
> **4 → 3 순서를 권한다.**

---

## 4. 남는 선택지

- **키 배포 방법** — 팀원에게 키를 어떻게 전달할지는 정해야 한다 (직접 전달 / 웹 UI 발급 화면)
- **에이전트 vs 사람** — 현재 `agent_credentials`는 `agent_id`에 묶인다. 사람마다 키를 주려면
  사람용 에이전트를 만들거나(`ag_user_홍길동`), 테이블에 `owner` 개념을 쓰는 방법이 있다.
  `agents` 테이블에 이미 `owner` 컬럼이 **존재하나 전부 빈 문자열**이다 — 여기를 쓰면 자연스럽다.

---

## 검증 범위

**직접 확인함:** 자격증명 GET이 무인증 200 · `requireAuth`의 단일 토큰 비교 ·
`mcp-router` 자격증명 검증 로직 · CORS의 `Authorization` 허용과 OPTIONS 204 ·
`agents.owner` 컬럼 존재와 빈 값 · `ag_claude_desktop`의 `mcp:admin` 보유

**확인하지 않음:** 자격증명 **발급·폐기** 쓰기 경로 (코드 판단만 — 같은 라우터에 인증 분기가
없다는 근거) · 스코프 문자열 검사가 실제 요청에서 오작동하는 시나리오 (현재 스코프 3종으로는
재현되지 않음)
