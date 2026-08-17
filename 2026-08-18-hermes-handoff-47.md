# 지시서 #47 — deploy 승인 게이트 형식 강제 (에이전트 세션)

작성: 센터장(Opus 4.8) · 2026-08-18 · 대상: 할매봇(ag_hermes)
trace_id: `deploy-gate-enforce-20260818`

## 배경 (실측)
- #46 배포 때 세션이 `pm2 restart`를 **직접** 하고 `wf_approvals` 레코드를 안 만들었다.
  → deploy 게이트가 형식적으로 안 걸리고 **구두 승인**만으로 배포됨(거버넌스 구멍).
- 🔴 그런데 **메커니즘은 이미 있다**: `POST /api/approvals`(server.js:728)는 `decision:'pending'`이면
  `notify.approvalRequest`로 **사용자에게 텔레그램 알림**을 보내고 id를 반환한다. 텔레그램 버튼 →
  webhook이 `wf_approvals.decision`을 approved/rejected로 갱신한다.
- **갭은 코드가 아니라 세션이 이 엔드포인트를 안 부른 것.** approval-gate.js `requiresApproval('deploy')`=true.

## 목표
에이전트 세션이 deploy(git pull + pm2 restart) **전에 반드시** wf_approvals pending 레코드를 만들고,
**approved 되기 전엔 배포하지 않는다.**

## 작업
1. **가드된 배포 래퍼** `ops/guarded-deploy.js` (또는 .sh):
   - `require('../approval-gate').requiresApproval('deploy')` 확인.
   - `POST /api/approvals` 호출: `{ wf_id:'ops', agent_id:'ag_hermes', action:'deploy',
     context:'<무엇을 배포하는지>', decision:'pending' }` → **id 수신(텔레그램 알림 발송됨)**.
   - **폴링**: `GET /api/approvals`(server.js:1091, LIMIT 100)로 그 id의 `decision` 확인.
     5초 간격, 상한 예 10분.
   - `approved` → `git pull` + `pm2 restart workflow-builder` 실행.
   - `rejected`/타임아웃 → **배포 중단 + 정직 보고**(#25: 승인 안 나면 "배포 안 됨"이라고).
   - 인증: 기존 세션 키(mcp:execute) 사용.
2. **규칙 명문화**: 에이전트는 배포 목적의 raw `pm2 restart`/`git pull+restart`를 **직접 하지 않는다.**
   항상 `guarded-deploy`를 통한다. (`deepbot_action.md` 또는 워크스페이스 규칙에 기록)
3. **정적 가드 테스트**: ops 스크립트/세션 경로에서 배포 목적 raw `pm2 restart`가 래퍼 밖에 있으면
   잡는 검사 1건을 `ops/test-*`에 추가(앵커 게이트류). 래퍼 파일 자신은 예외.
4. **(부수) 작은 정합성 버그**: server.js:735 INSERT가 `decision='pending'`인데도 `decided_at=now()`를
   넣는다 — pending은 `decided_at` NULL이어야 한다. 고칠지 판단(고치면 server.js라 아래 순서 주의).

## 순서·승인
- **가능한 한 server.js를 안 건드린다**(기존 `POST/GET /api/approvals` 사용). by-id 상태 엔드포인트를
  새로 추가하면 편하지만 그건 server.js → **#43-C·#44-E·#46과 직렬**이니, 우선 기존 list 폴링으로 해결.
- 4번(decided_at)을 하면 server.js 직렬 규칙 적용.
- **dogfood**: 이 변경을 반영하는 배포 자체를 **새 래퍼로** 수행(래퍼가 스스로를 통해 배포).

## 합격기준
- 래퍼로 배포 시 `wf_approvals`에 pending 레코드 생성 + 텔레그램 알림 발송 확인.
- **승인 전 pm2 restart 실행 0** (거부/타임아웃 시 배포 0건).
- `npm test` 전 스위트 통과 + 신규 정적 가드 검사.
- 일부러 rejected로 두었을 때 배포가 실제로 막히는지 확인.

## 안 하는 것
- 승인 없이 배포. raw pm2 restart를 배포에 직접 사용. 실패를 성공으로 보고.
- deploy 외 게이트(credential.issue·rollback·schema.change)는 이번 범위 밖(같은 패턴으로 후속).

## 보고 양식
```
[래퍼] ops/guarded-deploy.__ 생성: 예 / 승인생성+텔레그램: 예
[폴링] approved 대기→배포: 예 / rejected시 배포0: 예
[정적가드] raw pm2 restart 검사 추가: __건
[decided_at 버그] 고침/보류
[npm test] __스위트 / __건
[dogfood] 이 배포를 래퍼로 함: 예
[막힘] ______
```

`trace_id`: `deploy-gate-enforce-20260818`
