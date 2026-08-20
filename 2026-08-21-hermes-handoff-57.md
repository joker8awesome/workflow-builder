# 지시서 #57 — git write-path 검증 (할매봇 커밋+push 라운드트립)

발행: 센터장(Opus 4.8) · 2026-08-21 · trace_id: `git-verify-20260821`
대상: 할매봇(ag_hermes, VPS)
승인게이트: **불필요** — `code.change`/`agent.write`/git push 는 자동통과 범위(deploy·credential.issue·rollback 아님).

## 배경
사용자가 GitHub 연동 상태를 확인 완료: origin = `github.com/joker8awesome/workflow-builder`, main 로컬↔원격 동기화 정상. 센터장이 커밋 `694a84d`(SNS자판기 고도화 리포트)를 push함. **할매봇의 git write-path(커밋+push)가 실제로 동작하는지 라운드트립으로 확인**하는 것이 이 지시서의 목적이다.

## 지시 (순서대로)
1. `git pull --ff-only origin main` — 최신 main 동기화(센터장 커밋 `694a84d` 포함 확인).
2. **`deepbot_action.md` 말미에 로그 1줄 append** (이 파일만 수정 — 센터장 파일 `2026-08-21-snsjping-upgrade-research.md`·`2026-08-21-hermes-handoff-57.md`·기타 handoff는 건드리지 말 것):
   ```
   [2026-08-21] 지시서 #57 — git write-path 검증: main 최신(694a84d) pull 확인, 할매봇 커밋+push 라운드트립 정상. (trace: git-verify-20260821)
   ```
   (실제 pull한 HEAD 해시가 694a84d와 다르면 그 해시로 기록.)
3. 커밋 (할매봇 git identity `Hermes Agent <hermes@nousresearch.com>` 그대로):
   ```
   git add deepbot_action.md
   git commit -m "log: 지시서 #57 완료 — git write-path 검증 (할매봇 커밋+push 라운드트립)"
   ```
4. `git push origin main` — push 성공 확인(원격 반영).
5. **보고**: 센터장에게 report(또는 deepbot_action.md에 결과 append) — 커밋 해시 + push 결과 + `git pull`로 본 최신 원격 HEAD.

## 완료 조건
- `deepbot_action.md`에 검증 로그가 커밋되고 origin/main에 push되어, 원격에서 조회 가능.
- 실패 시(push 거부·충돌 등) 그 원문 오류를 report로 보고하고 정지(임의 force-push 금지).

## 범위 밖
- 코드 변경·배포·스키마 변경 없음. `deepbot_action.md` 외 파일 수정 금지.
- `git push --force`·rebase·main 히스토리 재작성 금지.
