# 지시서 #54 — 무료 과거배당 데이터셋(2021-2025) 로드 + fb_games 확장 + 조인

작성: 센터장(Opus 4.8) · 2026-08-18 · 대상: 할매봇(ag_hermes)
trace_id: `hist-odds-dataset-20260818`

> SGO 무료는 과거배당 불가(#53). 대신 **무료 데이터셋**으로 과거 (배당+결과) 백테스트셋을 만든다.
> 출처: GitHub `ArnavSaraogi/mlb-odds-scraper` 릴리스 에셋(JSON 76MB, 2021-03-20~2025-08-16, SportsBookReview).
> **비용 0**(다운로드 + MLB API 무료만). 유료 호출 금지.
> 📈 데이터셋이 5시즌(2021-2025)이라 그만큼 결과도 확장해 **5시즌 실험셋**을 만든다(요청한 2시즌보다 큼 — 과적합 방지 유리).

## 0. 검증 먼저 (다운로드 전)
- **라이선스 명시 없음** → **개인 백테스트 분석용으로만**, 데이터셋 재배포·저장소 커밋 금지. 우리 DB 로드만.
- 릴리스 에셋 URL 확인: `https://github.com/ArnavSaraogi/mlb-odds-scraper/releases/tag/dataset` (JSON).

## 1. 다운로드
- 릴리스 에셋 다운로드(curl `browser_download_url` 또는 `gh release download`). 76MB.
- 막히면 insane-search 엔진(#48 배포분)로 fetch. 저장소엔 커밋하지 마라(용량·라이선스).

## 2. 결과 확장 — fb_games 2021-2024 (MLB Stats API, 무료·무제한)
- `collect-mlb-backfill`을 **2021-03 ~ 2024-12** 범위로 실행 → `fb_games` UPSERT (2025-2026 이미 있음).
- 무료. 날짜 청크로 과도 폴링만 피함.

## 3. 과거배당 로드 — 신규 `fb_odds_hist` 🔒 schema.change 승인
```sql
CREATE TABLE IF NOT EXISTS fb_odds_hist (
  id         bigserial PRIMARY KEY,
  game_pk    bigint REFERENCES fb_games(game_pk),   -- 조인 후 채움(NULL 허용)
  game_date  date, home_team text, away_team text,   -- 데이터셋 원문(조인용)
  ml_home    numeric, ml_away numeric,               -- moneyline currentLine home/away
  source     text DEFAULT 'sbr-github',
  ingested_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fb_odds_hist_game ON fb_odds_hist (game_pk);
```
- JSON 파싱: 날짜키 → 각 game의 `gameView.homeTeam/awayTeam`(shortName·fullName),
  `odds.moneyline[].currentLine.homeOdds`/`awayOdds`. 경기당 1행(마감/단일값).
- 데이터셋의 자체 스코어(`gameView.homeTeamScore/awayTeamScore`)는 **교차검증용**으로만(정본은 fb_games).

## 4. 조인 (팀명 정규화)
- `(game_date + 홈 + 원정)`으로 `fb_games`에 매칭 → `game_pk`.
- ⚠️ **SBR 팀명 ≠ MLB 팀명** 가능(shortName 사용 시 특히) → 정규화 매핑 작성. 미매칭 목록 보고(매핑 보완).
- **매칭율 보고** — 이게 실험셋 크기를 정한다.

## 5. 합격기준 (숫자)
- fb_odds_hist 로드 __행 / 조인 매칭 __ / 미매칭 __ / 매칭율 __%
- **(배당+결과) 겹치는 경기 수**(2021-2025) = 실험셋 크기 보고.
- 데이터셋 자체 스코어 vs fb_games 스코어 일치 표본 확인(조인 정확성).
- **비용 0**(유료 호출 0 확인).

## 안 하는 것
- 데이터셋 재배포·저장소 커밋. 야구 픽 테이블 쓰기. 유료 API. cron(1회 로드).

## 보고 양식
```
[0 검증] 라이선스: 명시없음(분석전용) / 에셋URL 확인: 예
[1 다운로드] 방법 __ / 크기 __ / 엔진사용: 예·아니오
[2 결과확장] fb_games 총 __건 (2021-2026) / 기간 __~__
[3 배당로드] fb_odds_hist __행 / 기간 __
[4 조인] 매칭 __ / 미매칭 __ / 매칭율 __% / 팀명매핑 필요: ______
[실험셋] (배당+결과) 경기 __건
[비용] 0: 예
[막힘] ______
```

`trace_id`: `hist-odds-dataset-20260818`
