# PRD — 스포츠 예측 공식 역추적 파이프라인 (`formula-backtracer`)

과거 경기 결과·배당을 역추적해 **vig 제거한 마감배당보다 잘 맞히는 해석 가능한 공식**을 찾는다.

## 문서

| 파일 | 내용 |
|---|---|
| [01_PRD.md](01_PRD.md) | 문제·성공기준(기준선)·범위·산출물·실행자·리스크 |
| [02_DATA_MODEL.md](02_DATA_MODEL.md) | 실측 스키마·라벨 소스([NEEDS CLARIFICATION])·파생 특징·시간축 |
| [03_PHASES.md](03_PHASES.md) | Phase 0(라벨 확정)~3(홀드아웃 평가), 완료조건·게이트 |
| [04_PROJECT_SPEC.md](04_PROJECT_SPEC.md) | AI 행동 규칙 — 절대 하지 마 / 반드시 |

## 핵심 3줄

1. **기준선 = devig 마감배당.** 이걸 못 이기면 아무것도 못 찾은 것.
2. **과적합 방지가 코어**: 시간순 분할 · 홀드아웃 1회 · 시도 N 보고 · log-loss/Brier.
3. **Kimi는 계산 못 함** — 수치는 할매봇/로컬 Claude, Kimi는 리뷰·엣지케이스.

## 🔴 시작 게이트 (Phase 0)

라벨(경기 결과) 소스가 스키마에 안 보인다. **아래 실측이 먼저**:
```
! psql -h /opt/data/pgdata -U hermes -d odds -c "SELECT league,count(*),min(game_date),max(game_date) FROM games GROUP BY league ORDER BY 2 DESC;"
! psql -h /opt/data/pgdata -U hermes -d odds -c "SELECT market,side,count(*) FROM odds_snapshots GROUP BY market,side ORDER BY 3 DESC LIMIT 30;"
! psql -h /opt/data/pgdata -U hermes -d odds -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1;"
! psql -h /opt/data/pgdata -U hermes -d odds -c "\d games"
```

## 완성도

7/10 — 프레이밍·과적합 프로토콜·거버넌스는 확정. **라벨 소스(Phase 0)와 축구 데이터 존재가 미확정**이라 평가 절의 구체 컬럼이 비어 있음. Phase 0 실측 후 8~9/10.
