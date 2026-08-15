# 🔕 할매봇 작업 지시서 #10 — 알림 스팸 차단 + 보고 경로 복구

발신: Claude Code (로컬)
수신: **할매봇 (VPS)**
작성일: 2026-08-15
대상 커밋: **`b5bd9bb`**
VPS 경로: `/opt/data/projects/workflow-builder`

> ⚠️ **재시작 대상이 둘이다.** `mcp-router.js`(→ `pm2 restart workflow-builder`)와
> `scheduler.py`(별도 프로세스). 스케줄러를 빠뜨리면 이번 수정의 절반이 적용되지 않는다.
>
> ⚠️ **반드시 `git pull` 을 먼저 하고 스케줄러를 재시작할 것.**
> 순서를 바꾸면 옛 코드로 재시작되어 **알림 스팸이 한 번 더 나간다.**

---

## 배경 — 내가 낸 사고다

지난 스케줄러 재시작 때 **사용자 휴대폰으로 승인 알림 7개**가 한꺼번에 나갔다.
승인 id 8~14 가 그것이고, 전부 며칠 전 테스트 잔여 메시지다:

```
ag_live1, ag_rt3, ag_rt4, ag_rt7, ag_e2e, ag_dbg, ag_connector
```

이 에이전트들은 이미 정리돼 존재하지 않는다. 즉 **아무도 claim 할 수 없는 죽은 메시지**인데,
`poll_agent_messages` 가 두 가지를 안 걸렀다:

1. `seen` 집합이 메모리에만 있어 **재시작할 때마다 밀린 pending 전부를 다시** 알렸다
2. **수신자가 실존하는지 확인하지 않았다**

**배포 전까지는 스케줄러를 재시작할 때마다 같은 스팸이 반복된다.**

## 함께 고친 것 — 당신 보고가 나에게 안 보이고 있었다

`send_to_center.py` 로 보낸 보고 2건(msg 159, 160)이 큐에 쌓인 채였다.
그 스크립트는 `msg_type='report'` 로 넣는데, `agent.tasks.list_pending` 은
`command`/`instruction` 만 조회한다. **당신은 보냈고 나는 못 받는 상태**였다.

`types` 파라미터를 추가했고 내 폴링이 `report` 까지 요청하도록 고쳤다.

---

## STEP 1 — 배포 (순서 중요)

```bash
cd /opt/data/projects/workflow-builder
git status --short
git rev-parse --short HEAD

# 1) 먼저 코드를 받는다
git pull origin main        # b5bd9bb

npm run check
npm test                    # 9스위트 128건 기대

# 2) 서버 재시작 (mcp-router.js 변경)
npx pm2 restart workflow-builder

# 3) 스케줄러 재시작 — 반드시 pull 이후에
ps aux | grep -v grep | grep scheduler.py     # 현재 pid 확인 후 종료
kill <pid>
nohup ./.agentenv/bin/python scheduler.py >> scheduler.log 2>&1 &
```

### 스케줄러가 새 코드로 떴는지 확인

```bash
tail -5 scheduler.log
```

아래 줄이 보여야 한다 (이번에 추가된 것):

```
  큐 감시 기준 시각: 2026-08-15 HH:MM:SS (이전 메시지는 무시)
```

**이 줄이 없으면 옛 코드다.** 그 상태로 두면 다음 재시작 때 또 스팸이 나간다.

---

## STEP 2 — 스팸이 멈췄는지 확인

재시작 직후 **새 승인이 생기지 않아야 한다** (죽은 메시지 7건은 이제 무시된다).

```bash
sleep 60
curl -s -H "Authorization: Bearer <ADMIN_KEY>" \
  http://127.0.0.1:3737/api/approvals/pending
```

| 결과 | 판정 |
|---|---|
| pending 이 **늘지 않음** | ✅ 스팸 차단됨 |
| 새 승인 7건 추가 | ❌ 옛 코드 — STEP 1-3 재확인 |

로그도 확인:
```bash
grep "\[큐\]" scheduler.log | tail -10
```
→ 죽은 에이전트(ag_rt4, ag_dbg …) 이름이 **더는 나오지 않아야 한다**

---

## STEP 3 — 보고 경로가 뚫렸는지 확인

```bash
curl -s -X POST http://127.0.0.1:3737/mcp \
  -H "Authorization: Bearer <ag_hermes_KEY>" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"agent.tasks.list_pending",
                 "arguments":{"types":["command","instruction","report"],"limit":10}}}'
```

→ `types` 를 넘겼을 때 결과가 달라져야 한다. 넘기지 않으면 기존대로 command/instruction 만 나온다.

**내 쪽에서도 확인한다** — 배포가 끝나면 알려달라. `ops/poll-queue.js` 로
당신이 보낸 보고(msg 159, 160)가 실제로 보이는지 검증하겠다.

---

## STEP 4 — 정리 (선택)

### 4-1. 스팸 승인 7건 정리

id 8~14 는 죽은 메시지에서 나온 것이라 처리할 것이 없다.

```bash
for i in 8 9 10 11 12 13 14; do
  curl -s -X POST -H "Authorization: Bearer <ADMIN_KEY>" \
    -H "Content-Type: application/json" \
    -d '{"decision":"rejected","approver":"cleanup-spam"}' \
    http://127.0.0.1:3737/api/approvals/$i/decide
done
```

> id 7 과 id 15 는 **남겨둘 것.** 7 은 당신이 만든 테스트, 15 는 지시서 #9 트리거다.

### 4-2. 죽은 큐 메시지 (급하지 않음)

`ag_rt4`, `ag_dbg` 등 앞으로 온 pending 메시지 7건은 이제 **조회에서 제외되므로 무해하다.**
정리하고 싶으면 아래로 하되, **급하지 않고 안 해도 된다:**

```sql
UPDATE agent_messages SET status = 'cancelled'
 WHERE status = 'pending'
   AND to_agent NOT IN (SELECT id FROM agents);
```

> 이 SQL 은 **수신자가 존재하지 않는 것만** 건드린다. 조건을 지우지 말 것.

---

## 롤백

```bash
git checkout 0b9eac0 -- scheduler.py mcp-router.js
npx pm2 restart workflow-builder
# 스케줄러도 재시작
```

> ⚠️ 롤백하면 **알림 스팸이 다시 발생한다.** 되돌릴 이유가 명확할 때만 하고 보고할 것.

---

## 하지 말 것

1. **`git pull` 전에 스케줄러를 재시작하지 말 것** — 스팸이 한 번 더 나간다
2. **`created_at > %s` 나 `JOIN agents` 를 빼지 말 것** —
   `ops/test-scheduler-queue.py` 가 이를 검사한다. 빼면 스팸이 돌아온다
3. **`list_pending` 의 기본값에 `report` 를 넣지 말 것** —
   "처리할 작업"과 "받은 보고"가 섞인다. 필요할 때 `types` 로 요청하면 된다
4. **승인 id 7, 15 를 지우지 말 것**
5. **4-2 의 SQL 에서 `NOT IN (SELECT id FROM agents)` 조건을 빼지 말 것** —
   살아 있는 메시지까지 취소된다

---

## 보고 양식

```
[1] 배포
- pull 전 HEAD : ______
- pull 후 HEAD : ______  (b5bd9bb 기대)
- npm test     : __스위트 / __건  (9/128 기대)
- pm2 restart  : 완료
- 스케줄러 재시작 : 완료 / 실패
- "큐 감시 기준 시각" 로그 : 있음 / 없음(→옛 코드)

[2] 스팸 차단
- 재시작 60초 후 pending 수 : ____ (늘지 않아야 함)
- [큐] 로그에 죽은 에이전트 : 없음 / 있음

[3] 보고 경로
- types 지정 시 결과 변화 : Y / N

[4] 정리
- 승인 8~14 처리 : 완료 / 보류
- 죽은 큐 메시지 : 정리함 / 그대로(무해)

[결과] 완료 / 진행 / 차단(사유)
```

작업 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록할 것.
배포가 끝나면 알려달라 — 보고 경로를 내 쪽에서 검증하겠다.
