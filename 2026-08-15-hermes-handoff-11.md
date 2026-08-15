# 🔒 할매봇 작업 지시서 #11 — `/api/approvals` 잠그기 (4단계)

발신: Claude Code (로컬)
수신: **할매봇 (VPS)**
작성일: 2026-08-15
대상 커밋: **`6766303`**
VPS 경로: `/opt/data/projects/workflow-builder`

> ⚠️ **배포만으로는 아무것도 잠기지 않는다.** 플래그를 켜야 잠긴다.
> 그리고 **키를 먼저 넣지 않고 잠그면 승인 알림이 조용히 끊긴다.**
> 이 지시서는 그 순서를 지키기 위한 것이다.

---

## 왜 잠그나

`/api/approvals` 는 `scheduler.py` 가 호출해서 지금까지 열어뒀다.
그런데 열려 있는 동안은 **누구나 승인 요청을 만들 수 있고, 그때마다 사용자 휴대폰으로
텔레그램 알림이 간다.** 실질적인 괴롭힘 벡터다.

```
curl -X POST -d '{"wf_id":"x"}' .../api/approvals   # 인증 없이 알림 발송
```

## 왜 4단계인가

한 번에 잠그면 스케줄러의 승인 요청이 401 로 막힌다.
그러면 **"알림이 안 온다"** 는 조용한 고장이 된다 — 아무 에러도 눈에 안 띄고,
사용자는 그냥 알림이 없는 줄 안다. 그게 가장 나쁜 실패 방식이다.

```
A. 배포            → 동작 변화 없음
B. 키 발급 + 설정   → 스케줄러가 키를 보내기 시작 (아직 열려 있음)
C. 확인            → 승인 요청이 정상 생성되는가
D. 잠금            → 여기서 실제로 닫힌다
```

---

## PHASE A — 배포

```bash
cd /opt/data/projects/workflow-builder
git status --short
git rev-parse --short HEAD

git pull origin main        # 6766303
npm run check
npm test                    # 9스위트 129건 기대

npx pm2 restart workflow-builder
```

부팅 로그 확인:
```bash
npx pm2 logs workflow-builder --lines 20 --nostream | grep approval
```
→ `[approval] /api/approvals 인증: 열려 있음 (WF_APPROVALS_AUTH=1 로 잠금)` 이 정상.
이 단계에서는 **열려 있는 게 맞다.**

---

## PHASE B — 키 발급 + 설정

### B-1. `ag_scheduler` 에 키 발급

`ag_scheduler` 는 이미 존재하는 팀 에이전트다. 새로 만들지 말 것.

```bash
curl -X POST -H "Authorization: Bearer <ADMIN_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"name":"scheduler-approvals","scopes":["mcp:read","mcp:execute"]}' \
  http://127.0.0.1:3737/api/agents/ag_scheduler/credentials
```

> **`mcp:admin` 을 주지 말 것.** 승인 요청 생성에는 `mcp:execute` 로 충분하다.
> 응답의 `key` 는 이때만 보인다. 로그·채팅에 남기지 말 것.

### B-2. 환경변수 + 스케줄러 재시작

`ecosystem.config.js` 에 추가 — **`WF_APPROVALS_AUTH` 는 아직 넣지 않는다:**

```js
WF_SCHEDULER_KEY: "wf_ak_ag_scheduler_...",
```

스케줄러는 pm2 가 아니라 별도 프로세스이므로, 환경변수를 직접 넣고 재시작한다:

```bash
ps aux | grep -v grep | grep scheduler.py     # pid 확인
kill <pid>
WF_SCHEDULER_KEY="wf_ak_ag_scheduler_..." \
  nohup ./.agentenv/bin/python scheduler.py >> scheduler.log 2>&1 &
```

기동 로그 확인:
```bash
tail -6 scheduler.log
```
→ `승인 키: 설정됨` 이 보여야 한다.
→ `승인 키: 없음 — /api/approvals 가 잠기면 알림이 끊긴다` 면 **PHASE D 로 가지 말 것.**

---

## PHASE C — 키가 실제로 통하는지 확인

잠그기 **전에** 확인한다. 잠근 뒤에 확인하면 실패했을 때 이미 알림이 끊긴 상태다.

```bash
# 키로 승인 요청 — 200 이어야 한다
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Authorization: Bearer <ag_scheduler_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"wf_id":"test-lock","agent_id":"ag_scheduler","action":"deploy","context":"잠금 전 확인"}' \
  http://127.0.0.1:3737/api/approvals
```

→ **200** 이고 사용자 휴대폰에 알림이 와야 한다.
→ 이 승인 건은 나중에 정리한다(아래 PHASE E).

---

## PHASE D — 잠금

`ecosystem.config.js` 에 추가:

```js
WF_APPROVALS_AUTH: "1",
```

```bash
npx pm2 restart workflow-builder --update-env
npx pm2 logs workflow-builder --lines 20 --nostream | grep approval
```
→ `[approval] /api/approvals 인증: 요구함` 으로 바뀌어야 한다.

### 검증

```bash
# 무인증 — 401 기대
curl -s -o /dev/null -w "무인증  : %{http_code}\n" -X POST \
  -H "Content-Type: application/json" -d '{"wf_id":"x"}' \
  https://187.127.124.16.sslip.io/api/approvals

# 키 — 200 기대
curl -s -o /dev/null -w "키 사용 : %{http_code}\n" -X POST \
  -H "Authorization: Bearer <ag_scheduler_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"wf_id":"test-lock2","agent_id":"ag_scheduler","action":"deploy","context":"잠금 후 확인"}' \
  http://127.0.0.1:3737/api/approvals
```

### 🔴 가장 중요 — 알림이 계속 오는지

잠근 뒤 **스케줄러가 만드는 알림이 여전히 오는지** 확인해야 한다.
여기가 끊기면 잠금 자체가 실패한 것이다.

```bash
grep "\[승인\]" scheduler.log | tail -5
```

| 로그 | 판정 |
|---|---|
| `[승인] id=NN 요청 전송` | ✅ 정상 |
| `[승인] 401 — WF_SCHEDULER_KEY 가 없거나 유효하지 않다` | ❌ **즉시 `WF_APPROVALS_AUTH=0` 으로 되돌릴 것** |

---

## PHASE E — 정리

PHASE C·D 에서 만든 테스트 승인(`test-lock`, `test-lock2`)과
이전 스팸 승인(id 8~14)을 함께 정리한다.

```bash
curl -s -H "Authorization: Bearer <ADMIN_KEY>" \
  http://127.0.0.1:3737/api/approvals/pending
# 위 목록에서 8~14 와 방금 만든 test-lock 건의 id 를 확인한 뒤

for i in 8 9 10 11 12 13 14 <test-lock id들>; do
  curl -s -X POST -H "Authorization: Bearer <ADMIN_KEY>" \
    -H "Content-Type: application/json" \
    -d '{"decision":"rejected","approver":"cleanup"}' \
    http://127.0.0.1:3737/api/approvals/$i/decide
done
```

> **id 7 과 15 는 남길 것.** 7 은 당신 테스트, 15 는 지시서 #9 트리거 기록이다.

---

## 롤백

```js
WF_APPROVALS_AUTH: "0",
```
```bash
npx pm2 restart workflow-builder --update-env
```

코드 롤백 불필요. 플래그만 끄면 배포 전 동작으로 돌아간다.

> 껐다면 **`/api/approvals` 가 다시 열린 상태**다. 그 사실과 원인을 보고할 것.

---

## 하지 말 것

1. **`WF_SCHEDULER_KEY` 없이 `WF_APPROVALS_AUTH=1` 을 켜지 말 것** —
   승인 알림이 조용히 끊긴다. 에러가 눈에 안 띄어서 한참 뒤에나 알게 된다
2. **PHASE C 를 건너뛰지 말 것** — 잠근 뒤에 확인하면 이미 끊긴 상태다
3. **`ag_scheduler` 키에 `mcp:admin` 을 주지 말 것**
4. **스케줄러가 401 을 뱉는데 방치하지 말 것** — 알림이 안 오는 것과 구분이 안 된다
5. **승인 id 7, 15 를 지우지 말 것**
6. **`approvalsAuth()` 를 라우트에서 떼지 말 것** — `ops/test-route-auth.js` 가 검사한다

---

## 보고 양식

```
[A] 배포
- pull 전 HEAD : ______   pull 후 : ______  (6766303 기대)
- npm test     : __스위트 / __건  (9/129 기대)
- 부팅 로그 approval : "열려 있음" / "요구함"   (이 단계에선 '열려 있음'이 정상)

[B] 키
- ag_scheduler 키 발급 : 완료 (scopes: mcp:read, mcp:execute)
- WF_SCHEDULER_KEY 설정 : 완료 (값 기재 금지)
- 스케줄러 재시작       : 완료
- "승인 키: 설정됨" 로그 : 있음 / 없음(→중단)

[C] 잠금 전 확인
- 키로 승인 요청 : ____ (200 기대)
- 🧑 텔레그램 알림 도착 : Y / N

[D] 잠금
- WF_APPROVALS_AUTH=1 : 완료
- 부팅 로그 : "요구함" 확인
- 무인증 POST : ____ (401 기대)
- 키 POST     : ____ (200 기대)
- scheduler.log [승인] : 정상 전송 / 401(→즉시 되돌림)

[E] 정리
- 승인 8~14 + test-lock 처리 : 완료 / 보류

[결과] 완료 / 진행 / 차단(사유)
```

작업 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록할 것.
완료되면 알려달라 — 무인증 차단과 알림 지속을 내 쪽에서 검증하겠다.
