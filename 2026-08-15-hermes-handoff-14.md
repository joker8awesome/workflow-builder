# 🤖 할매봇 작업 지시서 #14 — 커멘드센터 전용 봇으로 전환

발신: Claude Code (로컬)
수신: **할매봇 (VPS)**
작성일: 2026-08-15
대상 커밋: **`90787fa`**
VPS 경로: `/opt/data/projects/workflow-builder`

> **지시서 #13 은 이걸로 대체한다.** 재등록만으로는 해결되지 않는 문제였다.

---

## 원인 (확정)

승인 버튼이 먹통인 이유는 secret 불일치가 아니었다.

```
/api/telegram/status
  acceptCount : 0
  rejectCount : 0        ← 거부조차 0건
  hint        : 콜백이 한 번도 도달하지 않았다
```

**거부가 0건**이라는 게 결정적이다. secret 이 틀렸거나 프록시가 헤더를 떼면
`rejectCount` 가 올라간다. 0 이면 요청 자체가 서버에 오지 않는다는 뜻이다.

당신이 확인해 준 대로:

```
pid 24666  hermes gateway  ← 같은 봇 토큰으로 getUpdates 롱폴링
```

**텔레그램은 한 봇에 webhook 과 getUpdates 를 동시에 허용하지 않는다.**
게이트웨이가 폴링을 도는 한, 웹훅을 등록해도 곧 해제된다.
그래서 재등록 → 얼마 뒤 (미등록) 이 반복됐다.

## 해결

**커멘드센터 전용 봇을 따로 쓴다.** 게이트웨이(pid 24666)는 건드리지 않는다 —
다른 용도로 쓰이는 채널이고, 끄면 그쪽이 죽는다.

---

## ⚠️ 전환하면 달라지는 것

**커멘드센터 알림이 새 봇 채팅으로 옮겨간다.**

- 승인 요청·완료 보고가 **새 봇과의 대화방**으로 온다
- 기존 Hermes 채널에는 커멘드센터 알림이 더 이상 오지 않는다
- 기존 채널의 다른 기능은 그대로다

사용자가 알림을 받을 곳이 바뀌므로, 전환 후 **새 대화방을 확인해야 한다.**

---

## PHASE A — 새 봇 만들기 (🧑 사용자)

1. 텔레그램에서 **@BotFather** 검색 → 대화 시작
2. `/newbot`
3. 봇 이름 입력 (예: `커멘드센터`)
4. 사용자명 입력 — `_bot` 으로 끝나야 함 (예: `joker8_command_center_bot`)
5. **HTTP API 토큰** 발급됨 (`123456789:AA...` 형식)
6. **새 봇과 대화를 시작하고 아무 메시지나 하나 보낸다** — `chat_id` 확보에 필요하다

> 🔑 **토큰은 할매봇에게만 전달한다.** 로그·보고서·저장소·공개 채널에 남기지 말 것.

---

## PHASE B — chat_id 확인

**웹훅을 걸기 전에만 가능하다.** 웹훅을 걸면 `getUpdates` 가 막힌다.

```bash
curl -s "https://api.telegram.org/bot<새토큰>/getUpdates" | head -c 600
```

응답에서 `result[].message.chat.id` 를 찾는다.
비어 있으면 PHASE A-6(새 봇에게 메시지 보내기)을 안 한 것이다.

---

## PHASE C — 배포 + 환경변수 교체

```bash
cd /opt/data/projects/workflow-builder
git pull origin main        # 90787fa
npm run check
npm test                    # 9스위트 135건 기대
```

`ecosystem.config.js` 수정:

```js
WF_TELEGRAM_TOKEN:   "<새 봇 토큰>",        // ← 교체
WF_TELEGRAM_CHAT_ID: "<PHASE B 에서 찾은 값>",  // ← 교체
WF_TELEGRAM_WEBHOOK_SECRET: "<기존 값 유지>",   // 그대로
WF_PUBLIC_URL: "https://187.127.124.16.sslip.io",
```

```bash
npx pm2 restart workflow-builder --update-env
```

---

## PHASE D — 웹훅 등록

```bash
node ops/setup-telegram-webhook.js --apply
node ops/setup-telegram-webhook.js          # 재조회
```

확인:
- `url` : `https://187.127.124.16.sslip.io/api/telegram/webhook`
- `허용 업데이트` : `callback_query`
- `⚠ 마지막 오류` : **없어야 정상**

---

## PHASE E — 검증

### E-1. 웹훅이 유지되는가 (이번 문제의 핵심)

이번 배포에 **10분마다 등록 상태를 확인하는 기능**이 들어간다.
전에는 조용히 해제돼도 알 수 없었다.

```bash
curl -s -H "Authorization: Bearer <ADMIN_KEY>" \
  http://127.0.0.1:3737/api/telegram/status
```

| 필드 | 기대 |
|---|---|
| `webhook_registered` | **true** |
| `configured` / `chat_id_set` / `notify_enabled` | 전부 true |

**10분 뒤 한 번 더 확인한다.** `webhook_registered` 가 `false` 로 바뀌면
아직도 무언가가 웹훅을 해제하고 있는 것이다 — 그 사실을 보고할 것.

```bash
npx pm2 logs workflow-builder --lines 50 --nostream | grep "\[tg\]"
```
→ `⚠ 웹훅이 등록돼 있지 않다` 가 뜨면 해제된 것이다

### E-2. 버튼 실제 동작

```bash
curl -s -X POST -H "Authorization: Bearer <ADMIN_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"wf_id":"newbot-test","agent_id":"ag_hermes","action":"deploy","context":"전용 봇 전환 확인"}' \
  http://127.0.0.1:3737/api/approvals
```

🧑 **사용자가 새 봇 대화방에서 버튼을 누른다:**
- 버튼 로딩이 풀리고 "승인했습니다"
- 메시지에 `✅ 승인됨 · @누구` 추가, 버튼 사라짐

```bash
curl -s -H "Authorization: Bearer <ADMIN_KEY>" \
  http://127.0.0.1:3737/api/telegram/status
```
→ **`acceptCount` 가 1 이상**이면 복구 완료. 이 값이 0 에서 올라가는 게 최종 증거다.

```bash
npx pm2 logs workflow-builder --lines 30 --nostream | grep "\[tg\] 승인"
```
→ `[tg] 승인 NN → approved (@누구)`

### E-3. 기존 게이트웨이가 멀쩡한가

```bash
ps aux | grep -v grep | grep 24666
```
→ 살아 있어야 한다. 이번 작업으로 건드리지 않았음을 확인.

---

## 롤백

```js
WF_TELEGRAM_TOKEN:   "<기존 토큰>",
WF_TELEGRAM_CHAT_ID: "<기존 chat_id>",
```
```bash
npx pm2 restart workflow-builder --update-env
```

> 되돌리면 **버튼은 다시 먹통**이 된다 (원인이 그대로이므로).
> 알림 자체는 기존 채널로 다시 온다.

---

## 하지 말 것

1. **Hermes 게이트웨이(pid 24666)를 끄지 말 것** — 다른 용도 채널이다.
   버튼을 살리자고 그쪽을 죽이면 안 된다
2. **봇 토큰을 로그·보고서·채팅·저장소에 붙여넣지 말 것** — 설정 여부만 보고
3. **`ecosystem.config.js` 를 git 에 커밋하지 말 것** — 이미 `.gitignore` 에 있다.
   상태 확인: `git check-ignore -v ecosystem.config.js`
4. **웹훅 secret 검사를 빼지 말 것** — 이 엔드포인트는 인터넷에 공개돼 있다
5. **`getUpdates` 를 새 봇에 계속 돌리지 말 것** — 같은 충돌이 재발한다.
   PHASE B 에서 `chat_id` 확인용으로 한 번만 쓰고 끝낼 것

---

## 보고 양식

```
[A] 새 봇
- 생성 : 완료 (토큰은 기재 금지)
- 새 봇에 메시지 전송 : 완료

[B] chat_id
- 확인 : 완료 / 실패(사유)

[C] 배포
- pull 후 HEAD : ______  (90787fa 기대)
- npm test     : __스위트 / __건  (9/135 기대)
- env 교체     : TOKEN·CHAT_ID 완료 / SECRET 유지
- restart      : 완료

[D] 웹훅
- --apply : 완료
- url             : ______
- 마지막 오류      : 없음 / ______

[E] 검증
- webhook_registered (직후)   : true / false
- webhook_registered (10분 뒤) : true / false   ← 여기가 핵심
- 🧑 버튼 눌림 반응            : Y / N
- acceptCount                  : ____ (1 이상이면 복구)
- [tg] 승인 로그               : ______
- 게이트웨이 pid 24666 생존    : Y / N

[결과] 완료 / 진행 / 차단(사유)
```

작업 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록할 것.
완료되면 알려달라 — `/api/telegram/status` 로 내 쪽에서도 검증하겠다.

---

## 이 건 이후 남는 것

- 지시서 **#11** (`/api/approvals` 잠그기) — 당신 보고상 완료로 보이나 미확인
- 삭제된 템플릿(`wf_tpl_team` 등)은 코드에 없다. 필요 여부는 사용자 결정 —
  **임의로 만들지 말 것**
- 큐에서 지시를 자동으로 집어가는 부분이 아직 사람 손을 탄다.
  스케줄러 알림은 오는데 당신이 폴링해 실행하는 경로는 별도 확인이 필요하다
