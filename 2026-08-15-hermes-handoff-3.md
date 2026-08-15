# 🔐 할매봇 작업 지시서 #3 — P0 보안 배포 (자격증명 API 무인증 차단)

발신: Claude Code (로컬 Windows 세션)
수신: **할매봇 (VPS Hermes 에이전트)**
작성일: 2026-08-15
대상 커밋: **`b561f19`** (main, 푸시 완료)
VPS 경로: `/opt/data/projects/workflow-builder`

> **이번엔 `pm2 restart`가 필수다.** `server.js` · `credentials-api.js` · `mcp-router.js`가
> 모두 바뀌었다. 지시서 #2와 다른 점이니 주의.

---

## 배경 — 왜 급한가

자격증명 API 3개가 **인증 없이 열려 있었다.**

`server.js:73`이 `requireAuth` 없이 마운트하고, `credentials-api.js` 라우터에도 인증이 없었다.

```
$ curl https://187.127.124.16.sslip.io/api/agents/ag_orch/credentials   # 헤더 없음
status=200
{"credentials":[{"key_prefix":"wf_ak_ag_orch_e-jVDS...", ...}]}
```

즉 **누구나 `mcp:read`+`mcp:execute` 키를 스스로 발급**할 수 있고, 남의 키를 **폐기**할 수도 있었다.

**이 커밋이 배포되기 전까지 그 상태가 계속된다.**

---

## STEP 1 — 배포

```bash
cd /opt/data/projects/workflow-builder

# 1) 현재 상태 확인
git status --short          # 비어 있어야 한다. 아니면 중단하고 보고
git rev-parse --short HEAD  # 8def5a5 예상

# 2) 받기
git pull origin main
git rev-parse --short HEAD  # b561f19 이어야 한다

# 3) 새 파일이 왔는지 확인 (이게 없으면 전부 실패한다)
ls -l auth-credential.js ops/test-auth-credential.js

# 4) 문법
node --check auth-credential.js
node --check credentials-api.js
node --check mcp-router.js
node --check server.js
```

---

## STEP 2 — 자동 검증 (재시작 전, DB 불필요)

```bash
node ops/test-auth-credential.js     # 18/18 기대
```

특히 이 두 건이 핵심이다:

- `부분 문자열 mcp:exec 는 불일치` — 기존 `.includes()` 오판이 고쳐졌는지
- `토큰 미설정이면 우회 불가` — 여기가 뚫리면 아무 문자열로나 admin 이 된다

**하나라도 FAIL 이면 재시작하지 말고 출력 그대로 보고할 것.**

---

## STEP 3 — 재시작

```bash
npx pm2 restart workflow-builder
npx pm2 logs workflow-builder --lines 40 --nostream
```

### 로그에서 반드시 확인할 것

```
[cred] credentials-api 마운트됨
```

**이 줄이 없고 `[cred] credentials-api 로드 실패` 가 보이면** `auth-credential.js` 를 못 찾은 것이다.
그 경우 자격증명 API가 아예 마운트되지 않아 404가 된다 (노출은 안 되지만 발급도 불가).
→ STEP 1-3의 `ls` 를 다시 확인하고 보고할 것.

---

## STEP 4 — 🔴 가장 중요: MCP가 여전히 살아있는지

**이번 변경에서 가장 위험한 부분이다.** `mcp-router.js`의 인증 경로에서 스코프 파싱을 바꿨다.
여기가 잘못되면 **모든 MCP 호출이 403이 되어 Claude Code 세션이 전부 끊긴다.**

```bash
curl -s -X POST https://187.127.124.16.sslip.io/mcp \
  -H "Authorization: Bearer <MCP_KEY>" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"agent.whoami","arguments":{}}}'
```

| 기대 | 판정 |
|---|---|
| `scopes` 가 **배열**로 보임 (`["mcp:read","mcp:execute","mcp:admin"]`) | ✅ 정상 — 이전엔 문자열이었다 |
| `insufficient_scope` 오류 | ❌ **즉시 롤백** (STEP 7) |
| `invalid_credentials` | ❌ 즉시 롤백 |

이어서 실행 스코프도 확인:

```bash
# workflow.list 는 mcp:read 필요 — 정상 응답이어야 함
curl -s -X POST .../mcp -H "Authorization: Bearer <MCP_KEY>" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"workflow.list","arguments":{"limit":3}}}'
```

---

## STEP 5 — 구멍이 막혔는지 확인

```bash
# 인증 헤더 없이 — 이전에는 200 이었다
curl -s -o /dev/null -w "%{http_code}\n" \
  https://187.127.124.16.sslip.io/api/agents/ag_orch/credentials
```

| 결과 | 판정 |
|---|---|
| **401** | ✅ 목표 달성 |
| 200 | ❌ 배포 안 됨 — 재시작 확인 |
| 404 | ⚠️ 라우터 미마운트 — STEP 3 로그 확인 |

관리자 키로는 여전히 되는지도 확인:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer <ADMIN_MCP_KEY>" \
  https://187.127.124.16.sslip.io/api/agents/ag_orch/credentials
# 200 이어야 한다 (ag_claude_desktop 키가 mcp:admin 보유)
```

`mcp:admin` 이 **없는** 키로는 403이 나와야 한다:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer <일반_MCP_KEY>" \
  https://187.127.124.16.sslip.io/api/agents/ag_orch/credentials
# 403 기대
```

> **쓰기(발급·폐기)는 시험하지 않아도 된다.** 같은 미들웨어가 걸려 있어 GET 결과로 충분하다.
> 굳이 확인하려면 폐기(DELETE)가 아니라 **발급(POST)** 으로 하고, 만든 키는 바로 폐기할 것.

---

## STEP 6 — 웹 UI 확인 (동작 변경 있음)

**키 발급 버튼에 관리자 키 입력이 생겼다.** 이전에는 아무나 눌러도 발급됐다.

1. 웹 UI → 팀 → 에이전트 → 자격증명 발급
2. **관리자 키 (mcp:admin)** 칸에 `ag_claude_desktop` 키 입력
3. 발급 성공 확인
4. 키를 비우거나 틀린 값을 넣으면 안내 문구가 뜨는지 확인 (401/403 구분)

> 관리자 키는 브라우저 `localStorage`에만 저장된다. 서버·소스에는 남지 않는다.

---

## STEP 7 — 롤백

```bash
git checkout 8def5a5 -- server.js credentials-api.js mcp-router.js index.html
rm -f auth-credential.js          # 남아 있어도 무해하지만 정리
npx pm2 restart workflow-builder
```

또는 전체:

```bash
git reset --hard 8def5a5 && npx pm2 restart workflow-builder
```

> **롤백하면 자격증명 API가 다시 무인증으로 열린다.** 롤백은 MCP가 끊긴 경우처럼
> 더 큰 장애가 났을 때만 선택하고, 그 사실을 보고에 명시할 것.

**DB 롤백은 불필요하다.** 이번 변경은 스키마를 건드리지 않는다.

---

## 하지 말 것

1. **`WF_MCP_OPEN=1` 로 문제를 우회하지 말 것** — MCP가 403이면 원인을 보고하라.
   이 변수는 인증을 통째로 끄는 것이라 지금 상황에서 켜면 P0를 되살리는 셈이다
2. **`agent_credentials` 테이블을 직접 수정하지 말 것**
3. **STEP 2가 FAIL 인 채로 재시작하지 말 것**
4. **관리자 키를 로그·보고서에 붙여넣지 말 것** — 상태 코드만 기재
5. **`auth-credential.js` 를 수정하지 말 것** — REST와 MCP가 함께 쓴다. 한쪽만 고치면 어긋난다

---

## 함께 들어간 변경 (참고)

| 항목 | 내용 |
|---|---|
| `parseScopes` | `scopes` 가 문자열(`'{"mcp:read",...}'`)이라 `.includes()` 가 부분 문자열 검사였다. 배열로 정규화 |
| 감사 로그 `actor` | 대상 에이전트가 아니라 **요청 주체**를 기록하도록 정정 |
| `agents.owner` | `POST /api/agents` 가 `owner` 를 아예 안 써서 16명 전원 빈 값이었다. 추가하되 **본문에 없으면 기존 값 보존**(COALESCE) |
| 프론트 발급 호출 | 상대 경로였던 것을 `API_BASE` 기준으로 정정 |

---

## 보고 양식

```
[STEP 1] 배포
- git status --short : 비어 있음 / 내용 있음(→중단)
- pull 전 HEAD : ______  (8def5a5 기대)
- pull 후 HEAD : ______  (b561f19 기대)
- auth-credential.js 존재 : Y / N
- node --check 4개 : 전부 통과 / 실패(파일명)

[STEP 2] 자동 검증
- ops/test-auth-credential.js : __/18
- FAIL 항목 (있으면 출력 그대로):

[STEP 3] 재시작
- pm2 restart : 성공 / 실패
- "[cred] credentials-api 마운트됨" 로그 : 있음 / 없음
- 기타 에러 로그 :

[STEP 4] MCP 생존 (최우선)
- agent.whoami : 성공 / insufficient_scope / invalid_credentials
- scopes 가 배열로 보이는가 : Y / N
- workflow.list : 성공 / 실패

[STEP 5] 구멍 차단
- 무인증 GET credentials  : ____ (401 기대)
- admin 키 GET            : ____ (200 기대)
- 일반 키 GET             : ____ (403 기대)

[STEP 6] 웹 UI
- 관리자 키 입력 후 발급 : 성공 / 실패
- 키 없이 발급 시도 안내 : 정상 / 이상

[결과] 완료 / 진행 / 차단(사유)
```

보고 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록하고,
상단 「⚠️ 배포 대기」 절은 배포가 끝났으면 지울 것.
