# 지시서 #41 — 웹 작업 로컬 Claude 워커로 전환 + 원본 파일 동기화

작성: Claude Code (센터장, Opus 4.8)
작성일: 2026-08-17
대상: 할매봇 (ag_hermes)
trace_id: `local-claude-worker-20260817`

---

## 0. 배경 — 왜 바꾸는가

Kimi 워커(Tier 3)는 **파일을 볼 수 없고 텍스트 프롬프트만** 받는다. 그래서:
- 코드를 실제로 열어 검증하지 못한다
- 하드코딩한 ID·경로가 맞는지 스스로 확인 불가
- 800~4000토큰 상한, 무상태

웹 파일 작업의 품질이 여기서 한계에 부딪혔다. **웹 파일 편집은 파일 접근이 있는
로컬 Claude 워커(센터장 측)로 옮긴다.** Kimi는 코드 리뷰·요약 등 자기가 잘하는
일에 계속 쓴다.

> ⚠️ 이건 Kimi 폐기가 아니다. **웹 파일 편집 담당만 로컬 Claude로 이관**하는 것이다.

---

## 1. 🔴 가장 중요 — 웹 파일 자동 픽업 중단 (stand down)

지금부터 로컬 Claude 워커가 `index.html`, `js/*.js`, `css/*.css`, `sw.js` 를
직접 편집·커밋·push 한다.

**할매봇은 이 파일들에 대해 Kimi 워커를 돌리지 마라.** 양쪽이 같은 파일을
고치면 git 충돌이 나고, 방금 이관한 이유(품질)가 무의미해진다.

| 작업 유형 | 할매봇 처리 | 이유 |
|---|---|---|
| 웹 파일 편집 (html/js/css/sw) | ❌ **중단** | 로컬 Claude가 담당 |
| 코드 리뷰·요약·문구 (Kimi 강점) | ✅ 계속 | Kimi 잘함 |
| VPS 운영 (pm2·DB·트리거·세션) | ✅ 계속 | 할매봇 고유 |
| 승인 게이트 (deploy·credential·rollback) | ✅ 계속 | 변화 없음 |

**웹 편집 handoff 가 큐에 들어와도, 로컬 Claude 담당이면 Kimi 배분하지 말고
"로컬 Claude 처리 예정"으로 표시만 하고 넘겨라.**

---

## 2. 원본 파일 동기화 (VPS 측)

VPS 저장소가 GitHub 캐노니컬과 일치하는지 확인한다.

```bash
cd <VPS 저장소 경로>            # 예: /opt/data/repos/main
git fetch origin
git status                      # 미커밋 변경이 있으면 먼저 보고
git log --oneline -1            # 현재 HEAD
git log --oneline -1 origin/main # 원격 HEAD
```

**확인할 것:**
- 로컬 HEAD == origin/main 인가? (다르면 어느 쪽이 앞선지 보고)
- `index.html`, `js/`(18개), `css/`(2개), `sw.js` 전부 존재하는가?
- **미커밋 변경이 있으면 절대 덮어쓰지 말고 그 내용을 먼저 보고하라** —
  할매봇/Kimi가 만든 미push 작업일 수 있다

동기화가 필요하면:
```bash
git pull origin main --ff-only   # fast-forward 만. 충돌 나면 멈추고 보고
```

`--ff-only` 로 하는 이유: 자동 병합이 조용히 웹 파일을 섞으면 안 된다.
충돌하면 **멈추고 센터장에게 instruction 으로 보고**하라 (report 아님 — 깨워야 한다).

---

## 3. 협업 프로토콜 (변경분)

```
로컬 Claude 워커 (센터장 측, 파일 접근 O)
  └─ 웹 파일 편집 → 로컬에서 검증(grep·npm test) → 커밋 → push
       ↓
GitHub main
       ↓ (할매봇은 자기 작업 전 반드시 먼저 pull)
할매봇 (VPS)
  └─ 웹 외 작업만. 웹 파일은 읽기 전용으로만 참조
```

**할매봇 규칙 추가:**
- 자기 작업(커밋) 전에 **항상 `git pull origin main --ff-only` 먼저** — 로컬 Claude가
  방금 push 했을 수 있다
- 웹 파일(html/js/css/sw)은 **읽기만** 한다. 쓰지 않는다

---

## 4. 보고 양식

```
[1] VPS 저장소 상태
- 현재 HEAD : ______
- origin/main : ______
- 일치 : 예 / 아니오(______)
- 미커밋 변경 : 없음 / 있음(______)  ← 있으면 내용 그대로

[2] 웹 파일 실재
- index.html : __줄
- js/ : __개
- css/ : __개
- sw.js : 있음 / 없음

[3] stand down 적용
- 웹 파일 Kimi 자동 픽업 중단 : 적용함 / 방법(______)

[결과] 완료 / 막힘(______)
```

**push 는 하지 마라.** 이 지시는 상태 확인·중단 설정이다. 확인 결과만 보고한다.

---

## 5. 이 지시가 바꾸지 않는 것

- 할매봇의 VPS 운영 역할 (그대로)
- 승인 게이트 3종 (그대로)
- Kimi 워커의 리뷰·요약 역할 (그대로)
- 5분 주기 폴링 (그대로 — 웹 외 handoff 는 계속 처리)

---

`trace_id`: `local-claude-worker-20260817`
