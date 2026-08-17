# 지시서 #49 — Phase 0 B1: fb_games 테이블 + MLB 일정·결과 수집기

작성: 센터장(Opus 4.8) · 2026-08-18 · 대상: 할매봇(ag_hermes)
trace_id: `mlb-collector-20260818`

> formula-backtracer Phase 0의 첫 조각. **MLB Stats API(무료·키 불필요)**로 일정+결과를 `fb_games`에 적재.
> 야구 픽 프로젝트의 `games`/`odds_snapshots`는 **건드리지 않는다**. 우리 `fb_*` 테이블만.
> 배당 수집(B2)은 별건(소스 결정 후). 이건 일정·결과(라벨)만.

## 1. B3 묶음 — `fb_games` 생성 🔒 schema.change 승인
```sql
CREATE TABLE IF NOT EXISTS fb_games (
  game_pk    bigint PRIMARY KEY,        -- MLB Stats API gamePk (네이티브 id)
  game_date  date NOT NULL,
  start_time timestamptz,
  home_team  text NOT NULL,
  away_team  text NOT NULL,
  home_score int,                        -- 종료 후 채움 (라벨)
  away_score int,
  status     text,                       -- Scheduled/Final 등
  updated_at timestamptz DEFAULT now()
);
```
- 우리 테이블이지만 **테이블 생성은 schema.change 승인 게이트**(approval-gate.js). 승인 요청 생성 후 진행.

## 2. B1 — MLB 수집기 스크립트 `ops/collect-mlb.py` (또는 .js)
**소스:** MLB Stats API `schedule` 엔드포인트 하나로 일정+결과가 다 나온다(무료·키 불필요).
```
GET https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```
응답의 각 game에서:
- `gamePk` → game_pk
- `gameDate`(UTC) → start_time, 그 date → game_date
- `teams.home.team.name` / `teams.away.team.name` → home_team/away_team
- `status.detailedState` → status. **Final이면** `teams.home.score`/`teams.away.score` → home_score/away_score

**로직:** 최근 과거(예: 어제~오늘) + 예정(예: +7일) 범위를 조회해 `fb_games`에 **UPSERT**
(`ON CONFLICT (game_pk) DO UPDATE` — 예정 경기가 나중에 Final로 갱신되게).
- sportId=1 = MLB. 시즌 외에는 경기 0건일 수 있음(정상).

## 3. cron 등록
- 하루 1~2회(예: 정오·자정) `collect-mlb.py` 실행. 예정경기 적재 + 종료경기 스코어 갱신.
- scheduler.py 폴링에 추가하거나 별도 cron. **서버 재시작 불필요**(독립 스크립트라 guarded-deploy 대상 아님).

## 4. 합격기준 (숫자)
- `fb_games`에 오늘~예정 경기가 들어간다: `SELECT count(*), min(game_date), max(game_date) FROM fb_games`.
- 종료 경기에 스코어가 채워진다: `SELECT count(*) FROM fb_games WHERE home_score IS NOT NULL`.
- 재실행 멱등(중복 행 0, UPSERT 확인).
- (시즌 외면) 스크립트가 0건이어도 에러 없이 종료.
- 관련 정적 검사 1건 `ops/`에 추가(예: 수집기가 fb_games에만 쓰고 games/odds_snapshots엔 안 쓴다).

## 5. 안 하는 것
- 야구 픽 `games`/`odds_snapshots`에 쓰기.
- 배당 수집(B2 별건).
- MLB Stats API를 과도 폴링(하루 1~2회면 충분).

## 보고 양식
```
[테이블] fb_games 생성 승인id __ → 생성: 예
[수집기] ops/collect-mlb.__ / 조회범위 __
[적재] fb_games 경기수 __ / 기간 __~__ / 스코어채워진 경기 __
[멱등] 재실행 중복 0: 예
[cron] 등록: 예 (__회/일)
[막힘] ______
```

`trace_id`: `mlb-collector-20260818`
