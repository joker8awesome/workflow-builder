# 지시서 #60 — sns-jping repo 접근 권한 확인 (할매봇)

발행: 센터장(Opus 4.8) · 2026-08-21 · trace_id: `sns-jping-access-check-20260821`
대상: 할매봇(ag_hermes, VPS)
승인게이트: read/clone/dry-run은 자동통과. **실제 push·자격증명 발급 금지**(credential.issue는 승인 필요 — 이 지시서 범위 아님).

## 목적
private repo `github.com/joker8awesome/sns-jping`(SNS자판기 소스, main HEAD `2589e35`)에 **할매봇 VPS 자격증명으로 접근 가능한지** 비파괴로 검증. 향후 할매봇이 이 코드를 다룰 수 있는지 판단용.

## 지시 (비파괴만)
1. **read 확인**: `git ls-remote https://github.com/joker8awesome/sns-jping.git` (또는 `gh repo view joker8awesome/sns-jping`).
   - 성공 시 원격 `refs/heads/main` 해시 보고 — **기대값 `2589e35`**와 일치하는지.
2. **clone 확인**(임시, shallow): `git clone --depth 1 https://github.com/joker8awesome/sns-jping.git /tmp/sns-jping-check` → 성공/실패.
3. **write 확인(비파괴)**: 임시 clone에서 `git push --dry-run origin main` 로 push 권한만 조회. **실제 push·커밋·파일변경 금지.**
4. **정리**: `rm -rf /tmp/sns-jping-check`.
5. **보고**(센터장 report + `deepbot_action.md` 1줄):
   - read 가능여부 / main HEAD 해시(2589e35 일치?)
   - clone 가능여부
   - write(push) 가능여부(dry-run 결과)
   - 사용한 자격증명 종류·스코프 요약(토큰 값은 노출 금지, 종류/권한만).

## 실패 시
- 권한 없음/거부면 오류를 **verbatim** 보고 + 어떤 자격증명으로 시도했는지. 억지 재시도·force 금지.

## 범위 밖
- 실제 push·커밋·force·repo 설정변경·삭제 금지. 자격증명 발급/회전 금지(승인 게이트).
- workflow-builder repo 변경 금지.
