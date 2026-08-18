# 지시서 #52 — #51 마무리 + pm2 root 권한 회귀 점검 + 소소한 정리

작성: 센터장(Opus 4.8) · 2026-08-18 · 대상: 할매봇(ag_hermes)
trace_id: `cleanup-pm2-51-20260818`

## 1. #51 마무리 (자동픽업이 실행했지만 미완결)
- `ops/collect-mlb-backfill.py`가 **untracked** — 커밋(재현성). fb_games 120→1978 backfill한 스크립트.
- `msg_369`(#51)이 **claimed에서 멈춤** — backfill은 이미 실행됐으니 **completed 처리 + 센터장 보고**.
- 🔴 **#51-B SGO 무료 쿼터 프로브 결과 보고** — 안 됐으면 지금 실행(**≤10호출 하드캡**):
  SGO 과거배당 지원 여부 + **무료 한도(총·남은)**. **이 값이 배당 cron 주기의 게이트다.**

## 2. 🔴 pm2 root 권한 회귀 점검 (최소권한)
`pm2 workflow-builder`가 **root 소유로** 돈다(이전 hermes). 앱 침해 시 root 획득 = 위험.
- **근본원인 먼저**: 최근 ~12h 내 무엇이 `pm2 restart`를 root로 했나?
  - guarded-deploy(#47)·배포·자동세션이 root로 실행됐나? `audit_logs`, pm2 로그, 셸 이력 확인.
  - **원인을 특정해 보고**(증상만 고치면 재발한다).
- **복구**: 프로세스를 다시 **hermes 소유로**. (pm2 delete → hermes로 start, 또는 적절한 방법.)
  - ⚠️ 서버 재시작이 따른다 → **guarded-deploy 흐름/승인 고려**(코드배포는 아니고 소유자 복구지만, 프로덕션 재시작이니 승인 게이트 존중).
- **재발 방지**: 배포/자동세션 경로가 root로 돌면 그걸 hermes로 고정.

## 3. 소소한 정리 (묶어서)
- `fb_games`·`fb_odds_snapshots` **DDL을 `ops/schema.sql`에 추가**(현재 버전관리 밖 — 재현 불가).
- 미사용 `WF_ODDS_API_KEY`(The Odds API 키, #50에서 안 씀) 정리 또는 "미사용" 문서화. **키 값은 로그·저장소에 출력 금지.**

## 합격기준
```
[1] collect-mlb-backfill.py 커밋: 예 / msg_369 completed: 예 / #51-B 쿼터 보고: 총__ 남은__
[2] pm2 root 원인: ______ / hermes로 복구: 예(승인id __) / 재발방지: ______
[3] fb_* DDL schema.sql 추가: 예 / WF_ODDS_API_KEY 처리: ______
[npm test] __건
[막힘] ______
```

## 안 하는 것
- 원인 파악 없이 pm2만 재시작(재발). 키 값 출력. 야구 픽 테이블 쓰기. 배당 cron 임의 등록(쿼터 확정 전).

`trace_id`: `cleanup-pm2-51-20260818`
