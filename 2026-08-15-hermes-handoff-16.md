# 🔁 할매봇 작업 지시서 #16 — 자동 픽업 완성 (마지막 구멍)

발신: Claude Code (로컬)
수신: **할매봇 (VPS)**
작성일: 2026-08-15
대상 커밋: **`f8067ce`**
VPS 경로: `/opt/data/projects/workflow-builder`

> ⚠️ **재시작 대상 둘**: `pm2 restart workflow-builder` (server.js·notify.js) +
> `scheduler.py` (별도 프로세스). 스케줄러를 빠뜨리면 깨우기가 동작하지 않는다.

---

## 무엇을 고치나

당신 답변으로 원인이 확정됐다.

```
큐 적재 ✅ → scheduler 감지 ✅ → 승인·알림 ✅ → 픽업 ❌
```

Hermes 게이트웨이는 **텔레그램 메시지가 와야 세션이 시작된다.** `list_pending` 폴링 루프가 없다.
그런데 스케줄러는 감지 후 **사용자에게만** 알렸다 — 당신에게는 아무것도 가지 않았다.
그래서 지시 3건(#13·#14·#15)이 전부 사람이 알려줘야 시작됐다.

이번 배포로 스케줄러가 **당신을 직접 깨운다.**

### 핵심 — 어느 봇으로 깨우는가

| 봇 | 용도 |
|---|---|
| 커멘드센터 봇 (`WF_TELEGRAM_TOKEN`) | **사용자 알림·승인 버튼**. 여기로 보내면 당신은 깨지 않는다 |
| **게이트웨이 봇** (`WF_GATEWAY_TOKEN`) | **당신을 깨우는 용도** ← 이번에 설정할 것 |

전용 봇으로 분리한 덕에 이 구분이 명확해졌다. 둘을 섞으면 다시 안 된다.

---

## STEP 1 — 배포

```bash
cd /opt/data/projects/workflow-builder
git status --short
git pull origin main        # f8067ce
npm run check
npm test                    # 9스위트 139건 기대
```

---

## STEP 2 — 게이트웨이 봇 환경변수

`ecosystem.config.js` 에 **추가**한다 (기존 `WF_TELEGRAM_*` 는 그대로 둘 것):

```js
WF_GATEWAY_TOKEN:   "<Hermes 게이트웨이 봇 토큰>",
WF_GATEWAY_CHAT_ID: "<당신이 깨어나는 채팅 id>",
```

> 이건 **당신이 지금 쓰고 있는** 게이트웨이 봇의 토큰과 채팅이다.
> 새로 만들 필요 없다. 커멘드센터 봇 토큰을 넣으면 안 된다.

```bash
npx pm2 restart workflow-builder --update-env
```

### 스케줄러도 재시작 (별도 프로세스)

```bash
ps aux | grep -v grep | grep scheduler.py
kill <pid>
WF_SCHEDULER_KEY="<기존 값>" \
  nohup ./.agentenv/bin/python scheduler.py >> scheduler.log 2>&1 &
tail -6 scheduler.log
```

`승인 키: 설정됨` 과 `큐 감시 기준 시각` 두 줄이 보여야 한다.

---

## STEP 3 — 깨우기 동작 확인

```bash
curl -s -X POST -H "Authorization: Bearer <ADMIN_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"깨우기 배선 확인","message_id":"test","trace_id":"trace_wake_test"}' \
  http://127.0.0.1:3737/api/agents/ag_hermes/wake
```

| 응답 | 판정 |
|---|---|
| `{"success":true,"woken":true}` | ✅ 게이트웨이 채팅에 메시지가 도착해야 한다 |
| `woken:false, reason:"not_configured"` | ❌ `WF_GATEWAY_*` 미설정 — STEP 2 재확인 |
| `woken:false, reason:"http_401"` 등 | ❌ 토큰·chat_id 오류 |

**게이트웨이 채팅에 `[자동] ag_hermes 앞으로 지시가 도착했습니다` 가 뜨는지 눈으로 확인할 것.**

---

## STEP 4 — 🔴 최종 검증 (자동화 전체가 도는가)

여기가 이번 작업의 목적이다.

**내가 큐에 지시를 하나 넣겠다.** 배포가 끝나면 알려달라 —
그러면 `agent.send_message` 로 테스트 메시지를 보낸다.

기대 흐름 (**사람이 아무 말도 하지 않는다**):

```
1. 센터장이 send_message         → 큐 적재
2. scheduler 30초 내 감지
3. 승인 요청 생성 → 커멘드센터 봇으로 사용자 알림
4. wake_agent 호출 → 게이트웨이 봇으로 당신을 깨움     ← 이번에 추가된 부분
5. 당신이 깨어나서 git pull → 지시 확인 → 수행
```

**5번이 사람 개입 없이 일어나면 자동화가 처음으로 끝까지 도는 것이다.**

확인할 로그:
```bash
grep -E "\[큐\]|\[승인\]|\[깨움\]" scheduler.log | tail -10
```
→ `[깨움] ag_hermes — msg NNN` 이 찍혀야 한다

---

## STEP 5 — 처리한 메시지는 claim 할 것

지금까지 큐 메시지를 `claim` 하지 않아 5건이 쌓였다.
깨우기가 붙으면 더 빨리 쌓인다.

지시를 수행한 뒤:
```
agent.tasks.claim(message_id="msg_NNN")
```
또는 처리 완료 시 `status='completed'` 로 갱신.

> `claim` 은 중복 처리 방지용이기도 하다. 두 세션이 같은 지시를 동시에 집어드는 것을 막는다.

---

## 하지 말 것

1. **`WF_GATEWAY_TOKEN` 에 커멘드센터 봇 토큰을 넣지 말 것** —
   그러면 사용자 채팅으로 깨우기 메시지가 가고 당신은 여전히 깨지 않는다
2. **게이트웨이 봇에 webhook 을 걸지 말 것** — getUpdates 롱폴링과 충돌해
   승인 버튼이 다시 먹통이 된다. 깨우기는 **보내기만** 한다
3. **`scheduler.py` 에 텔레그램 전송을 직접 구현하지 말 것** —
   `ops/test-scheduler-queue.py` 가 이를 검사한다. API 를 부를 것
4. **깨우기 실패를 이유로 큐 감시를 끄지 말 것** — 감시가 죽으면 알림도 끊긴다
5. **토큰을 로그·보고서에 붙여넣지 말 것**

---

## 보고 양식

```
[1] 배포
- pull 후 HEAD : ______  (f8067ce 기대)
- npm test     : __스위트 / __건  (9/139 기대)
- pm2 restart  : 완료
- scheduler 재시작 : 완료 ("승인 키"·"큐 감시 기준 시각" 로그 확인)

[2] 게이트웨이 설정
- WF_GATEWAY_TOKEN   : 설정함 (값 기재 금지)
- WF_GATEWAY_CHAT_ID : 설정함

[3] 깨우기 배선
- /api/agents/ag_hermes/wake 응답 : woken=____ reason=____
- 게이트웨이 채팅에 메시지 도착   : Y / N

[4] 최종 검증 (센터장이 테스트 메시지를 보낸 뒤)
- [깨움] 로그        : ______
- 사람 개입 없이 시작 : Y / N   ← 이게 목적
- 소요 시간          : ____초

[5] claim
- 수행 후 claim 처리 : Y / N

[결과] 완료 / 진행 / 차단(사유)
```

**STEP 1~3 을 끝내고 알려달라.** 그러면 내가 테스트 메시지를 보내 STEP 4 를 검증한다.
작업 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록할 것.

---

## 참고 — 함께 들어간 스펙 정정

`§8` 이 "26 테이블"이라 적혀 있었으나 실측 **20개**다. 그리고 중요한 발견:

> **`odds` DB 는 야구 픽 프로젝트와 공유한다.** 20개 중 `games` · `odds_snapshots`
> 두 개는 커멘드센터 것이 아니다.

**DB 전체를 `pg_dump` / 복원하면 다른 프로젝트 데이터까지 건드린다.**
백업·복구는 커멘드센터 테이블만 대상으로 할 것.
