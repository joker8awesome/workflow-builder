# 🔧 할매봇 작업 지시서 #13 — 텔레그램 승인 버튼 복구

발신: Claude Code (로컬)
수신: **할매봇 (VPS)**
작성일: 2026-08-15
대상 커밋: **`04afab6`**
VPS 경로: `/opt/data/projects/workflow-builder`

> **지시서 #12 는 취소됐다.** 워크플로우 39→1 은 사용자가 지시한 정리였다.
> 백업 확인 작업은 하지 말 것.

---

## 증상

텔레그램 승인 요청의 `✅ 승인` `❌ 거부` 버튼을 눌러도 **아무 반응이 없다.**
승인 id 16 이 그 상태로 pending 이다.

## 로컬에서 확인한 것 — 서버는 정상이다

```
POST /api/telegram/webhook  (헤더 없음)    → 403   ← 라우트 살아 있음
POST /api/telegram/webhook  (틀린 secret)  → 403   ← 검사 동작함
POST /api/approvals/16/decide (잘못된 값)  → 400   ← 대체 경로도 정상
```

즉 **서버 코드·라우트·인증은 문제가 없다.** 텔레그램 쪽 설정이다.

버튼은 예전에 동작했다 — 승인 id 6 의 `approver` 가 `@hanwoo79` 인데,
그 `@사용자명` 형식은 웹훅 핸들러만 만든다. 그 뒤로 `ecosystem.config.js` 를
여러 번 편집하고 재시작했다.

**가장 유력한 원인: `WF_TELEGRAM_WEBHOOK_SECRET` 이 바뀌었거나 빠졌다.**
텔레그램은 *등록 시점의* secret 을 보내는데 서버 설정이 달라지면 전부 403 이 된다.
그리고 텔레그램은 403 을 받아도 사용자에게 알리지 않아 **버튼 먹통으로만 보인다.**

---

## STEP 1 — 배포 (진단 계측이 들어간다)

```bash
cd /opt/data/projects/workflow-builder
git pull origin main        # 04afab6
npm run check
npm test                    # 9스위트 132건 기대
npx pm2 restart workflow-builder
```

이번 배포로 들어가는 것:
- 거부 사유 구분 (`no_secret_header` vs `secret_mismatch`)
- `GET /api/telegram/status` — 봇 토큰 없이도 상태를 볼 수 있다

---

## STEP 2 — 원인 확인

### 2-1. 서버가 본 상황

```bash
curl -s -H "Authorization: Bearer <ADMIN_KEY>" \
  http://127.0.0.1:3737/api/telegram/status
```

| `lastRejectReason` | 의미 | 조치 |
|---|---|---|
| `secret_mismatch` | 텔레그램이 보낸 secret ≠ 서버 설정 | **STEP 3 재등록** |
| `no_secret_header` | 텔레그램이 아닌 곳에서 온 요청 | 텔레그램은 도달조차 못 함 → STEP 3 |
| `no_secret_configured` | 서버에 secret 이 없음 | env 부터 설정 |
| `null` + `acceptCount: 0` + `rejectCount: 0` | **콜백이 한 번도 안 옴** | 웹훅 미등록 → STEP 3 |

### 2-2. 텔레그램이 본 상황

```bash
node ops/setup-telegram-webhook.js
```

확인할 것:
- `url` 이 `https://187.127.124.16.sslip.io/api/telegram/webhook` 인가
- `⚠ 마지막 오류` 에 뭐가 있는가 (`Wrong response from the webhook: 403 Forbidden` 이면 secret 불일치 확정)
- `대기 중 업데이트` 가 쌓여 있는가 (쌓였으면 계속 실패 중)

### 2-3. env 확인

```bash
npx pm2 env 0 | grep -E "WF_TELEGRAM_WEBHOOK_SECRET|WF_TELEGRAM_CHAT_ID|WF_TELEGRAM_TOKEN"
```
→ **설정 여부만 보고할 것. 값은 절대 기재하지 말 것.**

---

## STEP 3 — 재등록

서버의 현재 secret 을 텔레그램에 다시 심는다. 이게 불일치를 해소하는 방법이다.

```bash
node ops/setup-telegram-webhook.js --apply
node ops/setup-telegram-webhook.js            # 재조회 — 마지막 오류가 없어야 한다
```

`WF_TELEGRAM_WEBHOOK_SECRET` 이 아예 없다면 먼저 만들어 `ecosystem.config.js` 에 넣고
`pm2 restart workflow-builder --update-env` 한 뒤 재등록한다:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

---

## STEP 4 — 검증

### 4-1. 새 승인 요청으로 버튼 테스트

```bash
curl -s -X POST -H "Authorization: Bearer <ADMIN_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"wf_id":"btn-test","agent_id":"ag_hermes","action":"deploy","context":"버튼 복구 확인"}' \
  http://127.0.0.1:3737/api/approvals
```

🧑 **사용자가 텔레그램에서 버튼을 누른다.** 기대 동작:
- 버튼 로딩이 즉시 풀리고 "승인했습니다" 안내
- 메시지 아래 `✅ 승인됨 · @누구` 추가
- 버튼이 사라짐

### 4-2. 서버 쪽 확인

```bash
curl -s -H "Authorization: Bearer <ADMIN_KEY>" \
  http://127.0.0.1:3737/api/telegram/status
```
→ `acceptCount` 가 **1 이상**, `lastCallbackAt` 에 방금 시각

```bash
npx pm2 logs workflow-builder --lines 30 --nostream | grep "\[tg\]"
```
→ `[tg] 승인 NN → approved (@누구)` 가 찍혀야 한다

### 4-3. 밀린 승인 16 처리

버튼이 복구되면 **승인 16 도 눌러서 처리**한다. 그게 최종 확인이다.
버튼이 여전히 안 되면 API 로 처리한다:

```bash
curl -s -X POST -H "Authorization: Bearer <ADMIN_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"decision":"approved","approver":"api-fallback"}' \
  http://127.0.0.1:3737/api/approvals/16/decide
```

---

## 하지 말 것

1. **`WF_TELEGRAM_WEBHOOK_SECRET` 을 비우거나 서버의 secret 검사를 빼지 말 것** —
   이 엔드포인트는 인터넷에 공개돼 있다. 검사가 없으면 URL 을 아는 누구나 승인을 위조한다.
   버튼이 안 된다고 검사를 끄는 것은 자물쇠가 뻑뻑하다고 문을 떼는 것과 같다
2. **secret 값·봇 토큰을 로그·보고서·채팅에 붙여넣지 말 것** — 설정 여부만
3. **`WF_TELEGRAM_CHAT_ID` 를 비우지 말 것** — 채팅 제한이 풀린다
4. **`--delete` 로 웹훅을 지운 채 두지 말 것** — 재등록까지 한 세트다

---

## 보고 양식

```
[1] 배포
- pull 후 HEAD : ______  (04afab6 기대)
- npm test     : __스위트 / __건  (9/132 기대)
- pm2 restart  : 완료

[2] 원인
- /api/telegram/status
    configured        : Y / N
    acceptCount       : ____
    rejectCount       : ____
    lastRejectReason  : ______
    hint              : ______
- setup-telegram-webhook.js 조회
    url               : ______
    마지막 오류        : 없음 / ______
    대기 중 업데이트   : ____
- env 설정 여부 (값 금지)
    WEBHOOK_SECRET / CHAT_ID / TOKEN : Y-Y-Y 형식으로

[3] 재등록
- --apply 실행 : 완료 / 실패
- 재조회 시 마지막 오류 : 없음 / ______

[4] 검증
- 🧑 버튼 눌림 반응     : Y / N
- 🧑 메시지 갱신·버튼 제거 : Y / N
- acceptCount 증가      : ____
- [tg] 로그             : ______
- 승인 16 처리          : 버튼 / API / 미처리

[결과] 완료 / 진행 / 차단(사유)
```

작업 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록할 것.
완료되면 알려달라 — `/api/telegram/status` 로 내 쪽에서도 확인하겠다.

---

## 이 건 이후 남는 것

- 지시서 **#11** (`/api/approvals` 잠그기, 4단계) — 미수행
- 삭제된 템플릿 3종(`wf_tpl_team` 등)은 코드에 없다.
  필요하면 사용자 결정 후 새로 만든다 — **임의로 만들지 말 것**
