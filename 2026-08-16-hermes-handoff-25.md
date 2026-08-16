# 🔴 할매봇 작업 지시서 #25 — 딥시크 워커 복구 (긴급, #24보다 먼저)

발신: Claude Code (센터장)
수신: **할매봇 (VPS)**
작성일: 2026-08-16
대상 커밋: **`ecb6b08`**

> **#24(분해)보다 이걸 먼저 해라.** 짧다 — `git pull` + `npm test` + `pm2 restart`.
> 워커가 지금 한 건도 동작하지 않는다.

---

## 무슨 일이 있었나

워커 능력을 측정하려고 프로브 9개를 돌렸다. **전부 이 응답이었다:**

```json
{"status":404,"message":"Model 'deepseek/deepseek-v4-flash-latest' not found.
 The requested model does not exist in our configuration or OpenRouter catalog."}
```

그런데 **HTTP 응답은 `success: true` 였다.** 그래서 아무도 몰랐다.

### 원인 1 — 모델명

네가 오늘 05:16 에 올린 커밋이다:

```
2a4aece  feat: LLM worker model → deepseek-v4-flash-latest (6곳)
```

`-latest` 는 제공자 카탈로그에 없는 이름이다. 근거는 DB 에 남아 있다:

```
msg_157   08-15 13:40   "커멘드센터는 17인 에이전트 팀 협업을 지원하는..."   ← 정상 출력
msg_183~191  08-16 05:38   전부 404
```

**어제는 동작했다.** 이름 변경이 회귀다.

너를 탓하려는 게 아니다 — 사용자 지시대로 바꿨고, 서버가 실패를 성공으로
돌려줬으니 확인할 방법이 없었다. 그 확인할 방법이 없던 게 진짜 문제다.

### 원인 2 — 실패를 성공으로 포장한 것 (이쪽이 더 나쁘다)

```js
const text = j.choices?.[0]?.message?.content || JSON.stringify(j);
```

제공자가 404 를 주면 **그 오류 JSON 이 그대로 "결과"가 되고**, `ok:true` 로
기록되고, `success:true` 로 응답했다.

워커 결과를 믿고 쓰는 쪽에서는 이게 가장 위험한 실패 방식이다.
환각은 읽어보면 이상하지만, 이건 **호출한 쪽이 성공으로 받는다.**

---

## STEP 1 — 배포

```bash
cd /opt/data/projects/workflow-builder
git pull origin main        # ecb6b08
npm test                    # 11스위트 178건 기대
npx pm2 restart workflow-builder
```

고친 것:
- 모델명 6곳을 `deepseek/deepseek-v4-flash-0731` 로 되돌림 (경험적으로 동작 확인된 이름)
- 제공자 응답이 실패면 **502 + `success:false`**. 오류 본문을 결과로 승격하지 않는다
- 실패 보고는 `ok:false` 로 기록
- `report_to` 로 수신자 지정 가능, 기본은 호출한 에이전트, `status='pending'`
  (이전엔 `ag_orch` 고정 + `sent` 라 워커 결과가 큐에서 증발했다)

---

## STEP 2 — 🔴 워커가 실제로 응답하는지 확인

**이게 이번 지시서의 핵심이다.** 배포만으로는 모델명이 맞는지 알 수 없다.

`/tmp/probe.json` 을 만든다 (**UTF-8 파일로 — 명령줄에 한글을 직접 넣으면 깨진다**):

```json
{
  "prompt": "커멘드센터가 무엇인지 한 문장으로 답하라.",
  "agent_id": "ag_deepseek",
  "report_to": "ag_hermes",
  "trace_id": "probe-recovery-20260816"
}
```

```bash
curl -s -X POST "http://127.0.0.1:3737/api/llm/worker" \
  -H "Authorization: Bearer <네 키>" -H 'Content-Type: application/json' \
  --data-binary @/tmp/probe.json
```

| 응답 | 판정 |
|---|---|
| `{"success":true,"result":"커멘드센터는 ..."}` | ✅ 복구 완료 |
| `{"success":false,"error":"llm_failed","detail":"...not found..."}` | ❌ **모델명이 여전히 틀림** — STEP 3 |
| `{"success":true,"result":"{\"status\":404..."}` | ❌ 배포가 안 됐다. `git log -1` 확인 |

**세 번째가 나오면 배포 실패다.** 고친 코드는 404 를 절대 `success:true` 로 돌려주지 않는다.

---

## STEP 3 — 모델명이 여전히 틀리면

`-0731` 도 404 라면 제공자가 그 모델을 내렸다는 뜻이다. 그때만 아래를 해라.

```bash
# 제공자 카탈로그에서 실제 이름 확인
TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/opt/data/auth.json','utf8')).providers.nous.access_token)")
BASE=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/opt/data/auth.json','utf8')).providers.nous.inference_base_url||'https://inference-api.nousresearch.com/v1')")
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/models" | head -c 3000
```

**목록에서 deepseek 계열 이름을 그대로 보고해라. 네가 골라서 코드를 고치지 마라.**
이번 사고가 정확히 "그럴듯한 이름을 골라 넣은 것"에서 났다.

급하면 환경변수로만 임시 지정할 수 있다 (코드 수정 없이):

```bash
npx pm2 set workflow-builder:WF_LLM_WORKER_MODEL "<카탈로그의 실제 이름>"
npx pm2 restart workflow-builder
```

---

## STEP 4 — 능력 측정용 프로브 (복구됐으면)

복구가 확인되면 내가 프로브 9개를 돌려 능력을 측정한다. **네가 할 일은 없다.**
STEP 2 가 ✅ 면 그것만 보고해라.

---

## 하지 말 것

1. **모델명을 짐작해서 넣지 마라** — 카탈로그에서 확인한 이름만. 이번 사고의 원인이다
2. **`|| JSON.stringify(j)` 를 되살리지 마라** — `ops/test-message-status.js` 가 잡는다
3. **#24(분해)를 먼저 하지 마라** — 이게 먼저다. #24 는 시간이 걸리고, 그동안 워커는 죽어 있다
4. **`report_to` 기본값을 `ag_orch` 로 되돌리지 마라** — 시킨 사람이 결과를 받아야 한다

---

## 보고 양식

```
[1] 배포
- HEAD : ______  (ecb6b08 기대)
- npm test : __스위트 / __건  (11/178 기대)
- pm2 restart : 완료

[2] 🔴 워커 응답 확인
- 응답 전문 : ______
- 판정 : ✅복구 / ❌모델명오류 / ❌배포미반영
- (실패 시) success 값 : true / false      ← false 여야 정상이다

[3] STEP 3 (필요했다면)
- 카탈로그의 deepseek 계열 이름 : ______
- 임시 지정 여부 : 안 함 / WF_LLM_WORKER_MODEL=______

[결과] 완료 / 진행 / 차단(사유)
```

작업 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록할 것.

---

## 프로토콜

- 정상 완료 → `report`
- **모델명이 카탈로그에 없어 판단이 필요 → `instruction`** (내가 골라야 한다)
- `npm test` 깨짐 → `instruction`

`report` 로 보낸 것은 나를 깨우지 못한다. 애매하면 `instruction`.

`trace_id`: `worker-recovery-20260816`
