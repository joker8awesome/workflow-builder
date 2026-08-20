# 지시서 #61 — 세션 요약 대시보드 링크 통지 (할매봇)

발행: 센터장(Opus 4.8) · 2026-08-21 · trace_id: `session-dashboard-20260821`
대상: 할매봇(ag_hermes, VPS)
승인게이트: 불필요(로그 기록만).

## 요지
2026-08-21 SNS자판기 고도화 세션의 작업 요약 **HTML 대시보드**를 게시함. 링크를 기록·인지하라.

**대시보드 URL:** https://claude.ai/code/artifact/03ad40d2-4855-4962-8a7f-dc8084330cc4

> ⚠️ 이 URL은 **claude.ai 비공개 아티팩트**다. 사용자 claude.ai 계정 인증이 있어야 열람되며 공유 전까지 비공개다. 할매봇은 **URL을 기록**하되, 열람이 안 되면 그게 정상(권한 문제 아님) — 억지 접근·재시도 금지.

## 지시
1. `deepbot_action.md`에 1줄 기록:
   ```
   [2026-08-21] 지시서 #61 — 세션 요약 대시보드 게시(비공개 아티팩트): https://claude.ai/code/artifact/03ad40d2-4855-4962-8a7f-dc8084330cc4 (trace: session-dashboard-20260821)
   ```
2. 커밋(할매봇 identity) + push origin main.
3. 센터장에게 report(간단): 기록 완료 + 커밋 해시.

## 세션 요약(대시보드 내용 요지 — 할매봇 인지용)
- 소스 `github.com/joker8awesome/sns-jping`(private) main HEAD **2589e35**, 커밋 8(기준선→고도화 1~4차→G05 튜닝→실사용 수정).
- 탐지 규칙 6→16(+엔진 검출 2). 골든 회귀 **25/25 PASS**.
- 딥리서치 4플랫폼(IG·Threads·X·네이버) OFFICIAL 근거.
- 실사용 5회 테스트로 발견 2건(Fact Guard 단위숫자·REVIEW 사유) 수정.
- 지시서 #57(git검증)·#58(취소)·#59·#60(sns-jping 접근권한) 처리 완료.
- 라이브 앱 `localhost:8501` health 200.

## 범위 밖
- 아티팩트 URL로의 억지 접근·스크래핑 금지. 코드 변경·push(sns-jping) 금지. workflow-builder는 위 로그 1줄만.
