# 라벨 소스 리서치 리포트 (경기 결과 = 예측의 정답)

작성: 센터장(Opus 4.8) · 2026-08-18 · WebSearch 기반

## 결론 (한 줄)
라벨 경로는 **리그 + `provider` + `game_id` 형식** 세 가지가 결정하고, 그건 **psql 1회로 확정**된다. 아래는 그 위에 얹을 준비된 경로다.

---

## 0. 먼저 — 이미 DB에 있을 수 있다 (가장 쌈)
외부로 나가기 전에 확인: 최신 `games`에 스코어 컬럼이 생겼거나, `odds_snapshots.market`에 결과성(예: `settled`/`result`) 마켓이 있을 수 있다. 있으면 외부 소스 불필요.
```sql
\d games
SELECT market, side, count(*) FROM odds_snapshots GROUP BY 1,2 ORDER BY 3 DESC;
```

## 1. game_id/provider가 경로를 정한다
`odds_snapshots.provider` + `games.game_id` 형식을 보면 어느 외부 소스와 id가 맞는지 안다.
```sql
SELECT DISTINCT provider FROM odds_snapshots;
SELECT DISTINCT league FROM games;
SELECT game_id, league, home_team, away_team FROM games LIMIT 5;
```
- `provider`가 **The Odds API**면 → 그쪽 `/scores`로 결과를 같은 id로 받는다.
  단 `/scores`는 **최근 3일 경기만** 점수 제공 → 과거 백테스트엔 부족(과거 결과는 별도 소스 필요).

## 2. 리그별 외부 소스

### MLB인 경우 → MLB Stats API (권장, 최선)
- `statsapi.mlb.com` — **무료·API 키 불필요·공식**, 전체 히스토리, 박스스코어/최종스코어.
- `schedule`(날짜·팀 범위) + `boxscore` 엔드포인트. 파이썬 래퍼 `MLB-StatsAPI`(PyPI).
- 조인: MLB `gamePk` 또는 (날짜 + 홈/원정팀).

### KBO인 경우 → 공식 무료 API 없음, 비공식/스크레이퍼
- 비공식 API `seeeturtle/kbo`(GitHub), 크롤러 `colabear754/kbo-scraper`, 데이터셋 `choosunsick/KBO_data`, 공식 앱 KBO STATS.
- ⚠️ **법적·robots 주의**: 크롤링 데이터 권리는 KBO, 상업적 사용 금지 명시. 일정 페이지는 허용, 서버 부하 주의.
- 조인: (날짜 + 팀명) — **팀명 표기 정규화 필요**(예: "두산" vs "Doosan").

## 3. 조인 키 문제
외부 결과를 `games.game_id`에 붙이는 법:
- (a) provider 네이티브 id가 game_id와 같으면 **직결**.
- (b) 아니면 `(game_date, home_team, away_team)` 매칭 — **팀명 표기 통일** 선결.

## 4. 🔴 정직 — 누가 이 리서치·수집을 실행하나 (워크플로우 #4 관련)
- **deepseek/kimi(`/api/llm/worker`)는 텍스트 전용** → 웹·DB를 **못 본다** → "리서치·수집"을 **직접 못 한다**.
- 실제 페치(외부 API 호출·DB 조회)는 **할매봇 / 로컬 Claude / 센터장**만 가능.
- 딥시크 역할을 살리는 법: 할매봇/센터장이 **가져온 자료**를 deepseek로 **분석**시킨다 —
  `deepseek-v4-pro`(무거운 종합) · `deepseek-v4-flash`(대량 분류)로 배분. 단:
  - pro/flash 2모델 라우팅은 현재 **단일모델**(`WF_LLM_WORKER_MODEL`) 구조라 **신설 필요**.
  - **`deepseek-v4-pro`가 Nous 카탈로그에 있는지 미확인** — 실호출로 확인해야(#25 404 교훈).

## 5. 다음 (psql 1회로 0~3 전부 확정)
```sql
\d games
SELECT DISTINCT league FROM games;
SELECT DISTINCT provider FROM odds_snapshots;
SELECT game_id, home_team, away_team FROM games LIMIT 5;
SELECT market, side, count(*) FROM odds_snapshots GROUP BY 1,2 ORDER BY 3 DESC LIMIT 30;
```
이 결과가 나오면: 라벨이 이미 있나 / 리그가 뭔가 / 어느 외부 소스 / 조인 키가 확정된다.

## 출처
- MLB Stats API: https://statsapi.mlb.com/ · 래퍼 https://github.com/toddrob99/MLB-StatsAPI
- KBO 비공식: https://github.com/seeeturtle/kbo · https://github.com/colabear754/kbo-scraper · https://github.com/choosunsick/KBO_data
- The Odds API /scores: https://the-odds-api.com/liveapi/guides/v4/ · https://the-odds-api.com/historical-odds-data/
