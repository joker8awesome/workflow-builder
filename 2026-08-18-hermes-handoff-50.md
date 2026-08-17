# 지시서 #50 — Phase 0 B2: fb_odds_snapshots + SportsGameOdds 배당 수집기

작성: 센터장(Opus 4.8) · 2026-08-18 · 대상: 할매봇(ag_hermes)
trace_id: `sgo-odds-collector-20260818`

> formula-backtracer Phase 0 배당 축. SportsGameOdds(SGO)로 MLB moneyline을 시간별 스냅샷으로 적재.
> 키는 **`WF_SGO_API_KEY` env에서만** 읽는다 — 코드·저장소·로그에 키를 넣지 마라(유출 교훈).
> 우리 `fb_*` 테이블만. 야구 픽 games/odds_snapshots 건드리지 마라.

## 0. STEP 0 — 실제 스키마·쿼터 확인 먼저 (문서 미공개)
`WF_SGO_API_KEY` 존재 확인. 없으면 **중단+보고**(변수명 확인 필요).
1회 호출로 **실제 응답 구조와 무료 한도**를 직접 확인:
```bash
curl -s -H "x-api-key: $WF_SGO_API_KEY" \
  "https://api.sportsgameodds.com/v2/events?leagueID=MLB&oddsAvailable=true&limit=3" | head -c 4000
```
**보고할 것 (지어내지 말고 실제 필드명):**
- 이벤트 id 필드명 / 홈·원정 팀 필드 / 경기 시작시각 필드
- moneyline(h2h) 배당이 어디에(oddID 형식 `{statID}-{statEntityID}-{periodID}-{betTypeID}-{sideID}`) / bookmaker별 price 필드
- 응답/헤더에 쿼터·usage 정보 있나, 무료 한도

## 1. 테이블 `fb_odds_snapshots` 생성 🔒 schema.change 승인
```sql
CREATE TABLE IF NOT EXISTS fb_odds_snapshots (
  id           bigserial PRIMARY KEY,
  game_pk      bigint REFERENCES fb_games(game_pk),  -- 매칭된 MLB 경기(매칭 전 NULL 허용)
  sgo_event_id text,                                  -- SGO 네이티브 이벤트 id
  game_date    date,                                  -- 재매칭용
  home_team    text, away_team text,                  -- 재매칭용(정규화 전 원문)
  bookmaker    text,
  market       text,                                  -- 'moneyline'
  side         text,                                  -- 'home'/'away'
  price        numeric,
  collected_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fb_odds_game_time ON fb_odds_snapshots (game_pk, collected_at);
CREATE INDEX IF NOT EXISTS idx_fb_odds_event ON fb_odds_snapshots (sgo_event_id, collected_at);
```

## 2. 수집기 `ops/collect-odds-sgo.py`
- 키: `os.environ['WF_SGO_API_KEY']` (없으면 종료+보고).
- `/v2/events?leagueID=MLB&oddsAvailable=true` 호출(한 번에 여러 경기). **쿼터 절약: moneyline만**, bookmaker 최소.
- STEP 0에서 확인한 실제 필드로 각 이벤트에서 moneyline home/away price 추출 → `fb_odds_snapshots`에
  **매 폴링 = 새 스냅샷 행**(append, upsert 아님) `collected_at=now()`.
- sgo_event_id·game_date·home_team·away_team는 **항상 저장**(나중 재매칭용).

## 3. 🔴 fb_games 조인 (팀명 정규화)
- SGO 이벤트 id ≠ MLB gamePk. `(game_date + 홈 + 원정)`으로 `fb_games`에 매칭해 `game_pk` 채움.
- **팀명 표기 차이**(예 MLB "New York Yankees" vs SGO 표기) → 정규화 매핑 필요.
  매칭 안 되면 game_pk NULL로 두고 **미매칭 목록 보고**(매핑 보완용). fb_games가 아직 비어도 행은 저장(재매칭).

## 4. cron
- 하루 3~4회(예: 개장 시간대·경기 6시간 전 근방·마감 근처) 실행 → T-6h 스냅샷 확보.
- 무료 쿼터 안에서(STEP 0 한도 확인 후 주기 확정). **독립 스크립트 — 서버 재시작 불필요**(guarded-deploy 대상 아님).

## 5. 합격기준 (숫자)
- STEP 0 실제 스키마·무료 한도 보고됨.
- `fb_odds_snapshots`에 스냅샷 적재: `SELECT count(*), count(DISTINCT sgo_event_id), min(collected_at), max(collected_at)`.
- 같은 경기에 **시간차 스냅샷 ≥2** 쌓이는지(며칠 후 확인 — T-6h 변동율 원천).
- fb_games 조인율: 매칭 __ / 미매칭 __ (미매칭은 팀명 매핑 보완).
- 키가 코드·로그·저장소에 없음(grep 확인).

## 6. 안 하는 것
- 키 하드코딩·로그출력·저장소 커밋. 야구 픽 테이블 쓰기. 무료 쿼터 초과 폴링.

## 보고 양식
```
[STEP0] 이벤트id필드 __ / 팀필드 __ / 시각필드 __ / moneyline위치 __ / 무료한도 __
[테이블] fb_odds_snapshots 생성 승인id __ → 생성: 예
[수집기] ops/collect-odds-sgo.py / 폴링 __회/일
[적재] 스냅샷 __행 / 이벤트 __ / 기간 __
[조인] 매칭 __ / 미매칭 __ (팀명매핑 필요: ______)
[키안전] grep로 키 노출 0: 예
[막힘] ______
```

`trace_id`: `sgo-odds-collector-20260818`
