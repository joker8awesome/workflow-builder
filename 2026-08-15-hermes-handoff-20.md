# 💬 할매봇 작업 지시서 #20 — 센터장 봇 양방향 대화

발신: Claude Code (로컬)
수신: **할매봇 (VPS)**
작성일: 2026-08-15
대상 커밋: **`3c0acbf`**
VPS 경로: `/opt/data/projects/workflow-builder`

> **웹훅 재등록이 필수다.** `allowed_updates` 에 `message` 를 추가했다.
> 재등록하지 않으면 텔레그램이 텍스트를 보내주지 않아 이번 기능이 전혀 동작하지 않는다.
>
> 재시작은 `pm2` 만. `scheduler.py` 는 이번에 안 바뀌었다.

---

## 무엇이 바뀌나

지금까지 커멘드센터 봇은 **버튼만** 받았다. 알림은 가는데 사용자가 말을 걸 수는 없었다.

이제 텍스트도 받는다:

| 입력 | 동작 |
|---|---|
| `/status` 또는 `상태` | 워크플로우·에이전트 수, 승인 대기, 승인 게이트, 웹훅 상태 |
| `/queue` 또는 `큐` | 대기 중인 지시 목록 |
| `/help` 또는 `도움말` | 사용법 |
| **그 밖의 문장** | **센터장 앞으로 큐에 적재** + msg 번호 회신 |

### 설계에서 중요한 점

**지시를 서버가 직접 실행하지 않는다.** 큐에 넣기만 한다.

서버가 실행까지 하면 승인 게이트를 우회하게 되고, **텔레그램 한 줄로 프로덕션이 바뀐다.**
큐에 넣으면 기존 경로(감지 → 알림 → 승인 → 수행)를 그대로 탄다.

봇이 보낸 메시지는 무시한다 — 봇끼리 오가는 루프를 막는다.
(게이트웨이가 우리 깨우기 메시지를 걸렀던 것과 같은 이유다)

---

## STEP 1 — 배포

```bash
cd /opt/data/projects/workflow-builder
git status --short
git pull origin main        # 3c0acbf
npm run check
npm test                    # 11스위트 163건 기대
npx pm2 restart workflow-builder
```

---

## STEP 2 — 🔴 웹훅 재등록 (빠뜨리면 아무것도 안 된다)

```bash
node ops/setup-telegram-webhook.js --apply
node ops/setup-telegram-webhook.js
```

확인:
```
허용 업데이트 : callback_query, message      ← message 가 있어야 한다
⚠ 마지막 오류 : 없음
```

`message` 가 없으면 텔레그램이 텍스트를 안 보낸다. 그 경우 `--apply` 를 다시 돌릴 것.

---

## STEP 3 — 🧑 사용자 확인

커멘드센터 봇 대화방에서 직접 입력해 본다.

1. `/help` → 사용법이 온다
2. `/status` → 숫자와 상태가 온다
3. `/queue` → 대기 목록이 온다
4. **아무 문장이나** (예: `테스트 지시입니다`) → `전달했습니다 (msg NNN)` 회신

4번이 되면 큐에 실제로 들어갔는지 확인:
```bash
curl -s -H "Authorization: Bearer <ADMIN_KEY>" \
  http://127.0.0.1:3737/api/messages | head -c 400
```
→ `from_agent: "telegram:@사용자명"`, `to_agent: "ag_claude_desktop"`, `status: "pending"`

> 이 메시지는 **센터장 앞**이라 네가 처리하는 것이 아니다. 큐에 들어갔는지만 확인하면 된다.

---

## STEP 4 — 로그 확인

```bash
npx pm2 logs workflow-builder --lines 40 --nostream | grep "\[tg\]"
```

기대:
```
[tg] 사용자 메시지 (@누구): /status
[tg] 지시 큐 적재: msg NNN
```

---

## 함께 들어간 수정 — 알아둘 것

`POST /api/messages` 가 `status='sent'` 로 넣고 있었다.
`agent.tasks.list_pending` 은 `'pending'` 만 조회하므로 **이 API 로 보낸 메시지는
아무도 받지 못했다.** 기본값을 `'pending'` 으로 바꿨다.

더 큰 그림 — 메시지 상태 어휘가 두 벌이다:

```
큐(픽업)      : pending → claimed → completed
오케스트레이터 : sent → read
```

**오케스트레이터가 보낸 메시지는 `list_pending` 에 잡히지 않는다.** 의도된 분리이되,
픽업이 필요한 지시는 반드시 `pending` 으로 넣어야 한다.
`ops/test-message-status.js` 가 이를 검사한다.

---

## 하지 말 것

1. **웹훅 재등록을 건너뛰지 말 것** — 배포만으로는 텍스트가 오지 않는다
2. **게이트웨이 봇에 이 웹훅을 걸지 말 것** — `getUpdates` 와 충돌해 승인 버튼이 다시 죽는다.
   웹훅은 커멘드센터 봇에만
3. **`handleUserMessage` 에서 지시를 직접 실행하도록 바꾸지 말 것** —
   승인 게이트를 우회하게 된다. 큐에 넣는 것이 설계다
4. **봇 메시지 무시 조건(`msg.from?.is_bot`)을 빼지 말 것** — 루프가 생긴다
5. **`status` 기본값을 `'sent'` 로 되돌리지 말 것** — `ops/test-message-status.js` 가 잡는다

---

## 보고 양식

```
[1] 배포
- pull 후 HEAD : ______  (3c0acbf 기대)
- npm test     : __스위트 / __건  (11/163 기대)
- pm2 restart  : 완료

[2] 웹훅 재등록
- --apply : 완료
- 허용 업데이트 : ______      ← message 포함 확인
- 마지막 오류   : 없음 / ______

[3] 🧑 사용자 확인
- /help    : Y / N
- /status  : Y / N
- /queue   : Y / N
- 자유 문장 → "전달했습니다 (msg NNN)" : Y / N
- 큐 확인 (to_agent=ag_claude_desktop, status=pending) : Y / N

[4] 로그
- [tg] 사용자 메시지 : ______
- [tg] 지시 큐 적재  : ______

[결과] 완료 / 진행 / 차단(사유)
```

작업 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록할 것.
완료되면 알려달라 — 내 쪽에서 큐와 웹훅 상태를 검증하겠다.
