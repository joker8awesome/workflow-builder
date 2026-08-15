# 🚨 할매봇 작업 지시서 #21 — 자동 픽업이 멈췄다 (먼저 확인, 그다음 배포)

발신: Claude Code (로컬)
수신: **할매봇 (VPS)**
작성일: 2026-08-16
대상 커밋: **`12140c4`**
VPS 경로: `/opt/data/projects/workflow-builder`

> **이 지시서는 큐로 못 받는다.** 큐가 안 비워지는 게 지금 문제라, 사람이 직접
> 너를 불렀을 것이다. #20 도 `msg_176` 에 pending 으로 걸려 있다.
>
> **순서: STEP 1 확인 → STEP 2 복구 → STEP 3 에서 #20 처리.**
> STEP 1 을 건너뛰면 진짜 원인을 영영 모른다.

---

## 무슨 일이 있었나

`ops/queue-trigger.sh` 가 커밋 `d3e3d9a` 에서 3줄짜리로 덮였다:

```bash
#!/usr/bin/env bash
# Hermes cron wrapper — 실제 queue-trigger.sh를 올바른 경로로 exec
exec /opt/data/projects/workflow-builder/ops/queue-trigger.sh "$@"
```

**그 경로가 이 파일 자신이다.** 자기를 exec 하는 무한 루프다.
문법 오류가 아니라 조용히 도는 루프라, 아무 신호 없이 큐만 안 비워진다.

시각은 이렇다:

```
21:58:32Z  58aaa25   자동 픽업 성공 (#17 검증) — 이때는 진짜 스크립트가 있었다
21:59:41Z  d3e3d9a   스텁으로 덮임              ← 69초 뒤
22:26:04Z  msg_176   그 뒤 들어온 유일한 지시 — pending 상태로 정체
```

**다만 이게 원인이라고 아직 확정하지 않는다.** 정황은 맞지만 데이터가 1건이고,
나는 VPS 파일을 볼 수 없다. 스케줄러가 이 `.sh` 를 부르는지조차 모른다
(#19 보고에 "시스템 cron 데몬 없음"이라고 돼 있었다).
그래서 STEP 1 이 먼저다.

---

## STEP 1 — 🔴 확인 먼저 (고치기 전에)

고치고 나면 증거가 사라진다. **아래 3가지를 먼저 찍어서 보고에 그대로 붙여라.**

### 1-1. 스케줄러에 등록된 명령 (있는 그대로)

```bash
crontab -l 2>/dev/null | grep -i trigger
# Hermes 자체 스케줄러를 쓴다면 그 목록도
```

→ **어떤 경로를 부르고 있나?** `ops/queue-trigger.sh` 인가, 다른 래퍼인가?

### 1-2. 배포된 파일의 실제 상태

```bash
cd /opt/data/projects/workflow-builder
ls -l ops/queue-trigger.sh
head -5 ops/queue-trigger.sh
git status --short ops/
```

→ 배포본이 **스텁인가**, 아니면 로컬에서 고쳐둔 다른 내용인가?
(커밋과 다르게 로컬 수정 상태일 수 있다. `git status` 가 알려준다)

### 1-3. 돌고 있는 프로세스

```bash
ps aux | grep -i queue-trigger | grep -v grep
uptime
```

→ 자기 exec 루프는 **fork 없이 한 코어를 계속 먹는다.** 프로세스 하나가
CPU 를 붙잡고 있으면 그게 증거다. 있으면 PID 와 `%CPU` 를 적고 kill 해라.

---

## STEP 2 — 복구

```bash
cd /opt/data/projects/workflow-builder
git pull origin main        # 12140c4
head -3 ops/queue-trigger.sh    # 진짜 스크립트인지 눈으로 확인
npm test                    # 11스위트 166건 기대
```

새 테스트 3건이 이 사고를 고정한다 — 자기 exec 금지 / ROOT 해석 블록 존재 /
로그 기록 존재.

### 저장소 밖 경로가 필요하다면

스케줄러가 고정 경로를 요구해서 스텁을 만들었던 거라면, 필요 자체는 정당하다.
**자리를 따로 줬으니 그걸 써라:**

```bash
cp ops/queue-trigger-wrapper.sh.example ~/queue-trigger-wrapper.sh
chmod 755 ~/queue-trigger-wrapper.sh
# 스케줄러에는 ~/queue-trigger-wrapper.sh 를 등록
```

**`ops/` 안에 두지 마라.** 다음 배포 때 또 같은 일이 난다.

### 손으로 한 번 돌려본다

```bash
/opt/data/projects/workflow-builder/ops/queue-trigger.sh
cat ops/queue-trigger.log
```

`[...] trigger 시작 ROOT=/opt/data/projects/workflow-builder` 가 찍혀야 한다.
이 로그가 이번에 새로 생긴 것이다 — 지금까지는 cron 이 안 뜬 건지
뜨고도 큐가 비었던 건지 구분할 방법이 없었다.

---

## STEP 3 — 여기서 #20 을 처리한다

트리거가 살아나면 `msg_176` 이 자동으로 잡혀야 한다. 몇 분 기다려 봐라.

- **자동으로 잡혔다면** → 트리거 복구 확인. `2026-08-15-hermes-handoff-20.md` 수행
- **안 잡혔다면** → 원인이 다른 데 있다. 손으로 #20 을 수행하되, **STEP 1 결과를
  반드시 보고해라.** 그게 다음 판단의 재료다

#20 요약 (전문은 `2026-08-15-hermes-handoff-20.md`):
1. `git pull` → `npm test` → `npx pm2 restart workflow-builder`
2. 🔴 **`node ops/setup-telegram-webhook.js --apply`** — `allowed_updates` 에
   `message` 가 추가돼, 재등록 안 하면 텔레그램이 텍스트를 안 보낸다
3. 봇에 `/status`, `/queue`, 아무 문장이나 보내 응답 확인

---

## 하지 말 것

1. **STEP 1 을 건너뛰지 말 것** — 고치면 증거가 사라진다. 원인 확정이 안 되면
   같은 일이 또 난다
2. **리다이렉트 스텁을 `ops/queue-trigger.sh` 에 다시 쓰지 말 것** —
   `ops/queue-trigger-wrapper.sh.example` 을 저장소 **밖으로** 복사해 쓸 것
3. **`WF_TRIGGER_CMD` 에 `flock` 을 넣지 말 것** — 막힌 회차가 "실행했다"로
   기록되어 그 지시를 잃는다. 잠금은 `queue-trigger.js` 안에 있다
4. **웹훅 재등록을 빠뜨리지 말 것** (#20 STEP 2)
5. **게이트웨이 봇에 웹훅을 걸지 말 것** — `getUpdates` 충돌로 승인 버튼이 죽는다

---

## 보고 양식

```
[1] 🔴 확인 (고치기 전)
- 스케줄러 등록 명령 : ______________________  (있는 그대로)
- ls -l ops/queue-trigger.sh : ______
- head -5 결과 : 스텁 / 진짜 스크립트 / 그 밖(______)
- git status --short ops/ : ______
- queue-trigger 프로세스 : 없음 / PID ____ %CPU ____
- uptime load : ______

[2] 복구
- pull 후 HEAD : ______  (12140c4 기대)
- head -3 확인 : 진짜 스크립트 Y / N
- npm test : __스위트 / __건  (11/166 기대)
- 외부 래퍼 필요했나 : Y(경로 ______) / N
- 손으로 실행 → queue-trigger.log 첫 줄 : ______

[3] #20
- msg_176 자동으로 잡혔나 : Y / N      ← 이게 트리거 복구 판정이다
- 배포 : ______
- 웹훅 재등록 후 allowed_updates : ______   (message 포함 확인)
- 봇 응답 (/status, /queue, 자유문장) : ______

[결과] 완료 / 진행 / 차단(사유)
```

작업 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록할 것.
