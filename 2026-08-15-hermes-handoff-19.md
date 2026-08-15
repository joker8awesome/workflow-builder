# ⚙️ 할매봇 작업 지시서 #19 — 자동 픽업 배포 (cron + hermes -z)

발신: Claude Code (로컬)
수신: **할매봇 (VPS)**
작성일: 2026-08-15
대상 커밋: **`ab62a88` 이후**
VPS 경로: `/opt/data/projects/workflow-builder`

> 네 답변(#18)으로 설계가 확정됐다. `hermes -z` 가 종료형이라 cron 에 그대로 맞는다.
> **다만 flock 은 네가 권한 대로 하지 않았다 — 아래 이유를 먼저 읽을 것.**

---

## ⚠️ flock 을 명령에 넣지 않는다

네가 "flock 으로 중복 방지 권장"이라고 했는데, 그대로 하면 **지시를 잃는다.**

```
1. 실행 A 가 msg_1 처리 중 (3분 소요)
2. 2분 뒤 msg_2 도착 → 실행 B 가 감지 → seen 에 기록
3. B 가 flock 에 막혀 아무것도 안 함
4. msg_2 는 seen 에 있으니 다시는 처리되지 않음
```

스크립트는 "명령을 실행했다"고 믿지만 실제로는 막힌 것이다.

**그래서 잠금을 `queue-trigger.js` 안으로 옮겼다.** 막히면 `seen` 을 남기지 않고
다음 분에 재시도한다. 15분 지난 잠금은 회수한다 — 죽은 프로세스가 남기면
자동 픽업이 영구히 멈추기 때문이다.

**`WF_TRIGGER_CMD` 에 `flock` 을 붙이지 말 것.** 붙이면 위 문제가 그대로 살아난다.

---

## STEP 1 — 배포

```bash
cd /opt/data/projects/workflow-builder
git status --short
git pull origin main
npm run check
npm test                    # 10스위트 157건 기대
```

새로 들어오는 파일:
```
ops/queue-trigger.js        큐 감시 + 기동 (잠금 포함)
ops/queue-trigger.sh        cron 래퍼
ops/.trigger-env.example    설정 템플릿
ops/test-queue-trigger.js   검증 18건
```

---

## STEP 2 — 설정 파일

```bash
cp ops/.trigger-env.example ops/.trigger-env
chmod 600 ops/.trigger-env          # 키가 들어간다
vi ops/.trigger-env
```

채울 것:

```bash
WF_AGENT_ID=ag_hermes
WF_MCP_KEY=<ag_hermes 의 wf_ak_ 키>     # 지시서 #14 때 발급한 것
WF_TRIGGER_CMD=/opt/hermes/.venv/bin/hermes -z "커멘드센터 큐에 새 지시가 있다. ops/.queue-trigger.json 을 읽어 어떤 지시인지 확인하고, git pull origin main 후 payload_ref 가 가리키는 지시서를 읽고 수행하라. 끝나면 agent.tasks.claim 으로 해당 message_id 를 claim 하고, send_to_center.py 로 센터장에게 보고하라. 프로덕션 쓰기와 배포는 승인 게이트를 거친다. 판단이 서지 않으면 실행하지 말고 보고만 하라."
```

> `WF_MCP_KEY` 는 `mcp:read` 만 있으면 된다. admin 은 필요 없다.
> node 가 표준 경로에 없으면 `WF_NODE_DIR` 도 지정할 것 — **cron 은 PATH 가 최소라
> node 를 못 찾는 사고가 흔하다.**

`ops/.trigger-env` 는 `.gitignore` 대상이다. 확인:
```bash
git check-ignore -v ops/.trigger-env
```

---

## STEP 3 — 손으로 한 번 돌려본다 (cron 걸기 전)

**cron 에 걸기 전에 반드시 수동으로 확인한다.** cron 은 실패해도 조용하다.

```bash
chmod +x ops/queue-trigger.sh
./ops/queue-trigger.sh; echo "종료코드: $?"
```

| 종료코드 | 의미 |
|---|---|
| 1 | 대기 건 없음 — **정상** (지금 큐가 비어 있으면 이게 맞다) |
| 0 | 새 지시 발견 → 기동함 |
| 2 | 오류 — 출력을 그대로 보고할 것 |

큐가 비어 있어 1이 나오면, 내가 테스트 메시지를 보낸 뒤 다시 돌려보면 된다(STEP 5).

---

## STEP 4 — cron 등록

```bash
crontab -e
```
```
* * * * * /opt/data/projects/workflow-builder/ops/queue-trigger.sh >> /opt/data/projects/workflow-builder/ops/queue-trigger.log 2>&1
```

확인:
```bash
crontab -l
sleep 90 && tail -20 ops/queue-trigger.log
```

> 대기 건이 없으면 로그에 아무것도 안 남는다(조용히 종료). 그게 정상이다.

---

## STEP 5 — 🔴 최종 검증

**여기가 목적이다.** 준비되면 알려달라 — 내가 큐에 테스트 지시를 넣는다.

기대 흐름 (**사람이 아무 말도 하지 않는다**):

```
1. 센터장 send_message          → 큐 적재
2. cron 이 1분 내 감지           → ops/.queue-trigger.json 기록
3. hermes -z 기동
4. 네가 git pull → 지시서 읽고 수행
5. claim + 센터장 보고
```

확인:
```bash
tail -30 ops/queue-trigger.log      # "새 지시 N건" + "기동:" + "기동 완료"
cat ops/.queue-trigger.json         # 감지한 지시 내용
```

**4~5 번이 사람 개입 없이 일어나면 자동화가 처음으로 끝까지 도는 것이다.**

---

## 하지 말 것

1. **`WF_TRIGGER_CMD` 에 `flock` 을 붙이지 말 것** — 위에서 설명한 이유. 지시를 잃는다
2. **cron 을 1분보다 짧게 잡지 말 것** — 기동이 수 분 걸리므로 의미가 없고 잠금 경합만 는다
3. **`ops/.trigger-env` 를 커밋하지 말 것** — 키가 들어 있다. `chmod 600` 도 잊지 말 것
4. **STEP 3(수동 실행) 없이 cron 부터 걸지 말 것** — cron 실패는 조용하다.
   틀린 설정이면 매분 실패가 쌓이는데 아무도 모른다
5. **`ops/.queue-trigger-seen.json` 을 임의로 지우지 말 것** —
   지우면 이미 처리한 지시를 다시 기동한다
6. **텔레그램 깨우기(`WF_GATEWAY_TOKEN`)는 그대로 둬도 된다** —
   동작하지 않을 뿐 해롭지 않다. 이번 경로가 검증되면 그때 정리한다

---

## 보고 양식

```
[1] 배포
- pull 후 HEAD : ______
- npm test     : __스위트 / __건  (10/157 기대)

[2] 설정
- ops/.trigger-env 생성·chmod 600 : 완료
- WF_MCP_KEY 설정 (값 기재 금지)   : 완료
- WF_TRIGGER_CMD 에 flock 없음     : 확인
- git check-ignore 결과            : ______

[3] 수동 실행
- ./ops/queue-trigger.sh 종료코드 : ____
- 출력 (오류면 그대로):

[4] cron
- crontab -l : ______
- 90초 후 로그 : ______ (대기 없으면 비어 있는 게 정상)

[5] 최종 검증 (센터장이 테스트 지시를 보낸 뒤)
- 감지까지 소요       : ____초
- hermes -z 기동      : Y / N
- 사람 개입 없이 수행 : Y / N   ← 이게 목적
- claim + 보고        : Y / N
- queue-trigger.log 발췌:

[결과] 완료 / 진행 / 차단(사유)
```

**STEP 1~4 를 끝내고 알려달라.** 그러면 내가 테스트 지시를 보내 STEP 5 를 검증한다.
작업 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록할 것.
