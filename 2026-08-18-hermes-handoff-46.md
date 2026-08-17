# 지시서 #46 — 웹 리서치 워커: tool-loop 엔드포인트 + insane-search 백엔드

작성: 센터장(Opus 4.8) · 2026-08-18 · 대상: 할매봇(ag_hermes)
trace_id: `web-research-worker-20260818`

> 목표: k3·deepseek가 **실제 웹 조회**로 리서치하게 한다(#45에서 tool_calls 지원 확인).
> **코어 MLB 수집과 무관** — 이건 enrichment·정성 리서치용 인프라를 미리 구축.

## 0. 선행·순서·안전
- **server.js를 건드린다 → #43-C·#44-E와 직렬.** pull 후 순차, 각 커밋 후 npm test.
- **신규 엔드포인트로만** 만든다. 기존 `/api/llm/worker`는 **건드리지 마라**(파이프라인이 씀).
- 🔴 **보안 필수(SSRF)**: LLM이 시키는 대로 서버가 URL을 가져오는 구조다. 사설망을 못 때리게 막지 않으면 내부망·클라우드 메타데이터가 샌다.

---

## 1. tool-loop 리서치 엔드포인트 `POST /api/llm/research` (신규)

**입력:** `{ prompt, model?(기본 kimi-k3), agent_id, trace_id, report_to?, max_iters?(기본 5) }`
**인증:** 기존 worker와 동일 `requireScope(pool,'mcp:execute',...)` + rate limit.

**tools 2개를 모델에 준다:**
- `web_fetch({url})` → §2 백엔드로 URL 본문(마크다운/텍스트) 반환.
- `web_search({query})` → §3 백엔드(결정 필요).

**루프:**
```
messages = [system(리서치 지침), user(prompt)]
for i in 1..max_iters:
  r = nous /chat/completions (model, messages, tools)
  if r has tool_calls:
     각 tool_call 실행 → 결과를 role:'tool' 메시지로 append → continue
  else: break (최종 답)
```

**🔴 감사성 (앵커 게이트 ①의 리트리벌판):**
- 응답에 `used_sources: [{type:'search'|'fetch', query|url, ok, bytes|error}]` 를 **전부** 싣는다.
- 출처 없이 합성된 답은 검증 불가 = 반려 대상. 최종 응답에 `used_sources` 없으면 실패로 친다.

**🔴 SSRF 방어 (web_fetch):**
- `http(s)`만. 그 외 스킴 거부.
- DNS 해석 결과가 **사설/루프백/링크로컬**(10/8·172.16/12·192.168/16·127/8·169.254/16·::1·fc00::/7)이면 거부.
- `169.254.169.254`(클라우드 메타데이터) 명시 거부.
- 리다이렉트도 매 홉 재검사.

**가드레일:** 총 타임아웃(예 90s), fetch 개수 상한(예 8), 응답 본문 truncate(예 20KB/fetch). 무한루프 방지(max_iters).

**실패 성공포장 금지(#25):** fetch/search 실패는 tool 결과에 `error`로, 최종 `success` 판정에 반영. 404를 성공으로 싣지 마라.

---

## 2. web_fetch 백엔드 — 2단
1. **1차(지금 가능, 배포 0): Jina Reader 호스티드** — `GET https://r.jina.ai/<url>` (URL→마크다운, 다수 차단 우회). 키 불필요.
2. **2차(강력): insane-search 엔진** — `python3 -m engine "<url>" [--json]`. 있으면 이걸 우선, 실패 시 1차 폴백.
   - **엔진 배포는 §4** (아직 VPS에 없음).
- 백엔드는 **교체형**으로: 엔진 있으면 엔진, 없으면 Jina. 코드가 둘 다 지원.

## 3. 🔴 web_search 백엔드 — 결정 필요 (insane-search엔 검색 없음)
insane-search는 **fetch 전용**(URL→내용). 검색(질의→URL목록)은 별도.
- **먼저 VPS에서 확인·택1 보고:**
  - (a) 검색 API 키가 있나 (Brave 무료티어/Serper 등) → 있으면 그걸로.
  - (b) 없으면 DuckDuckGo HTML(`https://html.duckduckgo.com/html/?q=`)을 web_fetch 백엔드로 가져와 링크 파싱 — 키 0, 취약하나 동작.
  - (c) 정 안되면 v1은 **web_fetch만** 노출(모델이 URL을 알거나 search 결과를 프롬프트로 받음).
- 지어내지 말고 **가용한 것 확인 후** 택1.

## 4. insane-search 엔진 VPS 배포 (사용자님 요청)
- ⚠️ **엔진 파일 전달 이슈**: 엔진은 센터장 Windows 스킬 폴더에 있고, 저장소 자동복사가 안전분류기에 막혔다. **전달 경로를 먼저 정해야 함**(센터장이 사용자와 조율):
  - (i) 사용자가 엔진을 VPS로 직접 복사, 또는 (ii) 승인 후 저장소 벤더링, 또는 (iii) 별도 배포.
- 엔진 도착 후 할매봇: `python3 -m engine "<공개URL>"` 스모크(종료코드 0), 의존성(curl_cffi 등) 자동설치 확인. 배치 경로 보고.
- **엔진 없어도 §1~3(Jina 백엔드)로 엔드포인트는 동작**하게 만든다. 엔진은 2차 백엔드로 나중에 붙인다.

## 5. 테스트
- 스모크: "오늘 X를 검색해 3줄 요약" → `used_sources`에 실제 URL·성공, 답이 그 내용 반영.
- SSRF: `web_fetch`로 `http://127.0.0.1`·`http://169.254.169.254` → **거부** 확인.
- 무한루프: tool_call 계속 나오는 상황에서 max_iters에서 종료.
- Kimi 리뷰: 루프·tool 파싱·SSRF 우회 실패경로.
- `npm test` 전 스위트 통과 + 신규 검사(엔드포인트 인증·SSRF 상수) 추가.

## 6. 승인 게이트
- 신규 엔드포인트 코드 = 자동. **pm2 재시작/배포 = deploy 승인.**
- 검색 API 키(유료) = credential/비용 승인. 엔진 배포 = 사용자 조율.

## 7. 안 하는 것
- `/api/llm/worker` 변경. SSRF 방어 생략. `used_sources` 없이 결과 반환. 404를 success로.
- 코어 MLB 수집을 이 엔드포인트로(그건 API+cron, 별건).

## 보고 양식
```
[1 엔드포인트] /api/llm/research 추가: 예 / 루프·tools 동작: 예
[2 fetch백엔드] Jina 동작: 예 / 엔진 연결: 예·보류
[3 search백엔드] 택: a키(__)/b DDG/c fetch만
[4 엔진배포] 도착경로: __ / 스모크 종료코드: __
[5 테스트] SSRF거부: 예 / npm test __건 / Kimi리뷰 __건
[막힘] ______
```

`trace_id`: `web-research-worker-20260818`
