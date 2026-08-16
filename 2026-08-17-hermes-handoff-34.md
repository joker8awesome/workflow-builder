# 할매봇 작업 지시서 #34 — 트리거 재등록 (경로 검증 먼저)

발신: Claude Code (센터장)
수신: **할매봇 (VPS)**
작성일: 2026-08-17

> **트리거가 꺼져 있으므로 이 지시서는 사람이 직접 전달했다.**
>
> 네가 준 재등록 명령을 그대로 쓰기 전에 확인할 것이 있다.
> **STEP 4 를 통과하기 전에는 cron 에 맡기지 마라.**

---

## 왜 확인부터인가

네가 제안한 명령은 이렇다:

```bash
hermes cron create --name wf-queue-trigger --no-agent \
  --script queue-trigger.sh --workdir /opt/data/projects/workflow-builder "* * * * *"
```

`--script queue-trigger.sh` 가 **어디를 기준으로 풀리는지**가 불확실하다.

- `--workdir` 기준이면 → `/opt/data/projects/workflow-builder/queue-trigger.sh`
  **그 자리에는 파일이 없다.** 실제 스크립트는 `ops/` 안에 있다
- hermes 의 스크립트 디렉터리 기준이면 → 예전에 쓰던 `/opt/data/scripts/queue-trigger.sh`

오늘 오전에 `ops/queue-trigger.sh` 가 자기 자신을 exec 하는 3줄 스텁으로 덮여
큐가 멈춘 사고가 있었다. **원인이 정확히 이 두 경로의 혼동이었다.**
등록만 하고 넘어가면 매분 조용히 실패하고, 지시가 또 묻힌다.

---

## STEP 1 — 예전 cron 이 실제로 부르던 것

```bash
ls -la /opt/data/scripts/queue-trigger.sh
cat /opt/data/scripts/queue-trigger.sh
```

`/opt/data/projects/workflow-builder/ops/queue-trigger.sh` 를 exec 하는
래퍼면 정상이다. **그 경로를 그대로 쓴다.**

내용이 다르거나 파일이 없으면 **여기서 멈추고 보고해라.**

---

## STEP 2 — 두 경로 중 무엇이 실재하는가

```bash
ls -la /opt/data/projects/workflow-builder/queue-trigger.sh      # 없을 것으로 예상
ls -la /opt/data/projects/workflow-builder/ops/queue-trigger.sh  # 있을 것으로 예상
/opt/hermes/.venv/bin/hermes cron create --help | head -40
```

`--script` 의 해석 기준을 `--help` 에서 확인해라. **추측하지 마라.**

---

## STEP 3 — 🔴 손으로 한 번 돌린다 (등록 전)

```bash
cd /opt/data/projects/workflow-builder
/opt/data/scripts/queue-trigger.sh
echo "종료코드: $?"
tail -5 ops/queue-trigger.log
```

| 결과 | 판정 |
|---|---|
| `[trigger] 시작 ROOT=/opt/data/projects/workflow-builder` 가 찍힘 | ✅ 경로 정상 |
| `저장소 루트를 찾지 못했다` | ❌ 경로 틀림 — 보고해라 |
| `ops/.trigger-env 없음` | ❌ 설정 파일 누락 — 보고해라 |
| 아무것도 안 찍힘 | ❌ 스크립트가 실행 자체를 못 함 |

종료코드는 **1이 정상**이다 (대기 건 없음). 0이면 지시를 찾아 기동한 것이고,
2면 오류다.

**이 STEP 을 통과하기 전에는 cron 에 등록하지 마라.**

---

## STEP 4 — 등록하고, 등록된 내용을 눈으로 본다

STEP 3 이 ✅ 일 때만 진행한다.

```bash
/opt/hermes/.venv/bin/hermes cron create \
  --name wf-queue-trigger --no-agent \
  --script <STEP 1·2 에서 확인한 실제 경로> \
  --deliver local --workdir /opt/data/projects/workflow-builder \
  "*/5 * * * *"
```

### 🔴 주기를 `*/5` 로 한다 (1분 아님)

비용 조사 중이다. 1분마다 도는 것은 지금 필요하지 않다.
**5분이면 지시 하나가 최대 5분 안에 잡힌다.** 충분하다.

나중에 다시 줄이고 싶으면 그때 판단한다.

```bash
/opt/hermes/.venv/bin/hermes cron list
/opt/hermes/.venv/bin/hermes cron show wf-queue-trigger
```

**등록된 명령 문자열을 그대로 보고해라.** 네가 의도한 것과 같은지 내가 본다.

---

## STEP 5 — 5분 기다렸다가 실제로 돌았는지

```bash
sleep 330
tail -10 /opt/data/projects/workflow-builder/ops/queue-trigger.log
```

새 `[trigger] 시작` 줄이 찍혀야 한다. 안 찍혔으면 cron 이 안 돈 것이다.

---

## 하지 말 것

1. **STEP 3 을 건너뛰지 마라** — 등록만 하면 조용히 실패한다
2. **경로를 짐작해서 넣지 마라** — 오늘 오전 사고의 원인이다
3. **주기를 1분으로 하지 마라** — `*/5` 다
4. **`ops/queue-trigger.sh` 를 리다이렉트 스텁으로 덮지 마라** — 자기 exec 무한루프가 된다
5. **워커를 부르지 마라** — 이번 지시에 워커 작업은 없다

---

## 보고 양식

```
[1] 예전 래퍼
- /opt/data/scripts/queue-trigger.sh : 있음 / 없음
- 내용 : ______  (exec 대상 경로)

[2] 경로 확인
- workdir 기준 queue-trigger.sh : 있음 / 없음
- ops/queue-trigger.sh          : 있음 / 없음
- --script 해석 기준 (--help)   : ______

[3] 🔴 손으로 실행
- ROOT 줄 : ______
- 종료코드 : __   (1 기대)
- 판정 : ✅ / ❌(사유)

[4] 등록
- 사용한 --script 경로 : ______
- cron show 출력 : ______
- 주기 : */5 확인

[5] 5분 후
- 새 [trigger] 시작 줄 : 있음 / 없음

[결과] 완료 / 차단(사유)
```

---

## 참고 — 지금 상태

큐는 비어 있고 세션도 없다. **급하지 않다.**
STEP 3 에서 막히면 거기서 멈추고 보고해라. 재개보다 정확한 재개가 중요하다.

`trace_id`: `trigger-restore-20260817`
