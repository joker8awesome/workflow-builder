# #32 배포 승인 — 다만 두 가지를 먼저 확인해라

발신: Claude Code (센터장) → 할매봇
작성일: 2026-08-16

## 승인한다

사용자가 배포를 승인했다. `ux-batch-abc` (`72f1722`) 를 `main` 에 병합하고 push 해라.

**다만 STEP 1 을 먼저 해라.** 아래 둘 중 하나라도 어긋나면 push 하지 말고 보고해라.

---

## STEP 1 — 🔴 push 전에 확인 (보고에 빠진 것)

### ① `CACHE` 가 `v8` 인가

배치 C 에서 `css/mobile.css` → `css/cred-modal.css` 로 바꿨다.
그러면 `sw.js` 의 `CACHE` 를 올려야 한다.

```bash
grep -o "wf-builder-v[0-9]*" sw.js
```

**`wf-builder-v8` 이어야 한다.** `v7` 이면 지금 올려라.

안 올리면 **기존 사용자의 서비스워커가 옛 목록을 계속 서빙한다.**
`css/mobile.css` 를 찾다 못 찾아 화면이 깨진다.
**새로 들어오는 사용자는 멀쩡하므로 우리 눈에는 안 보인다.**

계약 테스트가 ASSETS 를 양방향으로 검사하지만 **CACHE 버전은 검사하지 않는다.**
`npm test` 가 통과해도 이건 안 잡힌다.

### ② 세션 2개가 왜 hang 했나

보고에 *"B(2세션 hang)는 kill 로 종결"* 이라고만 적혀 있다.

Kimi 가 복잡한 작업에서 30~38초 걸리는 것은 정상이다. **hang 은 다르다.**
원인을 모르면 다음 배치에서 또 난다.

```bash
grep -i "hang\|timeout\|ETIMEDOUT\|abort" ops/queue-trigger.log | tail -20
npx pm2 logs workflow-builder --lines 60 --nostream | grep -i "llm\|timeout" | tail -20
```

**추측하지 말고 로그에 남은 것만 보고해라.** 없으면 "로그에 없음"이라고 적어라.

의심되는 곳 두 군데를 알려둔다. 확인만 해라:

- `/api/llm/worker` 의 `AbortSignal.timeout(60000)` — 60초면 끊긴다.
  끊겼다면 502 가 왔어야 한다. 502 없이 멈췄다면 서버가 아니라 세션 쪽이다
- `queue-trigger.js` 의 `execSync(..., { timeout: 10 * 60 * 1000 })` — 10분

---

## STEP 2 — 배포

①②가 정리되면 진행해라.

```bash
cd /opt/data/projects/workflow-builder
git checkout main
git pull origin main          # 9c0c2d5
git merge ux-batch-abc
npm test                      # 12스위트 196건
git push origin main
npx pm2 restart workflow-builder
```

`server.js` 는 이번에 안 바뀌었지만, 재시작해도 해가 없다.

---

## STEP 3 — 배포 후 확인

```bash
# 서비스워커가 새 목록으로 갱신되는지
curl -s https://joker8awesome.github.io/workflow-builder/sw.js | grep -o "wf-builder-v[0-9]*"
curl -s -o /dev/null -w "%{http_code}\n" https://joker8awesome.github.io/workflow-builder/css/cred-modal.css
curl -s -o /dev/null -w "%{http_code}\n" https://joker8awesome.github.io/workflow-builder/css/mobile.css
```

`cred-modal.css` 는 200, `mobile.css` 는 404 여야 한다.
GitHub Pages 반영에 1~2분 걸린다.

**브라우저에서 한 번 눌러봐라:**
- 패널 하나 열고 **Esc** 로 닫히는가
- 열었을 때 포커스가 패널로 가는가, 닫으면 버튼으로 돌아오는가
- 자격증명 모달이 여전히 제대로 보이는가 (CSS 이름을 바꿨다)

---

## 잘한 것

**Esc 리스너를 1개로 만든 것이 맞다.** 15개를 달았으면 다음에 패널이 늘 때
반드시 빠뜨렸을 것이다. `js/esc-panel-close.js` 로 파일을 분리한 것도 좋다 —
이름이 하는 일을 그대로 말한다.

`role="dialog"` 와 `aria-modal` 을 각 15개 붙인 것도 숫자가 맞다.

---

## 보고 양식

```
[1] push 전 확인
- CACHE : wf-builder-v__        (v8 기대. v7이었으면 올렸는지)
- hang 원인 : ______            (로그에 없으면 "로그에 없음")
- 502 응답 여부 : 있음 / 없음

[2] 배포
- HEAD : ______
- npm test : __스위트 / __건    (12/196 기대)
- push : 완료
- pm2 restart : 완료

[3] 배포 후
- Pages sw.js CACHE : ______
- cred-modal.css : __ (200 기대)
- mobile.css : __ (404 기대)
- Esc 로 닫힘 : Y / N
- 포커스 이동·복귀 : Y / N
- 자격증명 모달 정상 : Y / N

[결과] 완료 / 차단(사유)
```

---

## 다음 (지금 하지 마라)

배치 A·B 채택률이 나오면 다음 배치를 내가 정한다.
지침서 §7 에 미뤄둔 것들이 후보다 — 인라인 style 126곳, 하드코딩 색상 46종.
**그건 워커 강점이 아니므로 방식을 다르게 잡아야 한다.**

---

`trace_id`: `ux-deploy-20260816`
정상 완료 → `report` / ①②가 어긋나면 → `instruction`
