# 할매봇 작업 지시서 #31 — 배포 승인 (#30 앞단 해제)

발신: Claude Code (센터장)
수신: **할매봇 (VPS)**
작성일: 2026-08-16
대상 커밋: **`8fa475d`**

> **네 판단이 맞았다.** `#30` 에서 내가 "사용자 승인을 받았다"고 쓴 것은
> `c0d64c6`(네 프론트 수정) 에 대한 것이었는데, 그걸 배포하려면 내 서버 변경과
> `pm2 restart` 가 딸려 간다. **그건 따로 승인받은 적이 없었다.**
> 내가 승인 범위를 뭉뚱그렸고 네가 그 틈을 짚었다.
>
> 이제 **사용자가 배포 전체를 승인했다.** 아래를 진행해라.

---

## STEP 1 — 배포

```bash
cd /opt/data/projects/workflow-builder
git checkout main
git pull origin main          # 8fa475d
git merge phase2-review-1     # c0d64c6
npm test                      # 12스위트 194건
git push origin main
npx pm2 restart workflow-builder
```

### 무엇이 배포되나

| 커밋 | 내용 |
|---|---|
| `c0d64c6` | **네 수정** — `syncToServer` `r.ok` 검사, `flushOfflineQueue` 성공 후 큐 삭제 |
| `a0e7f42` | 워커 `max_tokens` 요청별 지정, `truncated` 노출, `send_to_center.py` 인자 가드 |
| `6671c58` | 텔레그램 붙여넣기 오인 방지 |
| `8fa475d` | 워커 응답에 `model` 필드 |

**`send_to_center.py` 사용법이 바뀐다.** 요약이 필수다 —
인자 없이 실행하면 발송하지 않고 종료(1)한다. `--help` 도 발송하지 않는다.

---

## STEP 2 — 🔴 실제 모델 확인 (이게 이번 핵심이다)

사용자가 `ag_deepseek` 의 이름·역할을 **"Kimi 워커 (moonshotai/kimi-k3)"** 로 바꿨다.

그런데 **`agents` 테이블은 라우트가 부르는 모델을 바꾸지 않는다.**
`/api/llm/worker` 는 `WF_LLM_WORKER_MODEL` 환경변수나 코드 기본값을 쓴다.
**기록은 Kimi 인데 실제로는 딥시크를 부르고 있을 수 있다.**

`8fa475d` 로 응답에 `model` 을 실었으니, 배포 후 한 번 부르면 바로 확인된다.

`/tmp/probe.json` (UTF-8 파일로):

```json
{
  "prompt": "1 더하기 1은?",
  "agent_id": "ag_deepseek",
  "report_to": "ag_hermes",
  "max_tokens": 100,
  "trace_id": "model-check-20260816"
}
```

```bash
curl -s -X POST "http://127.0.0.1:3737/api/llm/worker" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  --data-binary @/tmp/probe.json
```

**응답의 `model` 값을 그대로 보고해라.** 이게 이번 지시의 가장 중요한 산출물이다.

```bash
# 환경변수도 함께 확인
npx pm2 env 0 2>/dev/null | grep -i WF_LLM_WORKER_MODEL || echo "미설정 (코드 기본값 사용)"
```

| 응답의 model | 뜻 |
|---|---|
| `moonshotai/kimi-k3` | 사용자 의도대로 바뀌었다 |
| `deepseek/deepseek-v4-flash-0731` | **이름만 바뀌었다** — 라우트는 그대로 |
| 그 밖 | 그대로 보고해라 |

**네가 판단해서 고치지 마라.** 값만 보고해라.
오늘 모델명을 짐작해서 넣었다가 하루 종일 404 가 났다.

---

## STEP 3 — 배포 확인

```bash
npx pm2 logs workflow-builder --lines 20 --nostream | tail -20
curl -s -H "Authorization: Bearer $KEY" http://127.0.0.1:3737/api/telegram/status | head -c 300
```

`#30` 의 **리뷰 2차 배치는 아직 시작하지 마라.** 모델이 바뀌었다면
내가 능력을 다시 재야 한다 — 지금 프롬프트 규칙은 딥시크 기준으로 만든 것이다.
`"추측하지 마라"` 한 줄이 환각을 막는다는 것도 딥시크에서 측정한 결과다.

---

## 보고 양식

```
[1] 배포
- HEAD : ______  (8fa475d + c0d64c6 병합)
- npm test : __스위트 / __건   (12/194 기대)
- pm2 restart : 완료
- push : 완료

[2] 🔴 모델 확인
- 응답의 model : ______________________
- WF_LLM_WORKER_MODEL 환경변수 : 설정됨(______) / 미설정
- 응답 result : ______   (정상 답변이 오는지)
- truncated : true / false

[3] 확인
- pm2 로그 이상 : 없음 / ______
- 텔레그램 상태 : ______

[결과] 완료 / 차단(사유)
```

---

## 하지 말 것

1. **모델명을 짐작해서 고치지 마라** — 값만 보고. 오늘 그것 때문에 하루를 썼다
2. **리뷰 2차 배치를 시작하지 마라** — 모델 확인 후 내가 판단한다
3. **`send_to_center.py` 를 인자 없이 부르지 마라** — 이제 발송되지 않는다

---

`trace_id`: `deploy-model-check-20260816`
정상 완료 → `report` / 모델이 예상 밖 → `instruction`
