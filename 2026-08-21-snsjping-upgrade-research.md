# SNS자판기 (Content QA v6) 고도화 리서치 리포트

작성: 센터장(Opus 4.8) · 2026-08-21 · advisor 압력검증 반영
대상: `D:\naver\SNS자판기_소스` (app_version 6.0.5-branding, rule_version 2026-08-19)
스코프(사용자 확정): ① 룰셋 최신화 ② AI 엔진 고도화 ③ 신규 기능/제품범위 ④ 경쟁사 벤치마크 / 플랫폼 우선순위 = **Instagram·Threads·X 중심**(네이버는 요약)

> **근거 등급 규약**(앱 자체 taxonomy를 그대로 따름):
> `CONFIRMED-CODE` = 이 저장소 `file:line`으로 재현되는 사실 · `OFFICIAL` = 플랫폼 공식 정책/도움말(URL+확인일) · `HEURISTIC` = 제3자 해설/업계 분석 · `미확인` = 확인 실패(날조 금지).
> 웹 근거는 §3~§4 표에 URL·확인일 명기. 앵커 없는 주장은 배제한다.

---

## 요약 (Executive Summary)

이 앱의 판정 정확도는 전적으로 `rules.json`(규칙 6개)과 `engine.py`의 축(axis) 합산에 달려 있는데, **코드만으로 이미 드러나는 구조적 결함이 웹 리서치가 필요한 어떤 항목보다 우선**한다. 특히 **죽은 축(dead axis)으로 인한 false-PASS 압력**, **비어 있는 EMPIRICAL 학습 루프**, **스키마만 있고 동작하지 않는 Policy Diff**가 3대 우선 항목이다. 플랫폼 정책 최신화(§3)와 AI 엔진 구조화 출력(§4)은 그다음이다.

**우선순위(높은 것부터):**
1. `account_pattern` 죽은 축 제거/구현 — false-PASS 유발 (§2-A)
2. IG/Threads/X 전용 정책 규칙 신설 — 현재 0개 (§3)
3. EMPIRICAL 피드백 루프 배선 — `rule_stats`/`enforcement_events` → 규칙 가중치 (§2-B)
4. AI 재작성 구조화 출력(JSON schema) 전환 — 파싱 신뢰성 (§4-A)
5. Policy Snapshot/Diff 실제 구현 — 룰 신선도 (§2-C)

---

## §1. 현재 아키텍처 (검증된 사실)

| 서브시스템 | 파일 | 역할 |
|---|---|---|
| 룰 엔진 | `core/engine.py` | 문장별 정규식 매칭 → 축 점수 합산 → 가중합 `total` → PASS/REVIEW/BLOCK |
| 규칙셋 | `rules.json` | 규칙 6개(1개 SHADOW) + cta_markers + negation_patterns + sources |
| AI 재작성 | `core/rewrite.py` | OpenAI Responses API 4종 변형 + Fact Guard, 키 없으면 로컬 정규식 치환 |
| 미디어 | `core/media.py` | PIL 블러/엔트로피, opencv 프레임 샘플, pHash, AI 비주얼 리뷰 |
| 저장/이력 | `core/database.py` | SQLite 18개 테이블(scans·evidence·enforcement·rule_stats·policy_snapshots…) |
| 텔레메트리 | `core/telemetry.py` | 익명·비블로킹 jsonl 큐 → `SNS_TELEMETRY_URL` |

**판정 로직**(`engine.py:130`): `BLOCK = critical or (total≥55 and confidence≥70)` · `REVIEW = total≥25` · 그 외 `PASS`.
**total 산식**(`engine.py:126`): `Σ score[axis] × weight[axis]` (플랫폼 axes에 대해서만).

---

## §2. 룰셋·엔진 구조 공백 (CONFIRMED-CODE — 최우선, 웹 리서치 불필요)

### 2-A. ★ `account_pattern` 죽은 축 → false-PASS 압력 **[최우선]**
- `engine.py:80` 모든 축을 0으로 초기화. `naver_blog`는 `account_pattern`(weight **0.10**)을 축으로 선언(`rules.json:11`)하지만, **어떤 규칙도, 엔진의 어떤 코드도 `account_pattern`에 점수를 쓰지 않는다.**
- 결과: naver_blog `total`의 10%가 **영구히 0**. 가중치 합이 1.0이므로, 죽은 축은 total을 구조적으로 끌어내려 **PASS 쪽으로 편향**시킨다(위험한 글도 total이 낮게 나옴).
- 유사하게 `performance` 축은 `account_perf.relative<1`일 때만 채워짐(`engine.py:122`) — 성과 데이터가 INSUFFICIENT면 0으로 희석.
- **조치:** (a) `account_pattern`을 실제로 채우는 규칙/로직(예: 과도한 외부링크·해시태그 밀도·게시빈도)을 넣거나, (b) 축을 제거하고 나머지 가중치를 재정규화. 지금은 "선언했으나 죽은" 상태가 최악.

### 2-B. EMPIRICAL 학습 루프가 배선되지 않음 **[신규 기능 1순위]**
- UI는 OFFICIAL/HEURISTIC/**EMPIRICAL**을 분리(`app.py:152`)하지만 `rules.json`에 `source:"EMPIRICAL"` 규칙이 **0개**.
- `database.py:43` `rule_stats`(matches/correct/false_positive/hold) 테이블 존재하나 **아무 코드도 쓰지 않음.** 관리 탭의 오탐 피드백은 `evidence.user_feedback`에만 저장(`app.py:575`)되고 `rule_stats`로 집계되지 않음.
- `enforcement_events`(실제 삭제·경고 기록)와 규칙 가중치 사이 **연결 없음**. 즉 "실측으로 규칙을 교정"하는 폐루프가 존재하지 않는다.
- **조치:** `evidence.user_feedback` + `enforcement_events` → `rule_stats` 집계 → 규칙별 정밀도/오탐률 대시보드 → (반자동) 가중치·status 조정. 웹 리서치 0으로 만들 수 있는 최고 가치의 신규 기능.

### 2-C. Policy Snapshot/Diff는 스키마만 존재 (신선도 허구)
- `database.py:49-54` `policy_snapshots`·`policy_diffs` 테이블 존재하나 **쓰는 코드 없음.** 관리>Policy 탭은 `sources` URL 6개를 `st.json`으로 보여줄 뿐(`app.py:589-590`).
- `rules.json:204-219` sources는 확인일(retrieval date) 없음 → 룰 신선도가 검증 불가.
- **조치:** sources URL 주기 페치 → 해시 저장(`policy_snapshots`) → 변경 감지(`policy_diffs`) → "정책 변경 감지" 알림. §3의 최신화를 지속가능하게 만드는 인프라.

### 2-D. 규칙 커버리지가 좁고 한쪽으로 치우침
- 규칙 6개 전부 한국어 **스포츠 베팅/과장** 도메인 정규식(`사설토토`·`확정픽`·`맞팔`·`도박`). `rewrite.py:31`의 네이버 native 문구도 "종목이나 리그" — 원 도메인이 스포츠 픽임을 드러냄.
- **플랫폼 전용 규칙 0개**: IG에서만/X에서만 발동하는 규칙이 없다. 플랫폼 차별화가 전부 `weights`에만 있음 → 4-플랫폼 도구로서 최대 약점.
- `negation_patterns` 2개뿐(`rules.json:200`) → 공격적 정규식 6개 대비 오탐 제어가 얇음.
- **조치:** §3 웹 근거로 플랫폼별 OFFICIAL 규칙을 신설(영어/한국어 패턴 병행), negation·SHADOW로 오탐 완충.

### 2-E. 기타 코드 관측
- `duplicate` 축은 `+=`가 아니라 `=`로 덮어씀(`engine.py:110`) — 의도된 동작(유사도 버킷). 문제 아님, 문서화만.
- 프롬프트 인젝션 방어는 `rewrite.py:60-61`·`media.py:126`에 존재(구분자+무시 지시) — 양호.
- 미디어 검수는 순수 기술지표(블러·해상도·pHash)만; 정책성 시각검사는 AI 리뷰에 의존(키 필요).

---

## §3. 플랫폼 정책·알고리즘 최신화 (OFFICIAL/HEURISTIC — 웹 리서치)

> 아래 표는 백그라운드 리서치 완료 후 채운다. 각 행은 URL·확인일·제안 rule_id/axis 매핑을 포함한다.

### 3-A. Instagram (recommendation·spam_behavior·policy)

1차 근거: transparency.meta.com·creators/about.instagram.com(WebFetch) + help.instagram.com(Jina Reader 우회 본문). 확인일 2026-08-21. 핵심 구조: **추천 게이트가 삭제 기준보다 엄격**.

| # | 관측 | 근거 | 출처 | 제안 매핑(axis) |
|---|---|---|---|---|
| I1 | 추천 제외(안전) 카테고리: 자해·폭력·성적암시·규제품(담배/베이핑/주류/의약)·체중감량/성형 홍보 | OFFICIAL | help.instagram.com/313829416281232 | recommendation |
| I2 | **비원본/재활용**(largely repurposed, material value 없음) 추천 부적격 | OFFICIAL | 〃 | recommendation + duplicate |
| I3 | **워터마크/보더/자막/크레딧만 붙인 재게시** = 원본 불인정 → 계정 통째 non-recommendable. 2026-04-30 사진·캐러셀 확대, 30일 롤링 회복 | OFFICIAL | creators.instagram.com/blog/rewarding-original-creators | recommendation + duplicate |
| I4 | 타 플랫폼 워터마크(TikTok/YT) 자기클립 교차게시도 재게시로 강등(임계치는 HEURISTIC) | OFFICIAL(조항)/HEURISTIC(임계) | 위 원본성 블로그 | duplicate |
| I5 | **engagement bait**("Comment YES"·태그/공유/좋아요 요구) 스팸 분류→배포 감소(재난/모금 예외) | OFFICIAL | transparency.meta.com/.../engagement-bait/ | policy + cta |
| I6 | Meta 명시 demote 목록: clickbait·engagement bait·팩트체크 허위·위반 가능 콘텐츠 | OFFICIAL | transparency.meta.com/.../types-of-content-we-demote/ | policy + recommendation |
| I7 | 저품질 링크(광고도배·깨진 사이트) + **콘텐츠 무관 긴 캡션** 추천 부적격 | OFFICIAL | help.instagram.com/313829416281232 외 | cta + policy |
| I8 | 조직적 댓글 네트워크·반복 복붙 저품질 댓글 demote | OFFICIAL | 위 두 페이지 | spam_behavior |
| I9 | 계정 비추천 사유: 위반 이력·프로필 비추천콘텐츠·**좋아요 구매/팔로잉 부풀리기**·광고금지·팩트체크 반복 | OFFICIAL | help.instagram.com/313829416281232 | spam_behavior + recommendation(account-level) |
| I10 | 규제품 거래 금지(의약품·마리화나·총기/부품·탄약), 규제품 브랜디드 콘텐츠 불허 | OFFICIAL | transparency.meta.com/reports/.../regulated-goods/ | policy |
| I11 | **AI 생성 콘텐츠 "AI Info" 라벨**(탐지 or 자진공개). 랭킹 무영향은 HEURISTIC | OFFICIAL(라벨)/HEURISTIC(랭킹) | transparency.meta.com/.../labeling-ai-content | policy |
| I12 | 외부링크/CTA: bio 네이티브 링크 5개·스토리 링크스티커·캡션 URL 기본 비클릭(공식원문 미확인) | HEURISTIC | 제3자 해설 | cta |
| I13 | 대량액션 rate limit·맞팔·매스팔로우/언팔·봇 자동화 금지(**구체 수치는 비공개**) | HEURISTIC | 제3자 추정 | spam_behavior |

**Instagram 시사점(엔진 조정):**
- **원본성이 2026 최대 변수** — `duplicate` 축을 "타 콘텐츠 유사도"뿐 아니라 **워터마크/재게시 신호**로 확장. `rec_repost_watermark` 규칙 신설(OFFICIAL 근거).
- **추천(recommendation) ≠ 삭제(policy) 2단 구조**는 Threads와 동일 — I1(안전 카테고리)·I6(demote)를 recommendation, I10(규제품 거래)를 policy로 분리.
- engagement bait는 IG도 명문 demote(I5·I6) → `engagement_exchange`/`urgent_pressure` 규칙에 IG용 영어 패턴("comment YES", "tag a friend") 추가.
- **룰에 넣지 말 것(HEURISTIC/미확인):** rate limit 구체 수치(20/시간 등), repost "10회/30일" 임계치, 캡션 클릭링크 세부 → 하드코딩 금지, 참고용으로만.

### 3-B. Threads (distribution·spam_behavior·policy)

핵심 구조: **삭제(policy) ≠ 추천제외(distribution)** 2단계. Threads는 IG 커뮤니티 가이드라인·모더레이션을 상속.

| # | 관측 | 근거 | 출처 · 확인일(2026-08-21) | 제안 매핑(axis) |
|---|---|---|---|---|
| T1 | IG 커뮤니티 가이드라인 상속, 위반은 라벨·강등·삭제 | OFFICIAL | transparency.meta.com/policies/community-standards/ | policy |
| T2 | 정치/시사 콘텐츠 **기본 추천 ON(opt-out)** — 2025-09 개정 | OFFICIAL | transparency.meta.com/features/approach-to-political-content/ | distribution (정치=자동차단 금지) |
| T3 | 추천 제외 카테고리(팔로워엔 노출): 폭력·규제품목(담배/베이핑/성인/의약)·성적암시·저품질 | OFFICIAL | transparency.meta.com/enforcement/.../lowering-distribution... | distribution |
| T4 | 랭킹 핵심 신호 = 답글 가능성·대화·체류시간·작성자별 engagement | OFFICIAL | transparency.meta.com/features/explaining-ranking/ig-threads-feed/ | distribution |
| T5 | 강등 대상: clickbait·engagement bait·**반복 복제 댓글·재활용(limited originality)**·저품질 영상 | OFFICIAL | 위 lowering-distribution 페이지 | duplicate + distribution |
| T6 | 스팸 링크: cloaking·misleading·**like/share-gating**·오타 도메인 | OFFICIAL | transparency.meta.com/policies/community-standards/spam | cta + policy (deceptive_link **OFFICIAL 승격 가능**) |
| T7 | 스팸 행동: 초고빈도 게시·fake engagement(좋아요/팔로우 매매)·giveaway 대가참여 | OFFICIAL | 〃 spam 페이지 | spam_behavior |
| T8 | engagement bait("Comment YES"·맞팔·리포스트 유도)는 "users broadly dislike"로 추천제외 | OFFICIAL(문구)/HEURISTIC(예시) | 위 lowering-distribution + Buffer | cta + spam_behavior |
| T9 | 외부링크는 **더 이상 강한 강등 아님**(Mosseri: 링크 개선, 텍스트-only 대비 ~17%↑) | HEURISTIC | postory.io/blog/threads-algorithm 외 | distribution — **과잉 감점 금지** |
| T10 | 계정 추천 적격성: 공개계정 필수, 반복위반 시 계정 전체 추천부적격(Account Status 확인) | OFFICIAL | help.instagram.com/653964212890722 · about.instagram.com/blog | distribution (account-level) |

**Threads 시사점(엔진 조정):**
- **정치 콘텐츠 자동 BLOCK 금지**(Threads 한정 opt-out). 만약 향후 정치 규칙을 넣더라도 Threads는 `distribution` 완화.
- `duplicate` 축의 재활용/repost 강등이 **Meta 공식 문구**로 근거 확보 → `duplicate.repurposed_content` 규칙 신설 정당.
- `deceptive_link`를 HEURISTIC→**OFFICIAL** 승격 가능(cloaking/gating/오타도메인). 단 일반 외부링크는 감점하지 말 것(T9).
- 미확인: Threads 단독 정책 문서 존재 여부, 최신성 정량 가중치, repost 구체 감점률 → 모두 "미확인"으로 남김.

### 3-C. X (distribution·spam_behavior·policy)

1차 근거 강함: help.x.com 본문(일부 Jina Reader 우회) + **오픈소스 알고리즘 `github.com/xai-org/x-algorithm`**(2026-08 갱신)의 실제 코드/가중치. 확인일 2026-08-21.

| # | 관측 | 근거 | 출처 | 제안 매핑(axis) |
|---|---|---|---|---|
| X1 | 플랫폼 조작 금지("artificially amplify/suppress") | OFFICIAL | help.x.com/.../platform-manipulation | policy |
| X2 | Content Spam: 대량·중복·무관 게시, 트렌드 해시태그 오용, **커멘트 없는 링크 반복**, Copypasta(동일/유사 반복) | OFFICIAL | 〃 | spam_behavior + duplicate |
| X3 | Engagement Spam: 참여 상호교환·대가지급, **follow churn**, 무차별 팔로잉, 자동 트래픽 유도 | OFFICIAL | 〃 | cta + spam_behavior (engagement bait 명문 금지) |
| X4 | 다계정 증폭 금지(비중복 목적이면 최대 10계정 허용) | OFFICIAL | 〃 | policy + spam_behavior |
| X5 | 가짜 페르소나(AI 프로필사진·복제 바이오), 패러디는 PCF 라벨 필수 | OFFICIAL | 〃 | policy |
| X6 | 무단 자동화/봇(Developer Policy 미준수) | OFFICIAL | 〃 | spam_behavior |
| X7 | **가시성 필터링(FoSNR)** 행동 열거: 검색·추천·트렌드·홈TL 제외, 도달을 프로필로만 제한, 참여수 제한 | OFFICIAL | help.x.com/.../hateful-conduct-policy | distribution (**HEURISTIC→OFFICIAL 격상**) |
| X8 | FoSNR을 코드로 구현: 게시물당 ALLOW/INTERSTITIAL/DROP, `SPAM_DROP`·`FOSNR_*_DROP` 라벨이 For You에서 DROP | OFFICIAL(코드) | xai-org/x-algorithm visibility-filtering | distribution + policy |
| X9 | **랭킹 가중치(param.rs)**: reply 5.0·quote 5.0·share 2.0·retweet 1.0·favorite 0.5·click 0.4·**open_link 0.2**·dwell 0.0. 부정행동(block/mute/report) 음수 | OFFICIAL(코드) | xai-org/x-algorithm home-mixer/params | distribution (대화·인용 우대) |
| X10 | OON(미팔로우) 강등 + 신규작가 부스트 + 동일작가 반복 감쇠 | OFFICIAL(코드) | 〃 | distribution + duplicate(동일작가 반복) |
| X11 | 규제품목 카테고리 존재 + 합성/조작 미디어 라벨링·비주도노출 | OFFICIAL | help.x.com/.../x-rules | policy |
| X12 | 외부링크 "강등" 통념 — 공개 param엔 open_link=+0.2(소폭 양수), 명시적 페널티 규칙 **미확인** | HEURISTIC | socialpilot/sproutsocial | distribution — **과잉 감점 금지** |

**X 시사점(엔진 조정):**
- `distribution` 축이 **OFFICIAL + 코드**로 근거 최강. Copypasta/링크반복/follow churn/engagement 교환은 spam_behavior·duplicate·cta로 직결.
- 랭킹 가중치가 답글·인용(5.0)≫좋아요(0.5) → 원본성·대화유발 우대는 IG/Threads와 동일 방향(교차 확인).
- **반증(룰에 넣지 말 것):** "프리미엄/인증 2~4배 부스트"는 공개 param에 승수 없음 → 근거 없는 수치. "Grok가 피드 랭킹" 서사도 repo(Phoenix 스코어러)와 불일치 → 배제.
- 미확인: 규제품목 품목별 세칙(도박/금융/의약 등), 외부링크 강등 정량, DSA 투명성 수치.

### 3-D. 네이버 블로그 (1차 리서치 완료 — 2026-08-21)

1차 근거: `policy.naver.com/rules/*`(게시물·계정 운영정책, 시행 2026-07-07/2023-09-15), `searchadvisor.naver.com/guide/content-abusing`(검색 스팸사례 스파인), 네이버 서치 공식블로그 224335446939(2026-07-06), 공정위 뒷광고 심사지침(easylaw.go.kr, 기준 2026-07-15). **핵심: 네이버는 두 축으로 갈린다 — policy(게재제한·삭제·계정해지=BLOCK급) vs search_quality(노출제외·순위하락).**

| # | 관측 | 근거 | axis / 탐지방식 |
|---|---|---|---|
| N1 | 도박·사행성(토토/카지노/파워볼) | OFFICIAL policy.naver.com | policy — 정규식(단 `illegal_promotion`과 중복 주의) |
| N2 | 불법거래 품목(짝퉁/레플리카/크랙/토렌트/웹툰무료보기) | OFFICIAL policy.naver.com | policy — **정규식 신규** |
| N3 | 저작권 침해·불법복제 유도 | OFFICIAL policy.naver.com | policy/duplicate |
| N4 | **뒷광고 부적절/모호 표현**(체험단/기자단/서포터즈/내돈내산/원고료/파트너스 + AD·PR·Sponsor 단독) | OFFICIAL 공정위 심사지침 | cta/policy — **정규식 고정밀(★ 최강)** |
| N5 | **뒷광고 미표시**(홍보 신호 O + 승인표현 X) | OFFICIAL 공정위 | cta/policy — **결합조건(저정밀→REVIEW), 위치요건(제목/첫부분)** |
| N6 | 반응조작·서로이웃 품앗이(서이추환영/공감품앗이/맞구독) | OFFICIAL(조작)/HEURISTIC(품앗이 용어) | policy/performance — 정규식(홍보 대상일 때) |
| N7 | 계정 매매·대여(계정판매/아이디팝니다/블로그임대) | OFFICIAL policy.naver.com(1인 3계정) | policy — 정규식 |
| N8 | 키워드 스터핑 | OFFICIAL searchadvisor | search_quality — **지표(밀도), 엔진 keyword_repeat 이미 존재** |
| N9 | 낚시성 제목(제목-본문 불일치) | OFFICIAL searchadvisor | search_quality — **지표(title_body_match 이미 존재)**, 어그로상투어(충격/경악/스압주의)는 보조 |
| N10 | 유사문서/스크래핑/중복 | OFFICIAL searchadvisor | duplicate — 지표(TF-IDF 이미 존재) |
| N11 | 저품질 대량생성(AI/템플릿 양산) | OFFICIAL searchadvisor 224335446939 | search_quality — 단건 판별 난이도↑ |
| N12 | 숨김텍스트/클로킹/리다이렉트 | OFFICIAL searchadvisor | **HTML/CSS 신호(본문텍스트 아님) → 앱이 HTML 미검사, 미구현 한계** |
| N13 | 매크로/자동포스팅 대량게시 | OFFICIAL policy+searchadvisor | policy — 행위기반, 홍보 대상일 때만 |

**네이버 시사점(구현):**
- **정규식으로 잡을 것(신규 규칙):** N2 불법거래품목, N4 뒷광고 부적절표현(고정밀★), N6 반응조작, N7 계정매매, N9 어그로상투어(보조). 전부 `platforms:["naver_blog"]` 스코프.
- **엔진 결합조건(신규):** N5 뒷광고 미표시 = 홍보 신호 O AND 승인표현(광고/유료광고/협찬/체험/무료제공...) X → cta/policy에 REVIEW급 신호(저정밀이라 "표시 의무 확인 필요" 프레이밍).
- **이미 있는 것:** N8/N9/N10은 엔진 naver search_quality 처리(keyword_repeat·title_body_match·topic_coverage)로 부분 커버 — 이번엔 sources를 OFFICIAL로 근거화(확인일 스탬프).
- **정직한 미구현:** N12 숨김텍스트/클로킹은 HTML/CSS 검사 필요(앱은 본문 텍스트만) → 미구현으로 명시. C-rank/D.I.A는 공식 미확인 → 알고리즘명 근거 금지. N11 저품질 대량생성 단건판별 난이도↑.

---

## §4. AI 엔진 고도화 (라이브 소싱 — 날조 금지)

### 4-A. 구조화 출력 부재 (CONFIRMED-CODE)
- `rewrite.py:69` `client.responses.create(model=model, input=prompt)` 후 `output_text`를 정규식으로 코드펜스 제거→`json.loads`. **JSON schema 강제 없음** → 모델이 산문 반환 시 `RuntimeError`로 로컬 폴백(`app.py:298`).
- `media.py:145` 비주얼 리뷰도 동일하게 프롬프트 의존 파싱.
- **조치:** OpenAI 구조화 출력으로 전환 — **공식 지원 확인됨**(아래 4-B). `responses.create` 프롬프트 파싱 → `responses.parse(text_format=PydanticModel)` 또는 `text.format={type:"json_schema",strict:true}`로 대체 시 `RuntimeError` 폴백 경로가 사실상 사라짐.

### 4-B. OpenAI 모델·API 사실 (OFFICIAL — developers.openai.com, 확인일 2026-08-21)

| 항목 | 확인된 사실 | 근거 |
|---|---|---|
| `gpt-5.6` 실재 | **실재.** 3-tier(`gpt-5.6-sol`/`terra`/`luna`), `gpt-5.6`=Sol(플래그십) alias. GA 2026-07-09 | OFFICIAL developers.openai.com/api/docs/models |
| 컨텍스트/출력 | 1.05M 컨텍스트 · 최대출력 128K · 지식컷 2026-02-16 | 〃 |
| 비전 | 3변형 모두 텍스트+이미지 입력 | 〃 |
| 가격(1M tok in/out) | Sol $5/$30 · Terra $2/$12 · Luna $0.20/$1.20 | 〃 |
| **구조화 출력** | Responses API `text:{format:{type:"json_schema",strict:true,name,schema}}`, 또는 Python `client.responses.parse(text_format=PydanticModel)`→`output_parsed` | OFFICIAL .../guides/structured-outputs |
| 스키마 제약 | 전 필드 `required`, `additionalProperties:false`, 루트 object(anyOf 불가), ≤5000 프로퍼티/10단계 | 〃 |
| 비전 입력 | `input_image` = URL / base64 data URL / Files API id · `detail`(low/high/original/auto) · 요청당 512MB·1500장 | OFFICIAL .../guides/images-vision |

- **시사점:** (1) 모델명 유효하나 `gpt-5.6`=최고가 Sol → **비용 최적화 시 Terra/Luna 티어 분리** 고려(재작성=Terra, 대량 스캔=Luna 등). (2) 구조화 출력 도입이 AI 엔진 고도화의 **최대 단일 개선**. (3) 현재 media.py의 base64 data URL 방식(`image_to_data_url`)은 공식 방식과 일치 — 유지 가능.
- 미확인: 표준 비전 개별 이미지 픽셀 상한, 배치/캐시 할인율(미조회).

---

## §5. 경쟁사·시장 벤치마크 (대부분 HEURISTIC)

> 근거유형 대부분 HEURISTIC(벤더 페이지·2차 소스, 자체 검증 아님). 확인일 2026-08-21.

시장은 3군으로 분절돼 있다:

| 군 | 대표 | 하는 일 | 우리 대비 공백 |
|---|---|---|---|
| ① 섀도우밴 **계정 진단** | Spikerz, PostEverywhere/Kadenzo, Vista Social | 계정/게시물의 사후 리스크 점수·유사도 경고 | 초안 **텍스트 사전검수·재작성 없음** |
| ② AI **재작성/SEO** | QuillBot, Jasper | 패러프레이즈·문법·브랜드보이스·SEO | **정책·섀도우밴 리스크 게이트 없음** |
| ③ 엔터프라이즈 **컴플라이언스** | Hootsuite, Sprout, Sprinklr | 승인 워크플로우·모더레이션 큐·규제 | 무겁고 고가, 개인/경량 사전검수 아님 |

**포지셔닝(방어 가능한 차별점):** "개별 초안을 발행 **전에** 정책·섀도우밴 리스크 + SEO/가독성 + AI 재작성까지 한 흐름"으로 묶은 **경량 사전검수**는 뚜렷한 공백. 우리 앱은 이미 이 결합(게이트+재작성+미디어+버전트리)을 갖췄다는 게 강점.

**해자·위협:** 해자 = 정책 리스크 게이트 정확도(§2·§3 룰셋)+재작성 신뢰성(§4 구조화 출력). 위협 = QuillBot/Jasper가 정책검사를 붙이거나, Hootsuite류가 경량 개인 플랜을 내면 공백이 좁아짐 → **정확도·속도·근거 투명성(OFFICIAL/HEURISTIC 표기)**이 차별의 핵심.

---

## §6. 다음 지시서용 변경 목록 (확정 — 근거 앵커 포함)

> ### 구현 상태 (2026-08-21, 커밋 `dd2223c` · 기준선 `bf9226c`, `_소스` git repo)
> 병렬 3에이전트 구현 + 임베디드 파이썬 통합검증(전체 py_compile·JSON·analyze 4플랫폼·플랫폼필터·rewrite·DB 스모크·`responses.parse` 실존·negation 안전성) 완료.
>
> | 항목 | 상태 | 비고 |
> |---|---|---|
> | ENG-1 account_pattern 제거+재정규화 | ✅ 완료 | 네이버 가중치 합 1.0 검증 |
> | 엔진 플랫폼 스코프 필터(§2-D) | ✅ 완료 | IG/X 발동·스킵 스모크 통과 |
> | RULE 신규 4종(IG·X·bait_en) | ✅ 완료 | 전부 OFFICIAL·negation_aware |
> | RULE-XPLAT-2 deceptive_link 승격 | ➖ no-op | 이미 OFFICIAL(`rules.json`) |
> | QA-1 negation 완충 | ✅ 완료 | critical 규칙 미부착 확인 |
> | sources 확인일 스탬프 | ✅ 완료 | `{url,retrieved}` 형식 |
> | FEAT-1 EMPIRICAL 폐루프 | ✅ 완료 | 관리탭 신뢰도표+재계산 버튼 |
> | FEAT-2 Policy Snapshot/Diff | ✅ 완료 | 수동 갱신 버튼(일부 URL은 FETCH_FAIL 정직표기 예상) |
> | AI-1 구조화 출력 전환 | ✅ 완료 | `responses.parse`+text_format 실존 확인, 폴백 유지 |
> | AI-2 모델 티어 | ✅ 완료 | `model_for(task)` 배선(rewrite=terra/visual=sol), scan은 결정론 엔진이라 예약(미사용). 커밋 `c3c5d26` |
> | ENG-3 duplicate 축 확장 | ✅ 완료 | `phash_duplicate()` 이미지 재사용 탐지(미디어 레이어) + media_assets persist. **텍스트 analyze() 축이 아니라 미디어 검수 신호**(미디어는 텍스트 스캔과 별개). 커밋 `c3c5d26` |
> | 네이버 전용 규칙 5종(§3-D) | ✅ 완료 | OFFICIAL 근거, `platforms:[naver_blog]` 스코프. illegal_promotion 도박어휘 확장. 커밋 `4bc288b` |
> | 뒷광고 '미표시' 결합조건(N5) | ✅ 완료 | `ad_disclosure_missing`(engine, naver): promo O AND approval X → HEURISTIC "확인 필요"(v1 관대: 승인 어디든 있으면 미발동). 커밋 `427c070` |
> | 숨김텍스트/클로킹(N12) | ✅ 완료 | `naver_hidden_text` 규칙(display:none/font-size:0/off-screen 등 CSS 정규식). 본문에 붙여넣은 HTML 신호 탐지. 커밋 `427c070` |
> | copypasta 줄-간 반복 탐지 | ✅ 완료 | `repeated_block_spam`(engine, 전 플랫폼): >=10자 동일 줄 3회+ → 도배 신호. split_sentences 개행분할 한계 우회. 커밋 `427c070` |
> | ENG-2 네이버 account_pattern 신규 신호 | ⏸ 연기 | 축 자체를 ENG-1에서 제거함(대안: 위 네이버 규칙들이 policy축 커버) |
> | QA-2 Golden/Regression | ✅ 완료 | `tests/golden_regression.py` + 16샘플(rule-level 검증) 16/16 PASS, golden_samples seed. 커밋 `eac037a` |
> | G05 튜닝(계정매매 false-PASS) | ✅ 완료 | `naver_account_trade` critical:true+negation_aware, 패턴 정밀화(솔리시테이션 형태). G05 PASS→**BLOCK**. 회귀 19/19 PASS(정밀도 negative N04~N06 추가). 커밋 `ede31ba` |
> | 실행본(`_실행본/app`) 동기화 | ✅ 완료 | 1~4차 모두 반영, DB 보존, health 200 |

우선순위 순. 각 항목에 근거(코드 `file:line` 또는 OFFICIAL 출처)와 축/규칙 매핑을 명시.

### A. 엔진 구조 수정 (CONFIRMED-CODE — 웹 불필요, 즉시 착수 가능)
- [ ] **ENG-1 `account_pattern` 죽은 축 처리 [최우선]** — 실제 채우는 로직 신설 **또는** 축 제거 후 네이버 가중치 재정규화. 근거 `engine.py:80,126` · `rules.json:11,16-21`. false-PASS 압력 제거.
- [ ] **ENG-2 `account_pattern` 신규 신호** (ENG-1을 "구현"으로 갈 경우): 외부링크 과다·해시태그 밀도·게시빈도·좋아요구매 흔적. IG I9·X X3(follow churn) 근거로 정당화.
- [ ] **ENG-3 duplicate 축 확장** — 현재 TF-IDF 유사도만(`engine.py:109-110`). **워터마크/재게시 신호**(IG I3·I4), Copypasta(X X2), limited originality(Threads T5)를 duplicate에 반영. 이미지 pHash(`media.py`)와 연계 가능.

### B. 플랫폼 전용 규칙 신설 (OFFICIAL 근거 — §3 표의 URL·확인일 필수 인용)
현재 규칙 6개 전부 한국어 스포츠베팅 정규식 → 아래를 `rules.json`에 추가. 영어+한국어 패턴 병행, `source:"OFFICIAL"`, sources에 확인일 스탬프.
- [ ] **RULE-IG-1 `rec_repost_watermark`** (recommendation+duplicate) — 워터마크/보더/자막/크레딧만 붙인 재게시. 근거 IG I3 (creators.instagram.com/blog/rewarding-original-creators).
- [ ] **RULE-IG-2 `rec_sensitive_category`** (recommendation) — 규제품/체중감량/성형/자해 홍보. 근거 IG I1 (help.instagram.com/313829416281232).
- [ ] **RULE-XPLAT-1 `engagement_bait_en`** (policy+cta+spam_behavior) — 기존 `engagement_exchange`에 영어 패턴("comment YES","tag a friend","repost to win") 추가. 근거 IG I5·I6, Threads T8, X X3.
- [ ] **RULE-XPLAT-2 `deceptive_link` OFFICIAL 승격** — 현재 HEURISTIC(`rules.json:120`) → OFFICIAL. cloaking/gating/오타도메인. 근거 Threads T6 (transparency.meta.com/.../spam), X X1.
- [ ] **RULE-X-1 `content_spam_copypasta`** (spam_behavior+duplicate) — 커멘트 없는 링크 반복·동일/유사 반복 게시. 근거 X X2 (help.x.com/.../platform-manipulation).
- [ ] **RULE-X-2 `visibility_filter_signals`** (distribution) — FoSNR 유발 신호를 distribution으로. 근거 X X7·X8 (help.x.com hateful-conduct + github.com/xai-org/x-algorithm).
- [ ] **RULE-DIST-1 정치콘텐츠 처리** — 만약 정치 규칙을 넣는다면 **Threads는 자동 BLOCK 금지**(opt-out 추천 ON). 근거 Threads T2.

### C. 신규 기능 (CONFIRMED-CODE — 웹 불필요)
- [ ] **FEAT-1 EMPIRICAL 폐루프** — `evidence.user_feedback`(`app.py:575`)+`enforcement_events` → `rule_stats`(`database.py:43`, 현재 미사용) 집계 → 규칙별 정밀도/오탐률 대시보드 → 반자동 가중치·status 조정. EMPIRICAL 근거등급을 실제로 채우는 유일한 경로.
- [ ] **FEAT-2 Policy Snapshot/Diff 배선** — `policy_snapshots`/`policy_diffs`(`database.py:49-54`, 미사용) 실제 구현: sources 주기 페치→해시→변경감지→알림. `rules.json` sources에 **확인일 필드** 추가(현재 없음, `rules.json:204`).

### D. AI 엔진 (OFFICIAL — developers.openai.com, 확인일 2026-08-21)
- [ ] **AI-1 구조화 출력 전환 [높은 가치]** — `rewrite.py:69`·`media.py:145`의 프롬프트-파싱을 `client.responses.parse(text_format=PydanticModel)`(→`output_parsed`) 또는 `text.format={type:"json_schema",strict:true}`로 교체. `RuntimeError`/로컬폴백 경로 대부분 제거. 근거 §4-B.
- [ ] **AI-2 모델 티어 분리(선택)** — `gpt-5.6`(=Sol, 최고가 $5/$30) 유효하나, 재작성=Terra($2/$12), 대량 스캔=Luna($0.20/$1.20)로 분리해 비용 최적화 검토. `config.json` 모델 필드 다중화. 근거 §4-B.

### E. 오탐 완충 (품질)
- [ ] **QA-1** 신규 공격적 규칙 추가에 맞춰 `negation_patterns`(현재 2개, `rules.json:200`)·SHADOW 상태를 확충해 오탐 제어.
- [ ] **QA-2 Golden/Regression 데이터 수집** — `golden_samples`·regression 러너(`app.py:580-587`) 존재하나 샘플 미수집. 신규 규칙마다 골든샘플 추가해 회귀 방어.

### ⛔ 룰에 넣지 말 것 (근거 없음/미확인 — 반증 완료)
- **X "프리미엄/인증 2~4배 부스트"** — 공개 param.rs에 승수 없음(X 핵심#5). **"Grok가 피드 랭킹"** 서사 — repo(Phoenix 스코어러)와 불일치.
- **일반 외부링크 감점** — Threads T9(링크 강등 완화)·X X12(open_link=+0.2)로 반증. cloaking/gating만 감점.
- **rate limit 구체 수치**(팔로우 20/시간 등)·**repost "10회/30일"** — 플랫폼 비공개, 제3자 추정 → 하드코딩 금지.
- **네이버 규칙 신규 추가** — 이번 라운드 1차 검증 안 함(§3-D). 별도 지시서로.

---

## §7. 커버리지 정직성 (본 리포트가 다루지 *않은* 것)

- 코드 정적분석(bandit/ruff/pip-audit)은 수행 안 함 — 별도 코드리뷰 프로토콜(2026-08-20) 소관.
- 네이버 블로그는 요약만(사용자 우선순위 = IG/Threads/X).
- 실제 A/B·백테스트로 규칙 정밀도를 측정하지 않음 — 골든샘플/regression은 존재하나 데이터 미수집.
- 웹 근거는 확인일 시점 스냅샷 — 정책은 수시 변경(→ 2-C가 필요한 이유).
