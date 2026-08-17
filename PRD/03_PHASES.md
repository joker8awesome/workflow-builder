# 03 · Phase 분리

> 각 Phase 완료 기준은 **숫자**다. "완료"는 판정이 아니다. 실행자·승인 게이트 명시.

---

## Phase 0 — 라벨 소스 확정 + 데이터 실측 🔴 BLOCKING

이게 통과 못 하면 나머지 전부 무의미(채점할 정답이 없다).

**작업 (읽기 전용 psql, 사용자 또는 할매봇):**
```sql
SELECT league, count(*), min(game_date), max(game_date) FROM games GROUP BY league ORDER BY 2 DESC;
SELECT market, side, count(*) FROM odds_snapshots GROUP BY market, side ORDER BY 3 DESC LIMIT 30;
SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1;
\d games   -- 결과 컬럼 존재 여부
```

**완료 조건 (숫자):**
- 라벨 소스 확정: (a)/(b)/(c) 중 하나 + 정확한 컬럼/쿼리
- 리그·경기 수·기간 확정 (야구 몇 경기, 축구 존재 여부)
- market/side 목록 확정 (어떤 배당이 있나)

---

## Phase 1 — 기준선 + 백테스트 하네스

**작업 (할매봇 / 로컬 Claude):**
- `devig close` 기준선 구현 (양측 정규화)
- log-loss·Brier 평가 함수
- **시간순** 학습/검증/홀드아웃 분할 (game_date 기준), 홀드아웃 **봉인**
- 특징 추출 (§`02` §3, 경기 전 정보만)

**완료 조건:**
- 기준선 log-loss 재현 (검증셋)
- **하네스가 일부러 심은 미래 누수를 잡는다** — 마감 후 정보를 특징에 넣었을 때 점수가 비현실적으로 좋아지면 경보. (phase2-plan의 "진짜로 잡는지" 원칙)
- Kimi 리뷰: 하네스 실패경로 (조용한 NaN·정규화 0분모 등)

---

## Phase 2 — 공식 탐색 (해석 가능)

**작업 (로컬 Claude / 할매봇):**
- 후보 공간 정의: §`02` 특징들의 **해석 가능한 가중 결합**(로지스틱 링크). 블랙박스 금지.
- 학습셋 적합 → 검증셋 평가. 홀드아웃은 **건드리지 않는다.**
- **시도한 후보 공식 개수 N을 집계·기록.**

**완료 조건:**
- 검증셋에서 기준선 대비 log-loss 개선(양수든 음수든 정직히)
- **N 보고** (N 없는 best 결과는 무효)
- 공식이 사람이 읽을 수 있는 형태

---

## Phase 3 — 홀드아웃 1회 평가 + 리포트

**작업 (센터장 판단 + 할매봇):**
- Phase 2에서 고른 **단 하나의** 공식을 홀드아웃에 **딱 한 번** 채점.
- 리포트 생성 (`01_PRD` §4 항목 전부).

**완료 조건:**
- 홀드아웃 log-loss·Brier vs 기준선
- 공식·계수·N·결론
- 🔒 홀드아웃 재열람 금지 (봉인 1회 원칙)

---

## 승인 게이트

| 작업 | 게이트 |
|---|---|
| 읽기 전용 조회·백테스트·탐색 | 자동 통과 |
| games/odds_snapshots 쓰기 | ❌ 금지(범위 밖) |
| 새 테이블 생성(결과 캐시 등) | 🔒 승인 (schema.change) |
| 결과 리포트 사용자 발송 | 자동(보고) |
