# 딥리서치 리포트 — MLB 승리확률 공식 (#56 준비)

작성: 센터장(Opus 4.8) · 2026-08-18 · 방법: 병렬 리서치 에이전트 3 + 종합
목적: 우리 데이터(2021-2025 결과 + 마감 moneyline)로 백테스트할 해석 가능한 공식 후보 발굴.
기준선: vig 제거한 마감배당 내재확률(devig close).

---

## 🎯 요약 (가장 중요한 결론)

**마감선(closing line)은 매우 잘 보정된 예측자다. 박스스코어(결과) 파생 신호만으로 이를 체계적으로 이긴 peer-reviewed 사례는 없다.** 우리 데이터에는 **선발투수 정보가 없어**(승패의 단일 최대 요인) 구조적 한계가 명확하다. → **"기준선을 못 이긴다"가 정직한 예상 결과**이고, #56의 가치는 *승자 발굴*이 아니라 **시장이 이 신호들을 얼마나 완벽히 가격하는지 엄밀히 정량화**하는 데 있다. (advisor·#55의 "억지 승자 금지"와 부합.)

---

## 1. 공식별 요약

### Log5 (Bill James) — 두 팀 승률 → 단일경기 승률
- 수식: `P(A) = (A − A·B) / (A + B − 2·A·B)` (A,B = 두 팀 승률)
- 홈어드밴티지 오즈비 변형: `P = 1 / (1 + B(1−A)(1−H) / (A·H(1−B)))`, H≈.54(중립 홈승률)
- Bradley-Terry·Elo와 수학적 동치. 실무 표준은 **피타고리안 W%를 A,B에 입력**(승률 노이즈↓).
- 우리 적합: ✅ 롤링 승률로 구현 가능. 한계: 시즌 초반 소표본 노이즈.

### 피타고리안 기대승률 — 득실 → 팀 강도
- 수식: `W% = RS^x / (RS^x + RA^x)`, x=1.83(고정 최적) 또는 Pythagenpat `x=((RS+RA)/G)^0.287`(동적)
- "시즌 기대승률"이라 단일경기엔 **Log5의 입력**으로 사용(2단계 파이프라인).
- 우리 적합: ✅ 롤링 RS/RA/G로 구현. 한계: 소표본.

### Elo (FiveThirtyEight식) — 순차 갱신 레이팅
- 수식: `P(home) = 1 / (1 + 10^(−(R_home − R_away + HFA)/400))`, HFA≈24점, 시즌 1/3 regression
- 정확도 ~57-58% (538 자체보고). **선발투수 조정이 +1%p** — 우리는 이걸 못 씀.
- 우리 적합: ⚠️ 결과로 자체 구현 가능하나 **투수 없는 버전은 538 완전판 대비 구조적 열등**.

### devig 마감선 — 기준선(baseline)
- `p_home = (1/dec_home) / (1/dec_home + 1/dec_away)` (양측 정규화 = vig 제거)
- devig 방법 4종(multiplicative/additive/power/**Shin**). Shin이 FLB 보정에 유리(정량비교는 미확보).
- **매우 잘 보정됨**. Pinnacle 마감선 실증(87,960쌍): 기대수익-실제수익 회귀 기울기 ≈1.00.

---

## 2. 시장 효율성 (핵심 발견)

- Woodland&Woodland(1994, J.Finance), Bouchard(Harvard), "Swing and a Miss"(Harvard) 일관:
  **마감선이 특히 2000년대 이후 매우 잘 보정**, 오픈라인의 favorite-longshot bias도 **마감시점엔 대부분 소멸.**
- 유일하게 확인된 학술적 비효율(Simon, Mgmt Science 2024, 3,681경기)은 **오픈→마감 사이 라인의 과잉반응(음의 자기상관)** — **마감선 자체가 아니라 라인 이동 타이밍**의 문제. 우리는 마감선만 있어 **이 비효율은 접근 불가.**
- "마감선을 박스스코어 신호로 이겼다"는 신뢰할 학술 사례 **없음**. (유일한 주장은 저자가 리키지 인정한 개인 블로그.)

## 3. 저평가 신호 (우리가 파생 가능한 것 중심)

| 신호 | 마감선 반영 | 추가 예측력 기대 | 우리 가용 |
|---|---|---|---|
| 홈 어드밴티지 (최근 ~52-53%) | 완전 반영 | ~0 | ✅ |
| 롤링 폼(승률·득실차) | 대부분 반영 | 낮음(이론·실증 "이미 반영") | ✅ |
| **선발투수** (최대 요인, ~12%p) | 매우 빠르게 반영 | — | ❌ **없음(최대 한계)** |

## 4. 우리 데이터 적합성 매트릭스

| 공식 | 구현 가능(결과+마감선) | 기준선 초과 기대 |
|---|---|---|
| devig 마감선(기준선) | ✅ | — (기준) |
| Log5 (롤링 승률) | ✅ | 낮음 |
| 피타고리안→Log5 | ✅ | 낮음 |
| Elo (결과 기반) | ✅ | 낮음(투수 없음) |
| 앙상블(devig + 위 신호 잔차) | ✅ | **가장 현실적**(marginal) |

---

## 5. 🎯 #56 추천 — 실험할 공식 목록 (우선순위)

**전부 해석 가능하고 우리 데이터로 구현 가능. 목표는 "기준선 대비 log-loss/Brier"를 정직히 측정(시도 N 집계).**

1. **기준선 고정** (#55에서 이미): devig 마감선. 모든 비교의 기준.
2. **오프셋 잔차 검정 (최우선, 비용 최저)**: `logit(p) = logit(devig_prob) + w1·(홈롤링승률−원정롤링승률) + w2·피타고리안차 + b`.
   → **devig를 오프셋으로 고정**하고 롤링 신호의 계수 w가 유의한지 검정. 시장이 완전 반영했으면 w≈0. **"잔여 신호가 있나"에 직접 답.**
3. **Log5 (피타고리안 W% 입력) + 홈어드밴티지**: 독립 공식으로 기준선과 비교.
4. **Elo (결과 기반, HFA≈24, 1/3 regression)**: 독립 공식으로 비교.
5. **앙상블**: devig + Elo(또는 Log5)의 로짓 가중결합. marginal edge가 있다면 여기.

**정직한 사전 등록(pre-registration):** 문헌상 2~5가 기준선을 이길 가망은 낮다. **못 이기면 그게 결과이고, 시장 효율성 + 우리 데이터 한계(선발투수 부재)의 정량적 증명으로 보고**한다. 홀드아웃(2025) 1회 채점, 시도 N 집계.

**진짜 개선 여지:** 선발투수 데이터 확보(무료 소스 리서치 대상 — 별건). 이게 단일 최대 레버.

---

## 출처 (품질 A=동료검토, B=업계/데이터저널, D=개인블로그)
- Log5/피타고리안: [SABR 저널](https://sabr.org/journal/article/matchup-probabilities-in-major-league-baseball/)(A), [Pythagorean expectation-Wikipedia](https://en.wikipedia.org/wiki/Pythagorean_expectation)(B), [arXiv math/0509698](https://arxiv.org/pdf/math/0509698)(A), [Tangotiger Log5](https://tangotiger.net/wiki_archive/Log5.html)(B)
- Elo/시장효율: [Woodland&Woodland 1994, J.Finance](https://onlinelibrary.wiley.com/doi/10.1111/j.1540-6261.1994.tb04429.x)(A), [Bouchard-Harvard](https://dash.harvard.edu/bitstreams/24950429-b1b7-4372-a029-1b68de1872e3/download)(A), [Simon, Mgmt Science 2024](https://pubsonline.informs.org/doi/10.1287/mnsc.2022.00456)(A), [Birdland Metrics Elo](https://birdlandmetrics.com/articles/projection-model)(B)
- 신호: [Gandar/Zuber/Lamb 2001](https://www.sciencedirect.com/science/article/abs/pii/S0148619501000406)(A), [Green&Zwiebel 2017 Hot-Hand](https://pubsonline.informs.org/doi/10.1287/mnsc.2017.2804)(A), [Baris&Losak, IJSF](https://journals.sagepub.com/doi/10.1177/15586235251403232)(A), [Pinnacle 마감선 효율](https://www.football-data.co.uk/blog/pinnacle_efficiency.php)(B), [Cameron-FanGraphs 투수](https://blogs.fangraphs.com/pitcher-win-values-explained-part-three/)(B)

> 한계: FiveThirtyEight 사이트 폐쇄로 538 Elo 수치는 검색 캐시 재구성. 일부 원문 403 차단으로 스니펫 의존.
