---
name: formula-backtracer
description: 과거 스포츠(야구·축구) 경기결과·배당을 역추적해 "vig 제거한 마감배당"보다 잘 맞히는 해석 가능한 공식을 찾는 탐색·평가 파이프라인. 실행자(할매봇 psql+python / 로컬 Claude 서브에이전트 / Kimi 리뷰)를 오케스트레이션한다. 한국어 트리거 "/formula-backtracer", "예측 공식 찾아줘", "배당 역추적", "백테스트 돌려줘", "공식 탐색". English "formula backtracer", "find predictive formula", "backtest odds".
---

# Formula Backtracer — 예측 공식 역추적 파이프라인

> 스펙 원본: 이 저장소의 `PRD/` (01~04). 이 스킬은 그 방법론의 **실행 절차**다.
> 범위: **탐색 + 백테스트 + 기준선 대비 평가 + 리포트** 코어. 데이터 수집·라벨 적재는 범위 밖.

## 불변 규칙 (매 실행 준수 — `PRD/04_PROJECT_SPEC.md`)

1. **기준선 = vig 제거한 마감배당.** 못 이기면 아무것도 못 찾은 것. 항상 나란히 보고.
2. **시간순 분할.** 랜덤 금지(미래 누수). 홀드아웃은 **봉인, 딱 한 번** 채점.
3. **시도한 공식 개수 N 집계·보고.** N 없는 best는 무효.
4. **Kimi는 계산 금지.** 수치=할매봇/로컬 Claude. Kimi=리뷰·엣지케이스·요약.
5. **games·odds_snapshots 읽기 전용**(타 프로젝트 소유). DB 전체 덤프 금지.
6. 평가지표 = **log-loss(주)·Brier(보조)**.

---

## 실행 단계

### STEP 0 — Phase 0 게이트: 라벨 소스 확인 (BLOCKING)

라벨(경기 결과)이 스키마에 안 보인다. **먼저 확인하지 않으면 나머지를 실행하지 마라.**

읽기 전용 psql(사용자 `!` 실행 또는 할매봇):
```sql
SELECT league,count(*),min(game_date),max(game_date) FROM games GROUP BY league ORDER BY 2 DESC;
SELECT market,side,count(*) FROM odds_snapshots GROUP BY market,side ORDER BY 3 DESC LIMIT 30;
SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1;
\d games
```
- 라벨 소스 확정: (a) games 결과 컬럼 / (b) odds의 result·settled market / (c) 별도 테이블·DB.
- 리그·경기수·기간, market/side 확정.
- **라벨을 못 찾으면 여기서 멈추고 사용자에게 보고.** 지어내지 마라. (`references/method.md` §라벨)

### STEP 1 — 기준선 + 백테스트 하네스 (수치: 할매봇/로컬 Claude)

- `latest_odds`에서 devig 마감확률 계산(양측 정규화). → 기준선.
- log-loss·Brier 평가 함수.
- game_date **시간순** 분할: 학습 / 검증 / **홀드아웃(봉인)**.
- 특징 추출: 경기 전 정보만 (`references/method.md` §특징).
- **검증**: 일부러 미래 누수를 심어 점수가 비현실적으로 좋아지는지 → 잡히면 하네스 OK.
- **Kimi 리뷰**: 하네스 실패경로(NaN·0분모·정규화 오류) — `references/executors.md` 프롬프트.

### STEP 2 — 공식 탐색 (해석 가능, 수치: 로컬 Claude/할매봇)

- 후보 = 특징의 **해석 가능한 가중 결합**(로지스틱 링크). 블랙박스 금지.
- 학습셋 적합 → 검증셋 평가. **홀드아웃 절대 안 봄.**
- **시도한 후보 N을 세서 기록.**

### STEP 3 — 홀드아웃 1회 + 리포트 (센터장 판단)

- Phase 2의 **단 하나** 공식을 홀드아웃에 **한 번** 채점.
- 리포트: 공식·계수·**N**·각 구간 log-loss·Brier·**기준선 대비**·정직한 결론.
- 🔒 홀드아웃 재열람 금지.

---

## 오케스트레이션

- **수치 작업**은 할매봇(지시서 handoff + `agent.send_message`) 또는 로컬 Claude 서브에이전트(Agent 도구, 파일 비중첩)로. `references/executors.md`.
- **Kimi**는 `/api/llm/worker`로 코드 첨부 리뷰만.
- 병렬 시 **파일 비중첩**, claim 규칙 준수(이 저장소 poll-queue의 spawn-전-claim).

## 보고 양식
`PRD/04_PROJECT_SPEC.md`의 보고 양식을 그대로 쓴다 (경기수·기간·기준선/공식 log-loss·N·홀드아웃·결론).

## 참고
- `references/method.md` — devig·log-loss/Brier·시간분할·특징·과적합 방지 상세
- `references/executors.md` — 할매봇/로컬 Claude/Kimi 배분 + Kimi 프롬프트 골격
