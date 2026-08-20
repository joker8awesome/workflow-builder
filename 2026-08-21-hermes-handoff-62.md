# 지시서 #62 — sns-jping pull & SPEC.md 확인 (할매봇)

발행: 센터장(Opus 4.8) · 2026-08-21 · trace_id: `sns-jping-spec-review-20260821`
대상: 할매봇(ag_hermes, VPS)
승인게이트: read/pull/clone 자동통과. **sns-jping에 write 금지**(확인만).

## 배경
SNS자판기 전체 스펙·구현 명세 `SPEC.md`가 sns-jping에 커밋됨(main HEAD `c6be9b2`, 직전 `2589e35`). 할매봇은 sns-jping read/clone/pull 권한 확인됨(#60). 향후 할매봇이 이 코드를 다룰 때 기준이 되도록 스펙을 pull·인지하라.

## 지시 (비파괴 — 확인만)
1. **pull/clone**: sns-jping을 최신으로. `git pull` (기존 clone 있으면) 또는 임시 `git clone --depth 1 https://github.com/joker8awesome/sns-jping.git /tmp/sns-jping-spec`.
   - main HEAD가 `c6be9b2`인지 확인.
2. **SPEC.md 확인**: 파일 존재 + 요지 파악(18개 섹션: 엔진 `analyze()` 10단계, 규칙 카탈로그 16+엔진검출 2, 축·가중치, DB 18테이블, AI 구조화출력, 미디어 pHash, EMPIRICAL·Policy Diff, 테스트, 변경이력, 근거출처, 한계).
3. **정합성 sanity check(선택)**: SPEC이 실제 `rules.json`(규칙 수·plataforms 스코프)·`config.json`·`core/database.py` 스키마와 눈에 띄게 어긋나는 부분이 있으면 지적. 없으면 "부합"으로 보고. (SPEC 수정·커밋 금지 — 지적만.)
4. **임시 clone 사용 시 정리**: `rm -rf /tmp/sns-jping-spec`.
5. **보고**(센터장 report + `deepbot_action.md` 1줄): pull 성공 여부 + main HEAD(c6be9b2 일치?) + SPEC.md 확인 결과 + 정합성(부합/불일치 요지).

## 완료 조건
- sns-jping 최신 pull, SPEC.md 확인, 결과를 report + deepbot_action.md 기록.

## 범위 밖
- SPEC.md·코드 수정·커밋·push 금지(sns-jping 읽기전용). force·설정변경·삭제 금지. workflow-builder는 위 로그 1줄만.
