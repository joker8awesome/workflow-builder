# 지시서 #48 — insane-search 엔진 VPS 배포 + web_fetch 배선 + 재테스트

작성: 센터장(Opus 4.8) · 2026-08-18 · 대상: 할매봇(ag_hermes)
trace_id: `engine-deploy-wire-20260818`

> 목적: #46 웹 리서치 워커의 실조회가 안 됨(Jina 403). 엔진을 붙여 실제 fetch를 살린다.
> 엔진은 저장소 `tools/insane-search-engine/`에 벤더링됨(커밋 3522b03). `git pull`로 받는다.
> **배포는 반드시 `node ops/guarded-deploy.js`로**(#47 강제) — 이번에도 승인 게이트 탄다.

## 1. 엔진 배치 + 실행 가능화
- ⚠️ **함정1 — 모듈명**: `python3 -m engine`로 돌리려면 **패키지 디렉터리 이름이 `engine`**이어야 한다(하이픈 `insane-search-engine`은 모듈명 불가).
  - 예: `cp -r tools/insane-search-engine /opt/data/engine` (또는 심링크). 부모(`/opt/data`)에서 `python3 -m engine`.
- 의존성(curl_cffi 등): 스모크 실행 시 자동 설치되거나 수동 설치.
- **스모크**: `cd /opt/data && python3 -m engine "https://example.com"` → 종료코드 0 + 본문. 배치 경로·결과 보고.

## 2. web_fetch 백엔드에 엔진 연결 (server.js — #43·#44·#46과 직렬)
- #46의 `/api/llm/research` web_fetch는 "엔진 있으면 엔진, 없으면 Jina" 2단 구조. 서버가 엔진을 호출하도록 배선:
  - `python3 -m engine "<url>" --json`(가능하면 구조화 출력)을 cwd=엔진 부모로 실행, stdout 파싱. 실패 시 Jina 폴백 유지.
- 🔴 **함정2 — SSRF 리다이렉트 우회**: 엔진은 우회 fetch(TLS 위장·리다이렉트 추적)라, **엔진이 내부적으로 리다이렉트를 따라가면 서버의 매-홉 SSRF 검사를 우회**한다. 반드시:
  - web_fetch는 **엔진 호출 전 `validateWebUrl`로 SSRF 검증**(기존 ssrf-guard.js) 먼저.
  - 엔진에 **리다이렉트 비활성 옵션이 있으면 끄고**, 서버가 리다이렉트를 받아 매 홉 재검증. 없으면 엔진이 반환한 **최종 URL도 재검증**.
  - 사설/메타데이터 IP로의 우회 fetch가 실제로 차단되는지 테스트로 확인.

## 3. 배포
- `node ops/guarded-deploy.js "insane-search web_fetch 배선 (#48)"` → 승인 대기(텔레그램) → 승인 시 배포.

## 4. 재테스트 (합격기준)
- **실조회**: `/api/llm/research`에 "오늘 <시의성 주제> 검색해 3줄 요약" → `used_sources`에 **실제 URL·성공**, 답이 그 내용 반영. (전엔 Jina 403/DDG 0)
- **SSRF 유지**: `web_fetch`로 `http://127.0.0.1`·`http://169.254.169.254`, 그리고 **내부로 리다이렉트하는 URL** → 전부 차단.
- `npm test` 전 스위트 통과 + (있으면) 엔진 파싱·리다이렉트 SSRF 검사 추가.
- Kimi 리뷰: 엔진 stdout 파싱·타임아웃·리다이렉트 실패경로.

## 5. 안 하는 것
- 엔진 호출을 SSRF 게이트 **앞**에 두기(우회 위험). raw pm2 restart(guarded-deploy로).
- 실패를 성공으로(#25). used_sources 없이 반환.

## 보고 양식
```
[1 배치] 경로 __ / 스모크 종료코드 __
[2 배선] 엔진 우선·Jina 폴백: 예 / SSRF 엔진앞 검증+리다이렉트 재검증: 예
[3 배포] guarded-deploy 승인id __ → 배포: 예
[4 재테스트] 실조회 used_sources 실URL: 예 / 내부리다이렉트 차단: 예 / npm test __건 / Kimi __건
[막힘] ______
```

`trace_id`: `engine-deploy-wire-20260818`
