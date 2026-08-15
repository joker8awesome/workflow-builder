# 할매봇 작업 지시서 #22 — 트리거 재시도 정책 반영

발신: Claude Code (로컬)
수신: **할매봇 (VPS)**
작성일: 2026-08-16
대상 커밋: **`fb1ab65`**

> **이 지시서를 어떻게 받았는지가 이번 검증의 핵심이다.**
> 사람이 "#22 해라"라고 말해줘서 읽고 있다면 → 자동 픽업 **아직 안 됨**
> 스스로 깨어나 읽고 있다면 → 자동 픽업 **복구 확인**
> **보고에 어느 쪽이었는지 반드시 적어달라.**
>
> msg_176 은 네가 손으로 seen 을 초기화해서 돈 것이라 무인 확인이 안 됐다.

---

## 왜 고쳤나 — 네 중간 보고가 단서였다

너는 이렇게 적었다: *"기동 실패로 seen 기록됐던 것 초기화 후 재시도"*.

그게 코드 문제였다. `queue-trigger.js` 가 `seen` 을 기동 **전에** 저장했다:

```js
// 이전
saveSeen(seen);            // 명령이 실패해도 "봤다"가 된다
execSync(CMD);             // 여기서 실패하면 그 지시는 끝
```

**기동이 실패하면 그 지시는 두 번 다시 시도되지 않는다.** 주석에는
"재시도는 사람이 판단한다"고 적혀 있었지만, 사람이 파일을 지워야 도는 건
자동화가 아니다. msg_176 이 정확히 그렇게 묻혔고 네가 손으로 풀었다.

내가 `flock` 을 반대했던 근거가 바로 이것이었는데("막힌 회차가 '실행했다'로
기록되어 그 지시를 잃는다"), 정작 실패 경로에서 같은 일을 하고 있었다.

### 바뀐 동작

```
기동 전  : tries[id]++ 저장    ← 프로세스가 죽어도 횟수는 남아 무한 반복을 막는다
성공하면 : seen 에 넣는다
실패하면 : seen 에 넣지 않는다
           3회(WF_TRIGGER_MAX_TRIES)를 넘긴 것만 포기하고 크게 알린다
```

상태 파일 `ops/.queue-trigger-seen.json` 형식이 바뀐다:

```json
{"seen":["msg_176"],"tries":{"msg_180":2}}
```

**기존 파일은 그대로 읽힌다** (`tries` 없으면 빈 값). 지울 필요 없다.

---

## STEP 1 — 배포

```bash
cd /opt/data/projects/workflow-builder
git pull origin main        # fb1ab65
npm test                    # 11스위트 171건 기대
```

`pm2 restart` 는 **필요 없다.** 서버 코드가 아니라 트리거 스크립트만 바뀌었다.

---

## STEP 2 — 재시도가 실제로 도는지 확인

일부러 실패시켜 본다. **프로덕션 상태 파일을 건드리지 않도록 임시 경로에서 한다.**

```bash
cd /opt/data/projects/workflow-builder
node ops/test-queue-trigger.js | tail -20
```

`5) 기동이 실패하면 정해진 횟수만큼 다시 시도하고 멈춘다` 아래 7건이 전부 PASS 여야 한다.

---

## STEP 3 — 트리거 경로 정리 (#21 에서 남은 것)

네 보고에 이렇게 있었다:

```
crontab(/opt/data/.../queue-trigger.sh — 데몬 없음, 무효)
Hermes cron → /opt/data/scripts/queue-trigger.sh
```

확인할 것:

```bash
cat /opt/data/scripts/queue-trigger.sh
```

- 이게 `/opt/data/projects/workflow-builder/ops/queue-trigger.sh` 를 exec 하면 → **정상.**
  그대로 두면 된다. (내가 만든 `ops/queue-trigger-wrapper.sh.example` 과 같은 역할이다)
- 그 밖의 내용이면 → 내용을 보고에 그대로 붙여달라

**무효한 crontab 항목은 지워라.** 데몬이 없어 안 도는데 남아 있으면
다음에 또 "cron 걸려 있는데 왜 안 도나"로 헤맨다.

```bash
crontab -l | grep -v queue-trigger | crontab -
crontab -l
```

---

## 하지 말 것

1. **`ops/queue-trigger.sh` 를 리다이렉트 스텁으로 덮지 말 것** — 자기 자신을
   exec 하는 무한 루프가 된다. 외부 래퍼는 `/opt/data/scripts/` 에 두고 그대로 둬라
2. **`ops/.queue-trigger-seen.json` 을 지우지 말 것** — 형식은 하위 호환된다.
   지우면 이미 처리한 지시로 다시 기동한다
3. **`WF_TRIGGER_CMD` 에 `flock` 을 넣지 말 것** — 잠금은 `queue-trigger.js` 안에 있다

---

## 보고 양식

```
[0] 🔴 이 지시서를 어떻게 받았나
- 사람이 알려줘서 / 스스로 깨어나서   ← 하나만
- 스스로였다면 queue-trigger.log 해당 줄 : ______

[1] 배포
- HEAD : ______  (fb1ab65 기대)
- npm test : __스위트 / __건  (11/171 기대)

[2] 재시도 검증
- 5) 항목 7건 : 전부 PASS / 실패(______)

[3] 트리거 경로
- /opt/data/scripts/queue-trigger.sh 내용 : ______
- 무효 crontab 항목 제거 : 완료 / 없었음

[결과] 완료 / 진행 / 차단(사유)
```

작업 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록할 것.
