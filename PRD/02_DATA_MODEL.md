# 02 · 데이터 모델

> 실측 기준: `ops/schema.sql`(8/15 pg_dump) + Phase 0 재확인. **games·odds_snapshots는 야구 픽 프로젝트 소유 — 읽기 전용.**

---

## 1. 확인된 테이블 (읽기 전용)

### `games` — 경기 일정 (fixtures)
```
game_id text PK · league text · game_date date · start_time timestamptz
home_team text · away_team text · created_at timestamptz
```
🔴 **결과/스코어 컬럼 없음** (8/15 스냅샷). → 라벨은 여기 없거나, 스키마가 드리프트됐거나, 다른 곳에 있다. **Phase 0에서 확정.**

### `odds_snapshots` — 시간별 배당 스냅샷 (특징의 원천)
```
id bigint PK · game_id text FK→games · provider text · bookmaker text
market text · side text · line numeric(6,2) · price numeric(8,3) · collected_at timestamptz
idx: (game_id, collected_at), (market, side)
```

### `latest_odds` — 뷰 (= 마감선 = 기준선의 원천)
```sql
SELECT DISTINCT ON (game_id, market, side) game_id, market, side, line, price, collected_at
FROM odds_snapshots ORDER BY game_id, market, side, collected_at DESC;
```
각 (game_id, market, side)의 **마지막** 스냅샷 = 마감배당. **기준선(devig close)은 여기서 나온다.**

---

## 2. 🔴 [NEEDS CLARIFICATION] 라벨(정답) 소스 — Phase 0

예측의 정답 = **경기 실제 결과**(승/패, 스코어, 총득점 등). 후보:

| 후보 | 확인 방법 (Phase 0) |
|---|---|
| (a) 최신 `games`에 결과 컬럼 추가됨 | `\d games` / `SELECT * FROM games LIMIT 5` |
| (b) `odds_snapshots`에 `result`/`settled` market이 있음 | `SELECT market, side, count(*) FROM odds_snapshots GROUP BY 1,2` |
| (c) 별도 결과 테이블/DB | `information_schema.tables` / `psql -l` |

**라벨 소스가 확정되기 전엔 특징·분할·평가를 코딩하지 않는다.**

---

## 3. 파생 특징 (odds_snapshots에서 계산 — 읽기 전용 산출)

해석 가능한 항만 사용한다(공식이 읽혀야 하므로):

| 특징 | 정의 | 왜 |
|---|---|---|
| `devig_prob` | 마감 `1/price`를 양측 합=1로 정규화 | 기준선 자체이자 강력한 예측 |
| `line_move` | 마감선 − 개장선 (`collected_at` 최소→최대) | 시장이 어느 쪽으로 움직였나 |
| `book_disagreement` | 같은 market의 bookmaker 간 price 분산 | 불확실성 신호 |
| `open_close_spread` | 개장/마감 내재확률 차 | 정보 유입 |
| (도메인) 팀 최근폼·홈/원정 | 라벨 소스 확정 후 파생 | 야구/축구 특화 |

> 특징은 **경기 시작 전 시점 정보만** 쓴다. 마감 이후·경기 중 데이터를 특징에 넣으면 미래 누수.

---

## 4. 시간 축 (누수 방지의 핵심)

```
개장선 ────────── 마감선(latest_odds) │ 경기 시작 │ 결과(라벨)
└──── 특징은 여기까지만 ────────────┘           └ 여기는 채점에만
```

- 학습/검증/홀드아웃 분할은 **game_date 시간순**. 랜덤 금지.
- 홀드아웃 = 가장 최근 구간, **딱 한 번** 채점.
