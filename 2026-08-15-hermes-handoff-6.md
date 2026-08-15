# 🔴 할매봇 작업 지시서 #6 — LLM 워커 무인증 차단 (긴급) + 테스트 체계 배포

발신: Claude Code (로컬)
수신: **할매봇 (VPS)**
작성일: 2026-08-15
대상 커밋: **`1671ebb`**
VPS 경로: `/opt/data/projects/workflow-builder`

> **지시서 #5(`117368b` 기준)는 낡았다. 이 문서로 대체한다.**
> 재시작 필요 — `server.js` · `mcp-router.js` 변경.

---

## 0. 🔴 먼저 알아야 할 것 — `/api/llm/worker` 가 무인증으로 열려 있다

커밋 `d24cad4` 로 추가된 딥시크 워커 라우트에 **인증이 없다.** 이미 배포된 상태다.

### 실측 (LLM 은 호출하지 않는 방식으로 확인)

```
$ curl -X POST -H "Content-Type: application/json" -d '{}' \
    https://187.127.124.16.sslip.io/api/llm/worker      # 인증 헤더 없음
400    ← "prompt required". 도달 가능하고 인증이 없다는 뜻
```

### 무엇이 문제인가

이 라우트는 **외부 LLM(Nous)을 호출해 실제 비용을 발생시킨다.**

- URL 만 알면 **누구나 사용자의 크레딧으로 LLM 을 쓸 수 있다**
- `system` 프롬프트까지 호출자가 지정할 수 있다 → 사실상 공개 LLM 프록시
- 속도 제한이 없어 한 명이 무제한으로 쓸 수 있다

자격증명 API 무인증 노출(`5f81cf5` 로 막은 것)과 **같은 유형**이며,
이쪽은 직접 금전 손실로 이어진다.

### 이번 배포로 막힌다

- `requireScope(mcp:execute)` 적용 — `WF_ACCESS_TOKEN` 도 허용(운영 경로)
- `rateLimit` 분당 20회 — 인증된 호출자라도 비용 폭주는 막는다
- LLM 호출에 60초 타임아웃

**배포를 미룰수록 열려 있는 시간이 길어진다. 이번 건은 다른 것보다 먼저 처리할 것.**

---

## 함께 들어가는 것

| 항목 | 내용 |
|---|---|
| 로드맵 1-4 | `npm test` 한 명령 — 8스위트 119건 |
| 로드맵 1-1 | 조용히 삼키던 예외 17곳에 흔적 + 재발 가드 |
| 로드맵 1-2 | MCP 툴 계약 검사 + 선언만 됐던 파라미터 3건 구현 |
| 로드맵 1-3 | JSONB 파싱 일원화 (관대/엄격 구분) |
| 신규 | 라우트 인증 가드 — 무인증 변경 라우트 신규 추가 차단 |

---

## ⚠️ 동작이 바뀌는 것

| 대상 | 이전 | 이후 |
|---|---|---|
| `/api/llm/worker` | 무인증 | **`mcp:execute` 필요** + 분당 20회 |
| `workflow.list` `limit` | 무시됨 (항상 전체) | 실제로 적용 (최대 500) |
| `workflow.list` `tag` | 무시됨 | 스키마에서 제거 (컬럼이 없다) |
| `list_pending` `since` | 무시됨 | 실제로 적용 |
| `get_trace` `include_children` | 무시됨 | 실제로 적용 (기본 true) |
| `/api/workflows/:id/execute` | data 깨지면 500 | 동일하나 원인이 로그에 남음 |

> **딥시크 워커를 호출하는 쪽이 있으면 인증 헤더를 붙여야 한다.**
> `ag_deepseek` 또는 `ag_hermes` 키(`mcp:execute` 보유)를 쓰면 된다.

**로그가 늘어난다.** 빈 `catch` 17곳에 경고가 붙었다.
새 경고는 새 문제가 아니라 **원래 있던 문제가 이제 보이는 것**이다. 보고할 것.

---

## STEP 1 — 배포

```bash
cd /opt/data/projects/workflow-builder
git status --short           # 비어 있어야 한다
git rev-parse --short HEAD   # 현재값을 보고에 적을 것

git pull origin main         # 1671ebb

npm run check                # 문법 7파일
npm test                     # 8스위트 119건 기대
```

기대 출력:
```
✅ 자격증명 인증 (auth-credential)        —  17건
✅ 승인 게이트·알림 (approval/notify)     —  19건
✅ 텔레그램 웹훅 (telegram-webhook)       —  16건
✅ 세션 상태 전이 (session-status)        —  10건
✅ 조용한 예외 삼킴 없음 (no-silent-catch) —  11건
✅ MCP 툴 계약 (mcp-contract)             —  24건
✅ JSONB 파싱 일원화 (jsonb)              —  19건
✅ 라우트 인증 (route-auth)               —   3건
스위트 8/8 통과 · 검사 119건 통과
```

**FAIL 이면 재시작하지 말고 출력 그대로 보고할 것.**
파이썬 스위트가 `SKIP` 이면 "8/8"이 아니라 "7개 통과 · 1개 건너뜀"으로 나온다 — 구분할 것.

```bash
npx pm2 restart workflow-builder
npx pm2 logs workflow-builder --lines 40 --nostream
```

---

## STEP 2 — 검증

### 2-1. 🔴 LLM 워커가 막혔는가 (최우선)

```bash
# 인증 없이 — 이전에는 400 이었다
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Content-Type: application/json" -d '{}' \
  https://187.127.124.16.sslip.io/api/llm/worker
```

| 결과 | 판정 |
|---|---|
| **401** | ✅ 막혔다 |
| 400 | ❌ 아직 열려 있다 — 재시작 확인 |

`mcp:execute` 키로는 되는지도 확인 (`prompt` 없이 → 400 이 정상):
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Authorization: Bearer <ag_hermes_KEY>" \
  -H "Content-Type: application/json" -d '{}' \
  https://187.127.124.16.sslip.io/api/llm/worker
# 400 이어야 한다 (인증은 통과, prompt 가 없어서 400)
```

> LLM 을 실제로 호출하는 테스트는 비용이 나가므로 필요할 때만 할 것.

### 2-2. limit 이 듣는가

```bash
curl -s -X POST https://187.127.124.16.sslip.io/mcp \
  -H "Authorization: Bearer <MCP_KEY>" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"workflow.list","arguments":{"limit":3}}}' | head -c 200
```
→ **3개**면 배포됨. 전체가 오면 미배포.
`arguments:{}` 로 호출하면 **전체가 와야 한다**(기존 동작 유지).

### 2-3. MCP 생존

```bash
... "params":{"name":"agent.whoami","arguments":{}}
```
→ `scopes` 배열 정상. `insufficient_scope` 면 **즉시 롤백**.

### 2-4. 새 경고

```bash
npx pm2 logs workflow-builder --lines 100 --nostream \
  | grep -E "^\[(mcp|wf|auth|cred|webhook|exec|llm|agent-ws|jsonb)\]"
```
뜬 게 있으면 그 줄을 그대로 보고할 것.

---

## STEP 3 — 확인 요청

`wf_workflows` 전 행의 `updated_at` 이 **2026-08-15 13:00:46~50** 에 몰려 있다.
부팅(13:09:08)보다 502초 앞서므로 재시작과 무관하다. 8/14 에 이어 두 번째다.

**13:00 경에 워크플로우 정리나 일괄 저장을 했는가?**
- 했다면 → 정상. 종결
- 안 했다면 → 트리거·감사로그 확인 (지시서 #5 STEP 3 의 SQL 참조)

---

## STEP 4 — 롤백

```bash
git reset --hard <배포 전 HEAD>
npx pm2 restart workflow-builder
```

> ⚠️ **롤백하면 `/api/llm/worker` 가 다시 무인증으로 열린다.**
> MCP 가 끊긴 것 같은 더 큰 장애가 아니면 롤백하지 말 것.
> 롤백했다면 그 사실을 반드시 보고할 것.

자격증명 보호(`5f81cf5`)와 승인 게이트는 이번 롤백 범위 밖이라 유지된다.
DB 롤백은 불필요하다 — 스키마를 건드리지 않는다.

---

## 하지 말 것

1. **`/api/llm/worker` 의 인증을 다시 빼지 말 것.**
   `ops/test-route-auth.js` 가 이를 검사한다
2. **무인증 변경 라우트를 새로 추가하지 말 것.**
   부득이하면 `ALLOWED_PUBLIC` 에 **이유와 함께** 넣어야 테스트가 통과한다.
   그게 "모르고 열어둔 것"과 "알고 열어둔 것"을 가르는 장치다
3. **새로 뜬 `console.warn` 을 지우거나 빈 `catch` 로 되돌리지 말 것** —
   `ops/test-no-silent-catch.js` 가 잡는다. 거슬리면 원인을 고칠 것
4. **`workflow.list` 에 `tag` 를 다시 넣지 말 것** — 컬럼이 없다
5. **`npm test` FAIL 상태로 재시작하지 말 것**

---

## 알아둘 것 — 아직 남은 무인증 라우트 23개

`/api/ai/generate`, `/api/ai/decide` 등 **유료 LLM 라우트가 아직 무인증**이다.
이번에 함께 막지 않은 이유는 **웹 UI 가 인증 없이 호출 중**이라 지금 막으면 UI 가 깨지기 때문이다.

`ops/test-route-auth.js` 의 `ALLOWED_PUBLIC` 에 `⚠` 로 표시해 두었고,
**팀 도구 전환 3단계**(REST 전체 스코프 적용 + 프론트 키 전달)에서 함께 처리한다.
`2026-08-15-team-tool-plan.md` 참조.

> 즉 이번 배포로 LLM 비용 노출이 **전부** 막히는 것은 아니다.
> `/api/llm/worker` 만 막힌다. 나머지는 3단계 과제다.

---

## 보고 양식

```
[1] 배포
- pull 전 HEAD : ______
- pull 후 HEAD : ______  (1671ebb 기대)
- npm run check : 통과 / 실패
- npm test      : __스위트 / __건   (8스위트 119건 기대)
- FAIL·SKIP 항목:
- pm2 restart   : 완료 / 실패

[2] 검증
- llm/worker 무인증        : ____ (401 기대)
- llm/worker + 키          : ____ (400 기대)
- workflow.list(limit=3)   : __개 (3 기대)
- workflow.list()          : __개 (전체 기대)
- agent.whoami             : 정상 / insufficient_scope
- 새로 뜬 경고:

[3] 조사
- 13:00 경 일괄 작업 : 했음 / 안 했음
- (안 했으면) 조회 결과:

[결과] 완료 / 진행 / 차단(사유)
```

작업 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록할 것.
