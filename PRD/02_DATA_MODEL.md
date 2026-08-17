# 02 · 데이터 모델 (#45 실측 반영)

> 🔴 야구 픽 프로젝트의 `games`·`odds_snapshots`는 **비어 있고(0행)** 우리 것이 아니다 → **건드리지 않는다.** 우리는 **별도 `fb_*` 테이블**을 신설해 직접 채운다(사용자 확정, schema.change 승인).

---

## 1. 우리 테이블 (신설, `fb_` 네임스페이스)

### `fb_games` — MLB 일정+결과 (라벨)
```
game_pk bigint PK        -- MLB Stats API gamePk (native id → 조인키)
game_date date · start_time timestamptz
home_team text · away_team text
home_score int · away_score int · status text   -- 결과(라벨). 종료 후 채움
```
소스: **MLB Stats API**(`statsapi.mlb.com`, 무료·키 불필요) `schedule`+`boxscore`.

### `fb_odds_snapshots` — 배당 시계열 (특징 원천)
```
id bigserial PK · game_pk bigint FK→fb_games
provider text · bookmaker text · market text · side text
line numeric · price numeric · collected_at timestamptz    -- 스냅샷 시각
idx: (game_pk, collected_at)
```
소스: **전진 수집**(배당 API를 주기적으로 폴링) + (검토) 과거분 구매.
🔴 **T-6h 특징을 만들려면 경기당 여러 시점 스냅샷 필수** — 이게 수집 설계의 핵심.

---

## 2. 라벨(정답) 소스 — 확정

**MLB Stats API `boxscore`의 최종 스코어** → `fb_games.home_score/away_score`.
- moneyline 라벨 y = (home_score > away_score).
- 무료·전체 히스토리·키 불필요 → **결과는 쉬운 절반.**

## 3. 파생 특징 (T-6h 컷오프, 경기 전 정보만)

| 특징 | 정의 |
|---|---|
| `devig_T6h` | **T-6h as-of** 배당의 vig 제거 내재확률 |
| `odds_move_rate` | 개장→T-6h 배당변동율 (사용자 지정 핵심 지표) |
| `book_disagreement` | T-6h 시점 bookmaker 간 price 분산 |

🔴 **as-of 쿼리**: T-6h 특징 = `start_time - interval '6 hours'` **이전의 마지막 스냅샷**. (기준선 `latest_odds`는 마감선이라 다르다.)
```sql
-- 개념: 각 game의 T-6h 직전 마지막 스냅샷
SELECT DISTINCT ON (game_pk, market, side) *
FROM fb_odds_snapshots s JOIN fb_games g USING (game_pk)
WHERE s.collected_at <= g.start_time - interval '6 hours'
ORDER BY game_pk, market, side, s.collected_at DESC;
```

## 4. 시간 축
```
개장선 ── (전진수집 스냅샷들) ── T-6h컷 │ 경기시작 │ 마감선(기준선) │ 결과(라벨)
└──── 특징은 T-6h까지만 ─────────┘                                └ 채점
```
학습/검증/홀드아웃 = `game_date` **시간순**. 홀드아웃 최근 구간, 1회.
