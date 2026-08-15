# 🧪 할매봇 작업 지시서 #5 — 테스트 체계 + MCP 계약 수정 배포

발신: Claude Code (로컬)
수신: **할매봇 (VPS)**
작성일: 2026-08-15
대상 커밋: **`117368b`**
VPS 경로: `/opt/data/projects/workflow-builder`

> **재시작 필요.** `mcp-router.js` · `server.js` · `credentials-api.js` 가 바뀐다.

---

## 배경

로컬에서 확인한 현재 VPS 상태:

```
workflow.list(limit=3) → 39개 반환    ← limit 이 무시된다 = 미배포
```

이번 배포로 들어가는 것:

1. **로드맵 1-4** — `npm test` 한 명령으로 6스위트 97건
2. **로드맵 1-1** — 조용히 삼키던 예외 17곳에 흔적 남기기 + 재발 가드
3. **로드맵 1-2(정적)** — MCP 툴 계약 검사 + 선언만 돼 있던 파라미터 3건 구현

---

## ⚠️ 동작이 바뀌는 것 (배포 전 확인)

| 툴 | 이전 | 이후 |
|---|---|---|
| `workflow.list` `limit` | **무시됨** (항상 전체) | 실제로 적용됨 (최대 500) |
| `workflow.list` `tag` | 무시됨 | **스키마에서 제거** (컬럼이 없어 구현 불가) |
| `agent.tasks.list_pending` `since` | 무시됨 | 실제로 적용됨 |
| `workflow.get_trace` `include_children` | 무시됨 | 실제로 적용됨 (기본 true) |

> **`limit` 을 넘기던 호출자가 있으면 결과 개수가 줄어든다.** 지금까지는 전체가 왔다.
> 미지정 시에는 기존대로 전체를 반환하므로, 파라미터를 안 쓰던 쪽은 영향이 없다.

**로그가 늘어난다.** 빈 `catch` 17곳에 `console.warn` 이 붙었다.
평소 안 보이던 경고가 뜨면 그건 새 문제가 아니라 **원래 있던 문제가 이제 보이는 것**이다.
새 경고가 보이면 무시하지 말고 보고할 것 — 그게 이 변경의 목적이다.

---

## STEP 1 — 배포

```bash
cd /opt/data/projects/workflow-builder
git status --short           # 비어 있어야 한다
git rev-parse --short HEAD   # 현재값을 보고에 적을 것

git pull origin main         # 117368b

npm run check                # 문법 6파일
npm test                     # 6스위트 97건 기대
```

`npm test` 기대 출력:
```
✅ 자격증명 인증 (auth-credential)        —  17건 통과
✅ 승인 게이트·알림 (approval/notify)     —  19건 통과
✅ 텔레그램 웹훅 (telegram-webhook)       —  16건 통과
✅ 세션 상태 전이 (session-status)        —  10건 통과
✅ 조용한 예외 삼킴 없음 (no-silent-catch) —  11건 통과
✅ MCP 툴 계약 (mcp-contract)             —  24건 통과
스위트 6/6 통과 · 검사 97건 통과
```

**하나라도 FAIL 이면 재시작하지 말고 출력 그대로 보고할 것.**

> 파이썬 스위트가 `SKIP` 으로 나오면 `.agentenv` 를 못 찾은 것이다.
> 그 경우 "6/6 통과"가 아니라 "5개 통과 · 1개 건너뜀"으로 표시되니 구분할 것.

```bash
npx pm2 restart workflow-builder
npx pm2 logs workflow-builder --lines 40 --nostream
```

---

## STEP 2 — 배포 확인

### 2-1. limit 이 실제로 듣는가 (핵심)

```bash
curl -s -X POST https://187.127.124.16.sslip.io/mcp \
  -H "Authorization: Bearer <MCP_KEY>" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"workflow.list","arguments":{"limit":3}}}' \
  | head -c 300
```

| 결과 | 판정 |
|---|---|
| **3개** | ✅ 배포됨 |
| 39개(전체) | ❌ 미배포 — 재시작 확인 |

limit 없이 호출하면 **전체가 와야 한다**(기존 동작 유지):
```bash
... "arguments":{}  →  전체 반환
```

### 2-2. tools/list 에서 tag 가 빠졌는가

```bash
curl -s -X POST https://187.127.124.16.sslip.io/mcp \
  -H "Authorization: Bearer <MCP_KEY>" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | grep -o '"workflow.list"[^}]*}[^}]*}[^}]*}'
```
→ `properties` 에 `limit` 만 있고 `tag` 는 없어야 한다

### 2-3. MCP 가 여전히 살아있는가

```bash
... "params":{"name":"agent.whoami","arguments":{}}
```
→ `scopes` 가 배열로 정상 반환되어야 한다. `insufficient_scope` 면 **즉시 롤백**.

### 2-4. 새 경고 확인

```bash
npx pm2 logs workflow-builder --lines 100 --nostream | grep -E "^\[(mcp|wf|auth|cred|webhook|exec|llm|agent-ws)\]"
```

경고가 하나도 없으면 정상이다. **뜬 게 있으면 그 줄을 그대로 보고할 것** —
이번 변경으로 처음 보이게 된, 원래 있던 문제일 가능성이 높다.

---

## STEP 3 — 확인 요청 (조사)

`wf_workflows` 39행 전체의 `updated_at` 이 **2026-08-15 13:00:46 ~ 13:00:50** 에 몰려 있다.
서버 부팅(13:09:08)보다 **502초 앞서므로 재시작과는 무관**하다.

8/14 에도 같은 패턴이 있었고(그때는 원인 미상으로 남겨둠), 이번이 두 번째다.

**질문: 13:00 경에 워크플로우 정리나 일괄 저장 작업을 했는가?**

- 했다면 → 정상. `updated_at` 이 "최근 수정" 신호로 못 쓴다는 점만 기록하고 종결
- 안 했다면 → 아래로 확인
  ```sql
  SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
   WHERE tgrelid = 'wf_workflows'::regclass AND NOT tgisinternal;
  SELECT * FROM audit_logs
   WHERE created_at BETWEEN '2026-08-15 12:58' AND '2026-08-15 13:02'
   ORDER BY created_at;
  ```

> 보안 사안은 아니다(내부 작업 시간대와 겹친다). 다만 두 번 반복됐으니 원인은 알아두는 게 좋다.

---

## STEP 4 — 롤백

```bash
git checkout 9a16564 -- mcp-router.js       # 계약 수정만 되돌리기
# 또는 전체
git reset --hard <배포 전 HEAD>
npx pm2 restart workflow-builder
```

> 롤백해도 자격증명 보호(`5f81cf5`)와 승인 게이트는 유지된다.
> 이번 변경은 그 위에 얹은 것이다. DB 롤백은 불필요하다 — 스키마를 건드리지 않는다.

---

## 하지 말 것

1. **`npm test` 가 FAIL 인 채로 재시작하지 말 것**
2. **새로 뜬 `console.warn` 을 지우거나 다시 빈 `catch` 로 되돌리지 말 것.**
   `ops/test-no-silent-catch.js` 가 그걸 잡도록 만들어져 있다.
   경고가 거슬리면 원인을 고칠 것이지 로그를 없애지 말 것
3. **`workflow.list` 에 `tag` 를 다시 넣지 말 것** — `wf_workflows` 에 컬럼이 없다.
   진짜 필요하면 컬럼 추가가 먼저다(스키마 변경은 승인 대상)
4. **MCP 가 403 이어도 `WF_MCP_OPEN=1` 로 우회하지 말 것**

---

## 보고 양식

```
[1] 배포
- pull 전 HEAD : ______
- pull 후 HEAD : ______  (117368b 기대)
- npm run check : 통과 / 실패
- npm test      : __스위트 / __건   (6스위트 97건 기대)
- FAIL·SKIP 항목 (있으면 그대로):
- pm2 restart   : 완료 / 실패

[2] 배포 확인
- workflow.list(limit=3) → __개   (3 기대)
- workflow.list()        → __개   (전체 기대)
- tools/list 에 tag      : 없음 / 있음
- agent.whoami           : 정상 / insufficient_scope
- 새로 뜬 경고 (있으면 그대로):

[3] 조사
- 13:00 경 워크플로우 정리 작업 : 했음 / 안 했음
- (안 했으면) 트리거 조회 결과  :
- (안 했으면) audit_logs 결과   :

[결과] 완료 / 진행 / 차단(사유)
```

작업 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록할 것.
