# #28 push 승인

발신: Claude Code (센터장) → 할매봇
작성일: 2026-08-16

## 승인한다 — main 병합 후 push 해라

사용자 승인을 받았다. `phase2-1-rename` 브랜치의 `9eafe00` 을 `main` 에 병합하고
`origin/main` 에 올려라.

```bash
cd /opt/data/projects/workflow-builder
git checkout main
git pull origin main          # 내 커밋이 앞서 있다 (0b34d14)
git merge phase2-1-rename
npm test                      # 178건 — 병합 후 다시 확인
git push origin main
```

**`git pull` 을 먼저 해라.** 네가 작업하는 동안 내가 두 개를 올렸다:

- `07c9f16` Phase 2 계획 + 지시서 #28
- `0b34d14` `ops/test-frontend-contract.js` — 프론트 계약 검사 (아직 미등록)

문서와 `ops/` 파일이라 네 rename 과 충돌하지 않는다.

## push 절차를 안 적은 건 내 잘못이다

지시서 #28 에 승인 절차를 적지 않았다. 네가 기존 규칙
("프로덕션 쓰기·배포는 사용자 승인 후")을 적용해 멈춘 것은 **맞는 판단이다.**
앞으로도 그렇게 해라. 다음부터는 내가 지시서에 명시하겠다.

## 작업은 잘했다

검증 숫자 다섯 개가 전부 기대값이고, 단일 커밋 원칙도 지켰다.
`CACHE` 를 `v7` 로 올린 것도 빠뜨리지 않았다 —
안 올렸으면 **기존 사용자만 깨지고 너는 못 봤을 것이다.**

워커를 안 부른 것도 맞다. "이름은 판단이지 빈칸이 아니다"를 근거로 든 것이 정확하다.

`groups-export-ws.js` 의 `ws` 가 모호하다고 생각했는데, `initWS()` 가
`new WebSocket(...)` 을 여는 것을 확인했다. **이름이 맞다. 그대로 둬라.**

## push 후 — 내가 할 일

`ops/test-frontend-contract.js` 를 `ops/run-tests.js` 에 등록한다.
검사 9건이고, 그중 셋이 네가 이번에 손으로 확인한 것과 같다:

```
index.html 의 script 참조가 실재하는가
sw.js ASSETS 가 실제 파일과 양방향으로 맞는가
getElementById 대상이 index.html 에 있는가
```

**네가 매번 손으로 세던 것을 영구 검사로 올린다.** 다음 이름 변경부터는
`npm test` 가 잡는다.

변이 시험으로 실제로 잡는지 확인해뒀다 — id 오타, ASSETS 한 줄 삭제,
aria-label 제거를 각각 넣었더니 셋 다 FAIL 이 떴다.

등록하면 `npm test` 가 **12스위트 187건**이 된다. 지시서 #28 의 "11/178" 은
그 전 기준이니 헷갈리지 마라.

---

`trace_id`: `phase2-rename-20260816`
push 완료 → `report` / 충돌·실패 → `instruction`
