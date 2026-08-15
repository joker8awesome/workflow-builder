# 🔑 할매봇 작업 지시서 #7 — 변경 API 인증 (2단계 배포)

발신: Claude Code (로컬)
수신: **할매봇 (VPS)**
작성일: 2026-08-15
대상 커밋: **`254032b`**
VPS 경로: `/opt/data/projects/workflow-builder`

> ⚠️ **이 지시서는 앞의 것들과 절차가 다르다.**
> 배포만으로는 아무것도 닫히지 않는다. **배포 → 사람이 UI 확인 → 플래그 켜기** 순서다.
> 중간에 사용자 확인이 반드시 들어가야 한다.

---

## 왜 2단계인가

무인증 변경 라우트 20개에 인증을 거는데, 그중 상당수를 **웹 UI 가 호출**한다.
한 번에 켜면 UI 가 전부 401 이 되어 아무것도 못 하게 된다.

그래서 `WF_REQUIRE_AUTH_ALL` 플래그로 배포와 시행을 분리했다:

```
A. 배포            → 동작 변화 없음 (플래그 꺼짐)
B. UI 에서 키 확인  → 사용자가 직접
C. 플래그 켜기      → 여기서 실제로 닫힌다
D. 검증
```

**C 까지 가야 유료 LLM 노출(`/api/ai/generate`, `/api/ai/decide`)이 닫힌다.**
A 만 하고 멈추면 아무것도 바뀌지 않는다.

---

## PHASE A — 배포 (안전, 동작 변화 없음)

```bash
cd /opt/data/projects/workflow-builder
git status --short
git rev-parse --short HEAD    # 보고에 기록

git pull origin main          # 254032b
npm run check
npm test                      # 8스위트 120건 기대
npx pm2 restart workflow-builder
```

### A-1. 아직 아무것도 안 닫혔는지 확인 (정상)

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Content-Type: application/json" -d '{}' \
  https://187.127.124.16.sslip.io/api/ai/decide
```
→ **401 이 아니어야 정상이다** (플래그가 꺼져 있으므로). 이 단계에서는 열려 있는 게 맞다.

### A-2. 이미 닫힌 것은 그대로인지

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Content-Type: application/json" -d '{}' \
  https://187.127.124.16.sslip.io/api/llm/worker
```
→ **401** (지시서 #6 에서 무조건 인증으로 막은 것. 플래그와 무관)

---

## PHASE B — 사용자용 키 발급 + UI 확인

### B-1. 웹 UI 를 쓸 사람의 키를 만든다

자격증명은 `agent_id` 에 묶이므로, 사람용 에이전트를 하나 만들고 거기에 발급한다.
`owner` 에 실명을 넣어 누구 것인지 남긴다.

```bash
# 사람용 에이전트
curl -X POST -H "Authorization: Bearer <ADMIN_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"id":"ag_user_주인","name":"주인","person":"커멘드센터",
       "role":"웹 UI 사용자","color":"#4da3ff","owner":"<실명>",
       "machine":{"env":"web"}}' \
  http://127.0.0.1:3737/api/agents

# 키 발급 — 편집이 필요하므로 mcp:execute 포함. admin 은 주지 않는다
curl -X POST -H "Authorization: Bearer <ADMIN_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"name":"web-ui","scopes":["mcp:read","mcp:execute"]}' \
  http://127.0.0.1:3737/api/agents/ag_user_주인/credentials
```

> 응답의 `key` 는 **이때만 보인다.** 사용자에게 안전한 경로로 전달하고,
> 로그·채팅·저장소에 남기지 말 것.

### B-2. 🧑 사용자가 직접 확인할 것 (할매봇이 대신할 수 없음)

웹 UI 를 열고:

1. 우측 상단 상태 표시(`서버 연결됨` / `로컬 저장`)를 **클릭**
2. 발급받은 키를 입력
3. 표시가 `서버 연결됨 🔑` 로 바뀌는지 확인
4. **워크플로우를 하나 저장해 보고 정상 동작하는지 확인**

**이 확인이 끝나기 전에는 PHASE C 로 넘어가지 말 것.**
키가 안 붙는 상태에서 플래그를 켜면 UI 가 전부 401 이 된다.

---

## PHASE C — 플래그 켜기 (여기서 실제로 닫힌다)

`ecosystem.config.js` 의 env 에 추가:

```js
WF_REQUIRE_AUTH_ALL: "1",
```

```bash
npx pm2 restart workflow-builder --update-env
```

> **재배포가 아니다.** 환경변수만 바뀐다. 문제가 생기면 `"0"` 으로 바꾸고
> 같은 명령을 다시 실행하면 즉시 원상복구된다.

---

## PHASE D — 검증

### D-1. 유료 LLM 라우트가 닫혔는가 (핵심)

```bash
for p in /api/ai/decide /api/ai/generate /api/exec /api/connector; do
  printf "%-20s " "$p"
  curl -s -o /dev/null -w "%{http_code}\n" -X POST \
    -H "Content-Type: application/json" -d '{}' \
    "https://187.127.124.16.sslip.io$p"
done
```
→ 전부 **401** 이어야 한다. 하나라도 아니면 그 경로를 보고할 것.

### D-2. 키로는 되는가

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Authorization: Bearer <ag_user_주인 키>" \
  -H "Content-Type: application/json" -d '{}' \
  https://187.127.124.16.sslip.io/api/ai/decide
```
→ **401 이 아니어야 한다** (400 등 — 본문이 없어서 나는 오류는 정상)

### D-3. 🧑 사용자가 UI 재확인

키를 넣은 상태에서 워크플로우 저장·실행이 되는지 다시 확인.
**여기서 깨지면 즉시 플래그를 끄고 보고할 것.**

### D-4. 스케줄러가 살아있는가

`scheduler.py` 는 `/api/approvals` 로 승인 요청을 만든다. 이 경로는 **의도적으로 열어뒀다**.

```bash
npx pm2 logs workflow-builder --lines 50 --nostream | grep -E "\[승인\]|\[큐\]"
```
→ 승인 요청 생성이 계속 되는지 확인. 401 이 뜨면 보고할 것.

---

## 롤백

```bash
# ecosystem.config.js 에서
WF_REQUIRE_AUTH_ALL: "0",
npx pm2 restart workflow-builder --update-env
```

코드 롤백은 필요 없다. 플래그만 끄면 배포 전 동작으로 돌아간다.

> 플래그를 껐다면 **유료 LLM 라우트가 다시 열린 상태**라는 뜻이다.
> 반드시 그 사실과 원인을 보고할 것.

---

## 하지 말 것

1. **PHASE B-2(사용자 UI 확인) 없이 PHASE C 로 넘어가지 말 것** — UI 가 죽는다
2. **발급한 키를 로그·채팅·보고서에 붙여넣지 말 것** — 상태 코드만 기재
3. **사용자 키에 `mcp:admin` 을 주지 말 것** — 편집에는 `mcp:execute` 로 충분하다.
   admin 을 주면 그 키로 다른 키를 발급할 수 있다
4. **UI 가 401 이라고 플래그를 켠 채 라우트에서 인증을 빼지 말 것** —
   그러면 `ops/test-route-auth.js` 가 실패한다. 키가 안 붙는 원인을 찾을 것
5. **`/api/approvals` 를 막지 말 것** — 스케줄러가 쓴다

---

## 남는 것 (이번 범위 밖)

- `/api/approvals` 는 여전히 무인증이다. 악용하면 사용자 텔레그램에 알림을 다량 보낼 수 있다.
  `scheduler.py` 에 키를 주고 닫는 것이 다음 과제다
- `/api/telegram/webhook`, `/api/webhook/:token` 은 자체 검증이 있어 그대로 둔다

---

## 보고 양식

```
[A] 배포
- pull 전 HEAD : ______
- pull 후 HEAD : ______  (254032b 기대)
- npm test     : __스위트 / __건  (8/120 기대)
- pm2 restart  : 완료 / 실패
- A-1 /api/ai/decide : ____ (401 아님이 정상)
- A-2 /api/llm/worker: ____ (401 기대)

[B] 키 발급 + UI
- ag_user_* 에이전트 생성 : 완료 / 실패
- 키 발급 (scopes)        : mcp:read, mcp:execute
- 🧑 사용자 UI 키 입력     : 완료 / 미완
- 🧑 상태 표시 '🔑' 확인   : Y / N
- 🧑 워크플로우 저장 동작  : Y / N
   ※ 위 3개가 Y 가 아니면 여기서 중단

[C] 플래그
- WF_REQUIRE_AUTH_ALL=1 : 완료
- restart --update-env  : 완료

[D] 검증
- /api/ai/decide    : ____ (401 기대)
- /api/ai/generate  : ____ (401 기대)
- /api/exec         : ____ (401 기대)
- /api/connector    : ____ (401 기대)
- 키로 호출         : ____ (401 아님 기대)
- 🧑 UI 재확인      : 정상 / 깨짐(→ 즉시 플래그 끄고 보고)
- 스케줄러 [승인] 로그 : 정상 / 401

[결과] 완료 / 진행 / 차단(사유)
```

작업 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록할 것.
