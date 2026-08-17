# 지시서 #45 — 라벨 소스 실측 + Nous 워커 웹/모델 프로브 (전부 읽기 전용)

작성: 센터장(Opus 4.8) · 2026-08-18 · 대상: 할매봇(ag_hermes)
trace_id: `label-and-web-probe-20260818`

> 전부 **읽기 전용/프로브**. 아무것도 만들거나 바꾸지 마라. 결과만 보고.
> `games`·`odds_snapshots`는 야구 픽 프로젝트 소유 — SELECT만.

---

## A. 라벨 소스 실측 (psql, 읽기 전용)

```sql
\d games
SELECT DISTINCT league FROM games;
SELECT DISTINCT provider FROM odds_snapshots;
SELECT game_id, league, home_team, away_team FROM games LIMIT 5;
SELECT market, side, count(*) FROM odds_snapshots GROUP BY market, side ORDER BY 3 DESC LIMIT 30;
SELECT league, count(*), min(game_date), max(game_date) FROM games GROUP BY league ORDER BY 2 DESC;
```

**확인 목표:** (1) `games`에 결과/스코어 컬럼이 있나 (2) 리그가 MLB/KBO 무엇 (3) 배당 `provider`가 누구 (4) `game_id` 형식 (5) 결과성 market(settled/result)이 있나 (6) 경기 수·기간.

---

## B. Nous 워커 프로브 — 웹 리서치 가능성 (핵심)

목표: k3(`moonshotai/kimi-k3`)와 deepseek 모델을 **웹 리서치 가능**하게 만들 수 있는지의 전제 확인. **만들지 마라. 확인만.**

### B-1. tool-calling(function calling) 지원 여부 — 가장 중요
Nous `/chat/completions`에 **간단한 `tools` 배열**을 넣어 호출하고, 모델이 어떻게 반응하는지 본다. `moonshotai/kimi-k3`와 사용 중인 deepseek 모델 **각각**.

```bash
# 예: /opt/data/auth.json 의 nous access_token 사용
# tools에 web_search 하나만 정의하고, 웹이 필요한 질문을 던진다
# body: { model, messages:[{role:user, content:"오늘 서울 날씨 검색해줘"}],
#         tools:[{type:function, function:{name:"web_search",
#           parameters:{type:object, properties:{query:{type:string}}, required:["query"]}}}] }
```

**세 가지 결과를 구분해서 보고:**
- ✅ `tool_calls`가 응답에 옴 → tool-loop 구축 가능
- ⚠️ **400/에러** → 이 모델은 tools 미지원 (명확한 실패, 차라리 나음)
- 🔴 **조용히 무시하고 그냥 답함** → **가장 위험**. 모델이 기억으로 지어낸 답을 "리서치"로 오인. (#25의 404-를-success 재판)
  → 이 경우 tool-loop 불가, orchestrator-fetch(RAG)만 남음.

### B-2. 카탈로그에 deepseek-v4-pro / flash 있나
`model-swap-feasibility.md §5` 명령 그대로 `/models` 조회:
```bash
node -e "
const a=JSON.parse(require('fs').readFileSync('/opt/data/auth.json','utf8'));
const n=a.providers.nous;
fetch(n.inference_base_url+'/models',{headers:{Authorization:'Bearer '+n.access_token}})
 .then(r=>r.json()).then(j=>console.log((j.data||[]).map(m=>m.id).join('\n')));
"
```
`deepseek-v4-pro`, `deepseek-v4-flash`, `moonshotai/kimi-k3`가 목록에 실재하는지. **실호출 200 확인**(이름만 있고 404일 수 있음 — #25).

---

## 보고 양식
```
[A 라벨]
- games 결과컬럼: 있음(컬럼명 __)/없음
- 리그: ______  provider: ______
- game_id 형식 예: ______
- 결과성 market: 있음(__)/없음
- 경기수/기간: ______
[B-1 tools]
- kimi-k3: tool_calls옴 / 400 / 조용히무시
- deepseek(__): tool_calls옴 / 400 / 조용히무시
[B-2 카탈로그]
- deepseek-v4-pro: 있음+200 / 있음+404 / 없음
- deepseek-v4-flash: ______  kimi-k3: ______
[결과] 완료 / 막힘(______)
```

## 안 하는 것
- 코드·엔드포인트 신설 금지 (이건 프로브다)
- games/odds_snapshots 쓰기 금지
- push 불필요 — 보고만
