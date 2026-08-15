# 🔔 할매봇 작업 지시서 #4 — rollback 게이트 + 승인 버튼 웹훅

발신: Claude Code (로컬)
수신: **할매봇 (VPS)**
작성일: 2026-08-15
대상 커밋: **`8fb464c`**
VPS 경로: `/opt/data/projects/workflow-builder`

> **지시서 #3 이후 두 건을 하나로 합쳤다.** 앞서 따로 전달된 rollback 지시와
> 웹훅 지시는 각각 `7632f55` · `36a3225` 기준이라 낡았다. **이 문서만 따르면 된다.**

---

## 현재 상태 (로컬에서 실측)

```
승인 게이트 required : ['deploy', 'credential.issue']   ← rollback 없음
POST /api/telegram/webhook : 404                        ← 라우트 미배포
대기 승인 : 3건 (id 3,4,5 — 테스트 데이터)
```

세 가지 모두 이 문서로 처리한다.

---

## STEP 1 — 코드 받기

```bash
cd /opt/data/projects/workflow-builder
git status --short          # 비어 있어야 한다
git pull origin main        # 8fb464c

node --check server.js && node --check notify.js
node ops/run-tests.js                 # 62건 전부 통과 기대
```

하나라도 FAIL 이면 멈추고 보고할 것.

---

## STEP 2 — 환경변수 (한 번에 처리)

`ecosystem.config.js` 의 env 에 아래를 반영한다. **rollback 추가와 웹훅 설정을 함께 넣는다.**

```js
WF_APPROVAL_REQUIRED: "deploy,credential.issue,rollback",   // ← rollback 추가
WF_TELEGRAM_WEBHOOK_SECRET: "<아래 명령으로 생성>",
WF_PUBLIC_URL: "https://187.127.124.16.sslip.io",
```

비밀값 생성:
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

### 왜 rollback 인가

지금은 `deploy` 가 승인을 거치는데 `rollback` 은 자동 통과다. **비대칭이라 위험하다.**
`5f81cf5` 이전으로 되돌리면 자격증명 API 가 다시 무인증으로 열리는데, 그 일이
아무 알림 없이 일어난다. 배포에 승인이 필요하면 되돌리기에도 필요하다.

### `WF_TELEGRAM_WEBHOOK_SECRET` 이 없으면

서버가 **모든 웹훅을 거부**한다. 버튼을 눌러도 아무 일이 안 일어난다면 십중팔구 이 값이다.
이 값을 로그·채팅·저장소에 남기지 말 것.

적용:
```bash
npx pm2 restart workflow-builder --update-env
npx pm2 logs workflow-builder --lines 20 --nostream
```

로그 확인:
```
[approval] 승인 필요(env): deploy, credential.issue, rollback
[approval] ⚠ 자동 통과: workflow.execute, credential.revoke, schema.change, code.change, agent.write
```

---

## STEP 3 — 웹훅 등록

```bash
node ops/setup-telegram-webhook.js            # 상태 조회
node ops/setup-telegram-webhook.js --apply    # 등록
```

출력 확인:

| 항목 | 기대값 |
|---|---|
| `url` | `https://187.127.124.16.sslip.io/api/telegram/webhook` |
| `허용 업데이트` | `callback_query` |
| `⚠ 마지막 오류` | **없어야 정상** |

오류가 있으면 그 문구를 **그대로** 보고할 것. 인증서 문제면 Let's Encrypt 갱신 상태도 함께 확인.

---

## STEP 4 — 검증

### 4-1. 라우트가 살아있는가

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Content-Type: application/json" -d '{}' \
  https://187.127.124.16.sslip.io/api/telegram/webhook
```

| 결과 | 판정 |
|---|---|
| **403** | ✅ 정상 — 배포됐고 secret 검사가 동작한다 |
| 404 | ❌ 미배포 — pm2 재시작 확인 |
| 200 | ❌ **위험** — secret 검사를 통과했다는 뜻. 즉시 보고 |

> 200 이 나오면 누구나 승인을 위조할 수 있는 상태다. 그 경우 웹훅을 해제하고
> (`--delete`) 원인을 먼저 찾을 것.

### 4-2. 설정

```bash
curl -s -H "Authorization: Bearer <ADMIN_KEY>" \
  http://127.0.0.1:3737/api/approvals/config
```
→ `required` 에 `deploy, credential.issue, rollback` 세 개, `auto` 에서 `rollback` 빠짐

### 4-3. 버튼 실제 동작 (핵심)

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"wf_id":"test","agent_id":"ag_hermes","action":"deploy",
       "context":"버튼 동작 테스트"}' \
  http://127.0.0.1:3737/api/approvals
```

텔레그램에 버튼 달린 메시지가 오면, **사용자가 눌렀을 때**:

- 버튼 로딩이 즉시 풀리고 "승인했습니다" 안내
- 메시지 아래 `✅ 승인됨 · @누구` 추가
- **버튼이 사라진다** (중복 클릭 방지)

서버 로그: `[tg] 승인 <id> → approved (@누구)`

DB 확인:
```bash
curl -s -H "Authorization: Bearer <ADMIN_KEY>" \
  http://127.0.0.1:3737/api/approvals/pending
```
→ 방금 건이 목록에서 빠져 있어야 한다

---

## STEP 5 — 정리

### 테스트 승인 3건

id 3,4,5 는 `agent_id`·`context` 가 빈 테스트 데이터다. 정리해도 된다:

```bash
for i in 3 4 5; do
  curl -s -X POST -H "Authorization: Bearer <ADMIN_KEY>" \
    -H "Content-Type: application/json" \
    -d '{"decision":"rejected","approver":"cleanup"}' \
    http://127.0.0.1:3737/api/approvals/$i/decide
done
```

### ag_hermes owner 실명화

현재 `owner` 가 `"사용자"` 라 귀속이 의미가 없다. 실제 담당자 이름으로:

```bash
curl -X POST -H "Authorization: Bearer <ADMIN_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"id":"ag_hermes","name":"할매봇","person":"커멘드센터",
       "role":"VPS 배포·운영·검증","color":"#7c8db5","owner":"<실명>",
       "machine":{"env":"VPS","workspace":"/opt/data/agents/ag_hermes",
                  "capabilities":["deploy","verify","operate"],
                  "tools":["git","pm2","psql"],"trust_score":50}}' \
  http://127.0.0.1:3737/api/agents
```

> `machine` 을 **통째로** 다시 보내야 한다. 일부만 보내면 나머지 키가 사라진다.

---

## 롤백

```bash
git checkout 3cb87c3 -- server.js notify.js
npx pm2 restart workflow-builder
node ops/setup-telegram-webhook.js --delete
```

> 롤백해도 자격증명 API 보호(`5f81cf5`)는 유지된다. 이번 변경은 그 위에 얹은 것이다.

---

## 하지 말 것

1. **`WF_TELEGRAM_WEBHOOK_SECRET` 을 비우거나 secret 검사를 우회하지 말 것.**
   이 엔드포인트는 인터넷에 공개돼 있다. 검사가 없으면 URL 을 아는 누구나 승인을 위조한다
2. **`WF_TELEGRAM_CHAT_ID` 를 비우지 말 것** — 채팅 제한이 풀린다
3. **`WF_APPROVAL_REQUIRED` 를 빈 문자열로 두지 말 것** — 전 작업이 승인 없이 실행된다
4. **버튼이 안 되면 승인 게이트를 끄는 식으로 우회하지 말 것.**
   `setup-telegram-webhook.js` 의 `last_error_message` 부터 볼 것
5. **`wf_approvals` · `agents` 를 SQL 로 직접 수정하지 말 것**

---

## 보고 양식

```
[1] 코드
- HEAD : ______ (8fb464c 기대)
- npm test (4스위트 62건) : __/62

[2] 환경변수
- WF_APPROVAL_REQUIRED       : ______
- WF_TELEGRAM_WEBHOOK_SECRET : 설정함 (값 기재 금지)
- WF_PUBLIC_URL              : ______
- restart --update-env       : 완료 / 실패
- [approval] 부팅 로그 required : ______

[3] 웹훅
- url             : ______
- allowed_updates : ______
- last_error      : 없음 / ______

[4] 검증
- 웹훅 라우트 상태코드 : ____ (403 기대)
- config required      : ______
- 버튼 눌림 반응       : Y / N
- 메시지 갱신·버튼 제거 : Y / N
- pending 에서 빠짐    : Y / N
- 서버 로그 [tg] 줄    : ______

[5] 정리
- pending 3,4,5   : 처리함 / 보류
- ag_hermes owner : ______

[결과] 완료 / 진행 / 차단(사유)
```

작업 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록할 것.
