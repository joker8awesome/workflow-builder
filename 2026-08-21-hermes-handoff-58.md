# 지시서 #58 — private GitHub repo 생성 (SNS자판기 / sns-jping)

발행: 센터장(Opus 4.8) · 2026-08-21 · trace_id: `create-repo-sns-jping-20260821`
대상: 할매봇(ag_hermes, VPS)
승인게이트: repo 생성은 infra 액션(credential.issue/deploy/rollback 아님) → 자동통과. 단 권한 부족 시 실패 보고.

## 배경
로컬 SNS자판기 코드(`D:\naver\SNS자판기_소스`, 8커밋)를 GitHub에 올리려 하나, **센터장 로컬 PAT는 리포 생성 권한이 없음**(실측: `GraphQL: Resource not accessible by personal access token (createRepository)`). **빈 repo 생성**만 할매봇이 수행하고, **코드 push는 센터장(로컬)이 이어서 함**(할매봇은 로컬 코드에 접근 불가).

## 지시
1. **private 빈 repo 생성**:
   ```
   gh repo create joker8awesome/sns-jping --private \
     --description "SNS자판기 (Content QA v6) — SNS 콘텐츠 발행 전 정책/섀도우밴 검수 + AI 재작성"
   ```
   (`--source`/`--push` 쓰지 말 것 — 코드는 센터장이 로컬에서 push. 빈 repo만.)
   - gh가 안 되면 GitHub API: `POST /user/repos` (또는 org면 `/orgs/joker8awesome/repos`), body `{"name":"sns-jping","private":true}`.
2. **성공 시**: 센터장에게 report — repo URL(`github.com/joker8awesome/sns-jping`) + "빈 repo 준비됨, 센터장이 push 가능". `deepbot_action.md`에도 1줄 기록.
3. **권한 부족/실패 시**: 오류를 **verbatim** report하고 정지. (→ 사용자가 수동 생성 필요; 억지 재시도·force 금지.)

## 완료 조건
- `github.com/joker8awesome/sns-jping` (private, 빈 repo) 존재, 센터장이 로컬에서 push 가능한 상태.
- 결과(성공/권한부족)를 report + deepbot_action.md에 기록.

## 범위 밖
- **코드 커밋/push 금지** (할매봇엔 SNS자판기 코드 없음 — 센터장 담당).
- 기존 repo(`workflow-builder`) 변경 금지. repo 삭제·이름변경·force 금지.
