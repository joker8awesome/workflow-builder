# 센터장 세션 부트스트랩 / 인수인계 — 2026-08-22

작성: 센터장(Opus 5, Claude Code 로컬 세션) · 2026-08-22 01:2x KST
**이전판 `2026-08-21-center-session-bootstrap.md`는 이 문서로 대체(SUPERSEDED).** 이전판은 HEAD·지시서 번호·원격 유무 3개 항목이 전부 낡았음 — 참조하지 말 것.

---

## 0. 이 문서가 이전판에서 정정하는 것

| 항목 | 이전판(08-21) | **실제(08-22 실측)** |
|---|---|---|
| SNS자판기 소스 HEAD | `427c070` | **`9d70d42`** (그 뒤 7커밋 진행) |
| SNS자판기 원격 | "로컬 전용, 원격 없음" | **`github.com/joker8awesome/sns-jping`(private) 연결·동기화 완료** |
| 다음 지시서 번호 | `#58` | **`#64`** (#63까지 발행됨) |
| app_version | 6.0.5 계열 | **6.1.0** |

---

## 1. 세션 신원·시스템 상태 (MCP 실측 2026-08-22)

- **이 세션 = `ag_claude_desktop`(센터장)**, scope `mcp:read`/`mcp:execute`/`mcp:admin`. `agent_whoami` 정상.
- **센터장 pending 큐: 0건** (`agent_tasks_list_pending → {"tasks":[]}`, types 3종 전부).
- **로컬 MCP 폴러 가동 중** — `ops/poll-queue.js`, 5분 주기, 최근 로그 "대기 건 없음"(`ops/poll-queue.log`). 이건 **센터장 쪽 Windows 폴러**이며 할매봇 VPS 폴링과 무관하다.
- registry `online` 플래그는 하트비트 오작동으로 전 에이전트 `false` 표시 — **liveness 판단 근거로 쓰지 말 것.**

## 1-1. 할매봇(ag_hermes) 상태 — 응답 없음

- **마지막 확인 보고: msg_381 / 지시서 #60** (2026-08-20T21:43Z). 이후 신규 report 0건.
- **#61·#62 미수행** — `deepbot_action.md`에 기록 줄 없음, `ops/inbox.md`에 메시지 없음.
- → **#63으로 #61·#62를 폐기(SUPERSEDED)하고 현재 HEAD 기준 재발행함.**
- ⚠ **저자 혼동 주의:** 이 PC의 git `user.name`이 `Hermes Agent`다. `D:\naver\SNS자판기_소스`의 최근 커밋들은 전부 `+0900 / xowlsdk7@gmail.com` = **로컬 세션 작업**이지 VPS 할매봇 작업이 아니다. 할매봇 귀속은 inbox·deepbot_action 증거가 있는 #57·#60뿐.

---

## 2. SNS자판기 (Content QA v6) — 정본 위치가 중요

### ✅ 정본: `D:\naver\SNS자판기_소스`
- git repo, `origin = https://github.com/joker8awesome/sns-jping` (private)
- **HEAD `9d70d42` = origin/main 일치**, working tree clean
- `app_version 6.1.0`, 규칙 **20종**, 임계값 프로필 키 = **`threshold_profiles`**(3종: ig-sports·persona-threads·persona-x)
- 회귀: `python -s -E tests/golden_regression.py` → **68/68 PASS, FAIL 0** (2026-08-22 실행 확인)
- 포터블 실행본 `D:\naver\SNS자판기_실행본\app` — app.py·rules.json·config.json·core/engine.py **md5 동일(동기화됨)**. 실행: `시작.bat` → http://localhost:8501 (**HTTP 200 확인**)

### ⛔ 죽은 사본: `D:\SNS자판기\SNS자판기_소스`
- **git repo 아님.** 8/20 zip 압축해제본, `app_version 6.0.5-branding`, 규칙 10종
- 2026-08-22 01:09~01:12에 **다른 세션이 여기에 Part 2를 독립 재구현**함(프로필 키 `profiles`, `regression/run_regression.py`) — 정본과 병합 불가에 가까움
- **수정 금지.** 건질 것은 `regression/persona_golden.json` 16 케이스 중 정본 골든 68에 없는 것뿐

### 커밋 이력 (정본)
`bf9226c`(기준선) → `dd2223c`(고도화1차) → `c3c5d26`(2차) → `4bc288b`(3차 네이버) → `eac037a`(골든) → `ede31ba`(G05) → `427c070`(4차) → `2589e35`(실사용수정) → `c6be9b2`(SPEC.md) → `d76d014`(v6.0.6 버그5) → `2b2e94d`(v6.1.0 PRD§2) → `23ebfde`(보류4건 결정) → `702184a`(vending v2: 프로필3·persona룰4·리포트필드) → `9d70d42`(persona-x 전략게이트)

### ⛔ 룰에 넣지 말 것 (반증완료)
X "인증 2~4배 부스트"·"Grok 랭킹", 일반 외부링크 감점(Threads/X 반증 — 그래서 persona-x 본문URL은 **룰이 아닌 전략 게이트**로 구현), rate limit 구체수치, C-rank/D.I.A 알고리즘명 근거.

---

## 3. SNS 운영 워크스페이스 `c:\sns` (2026-08-22 신설)

지침서: `D:\SNS자판기\pipeline_session.md`(이것이 `vending_session.md`를 대체). 3레이어 = 로컬LLM 파이프라인 → 플랫폼 세션 3개 → SNS자판기 검수.

- `c:\sns\vending\STATUS.md` — 상태판. **상단에 센터장 정정 블록 있음**(Part 2 경로 오류·회귀 68/68 실측)
- `c:\sns\_inbox\vending.md` — 코디네이터→vending 수신함. **센터장 정정 통보 append됨**
- `c:\sns\_inbox\instagram.md` — vending→코디네이터 보고 로그
- `c:\sns\_shared\` — **brand_persona.md·coordinator_protocol.md 등 4종 전부 부재**(코디네이터 제공 대기)

### Part 1 (로컬 LLM 파이프라인, `D:\로컬LLM`) — 코드 완료
`crawl_sns_rss.py` + `sns_sources.json` + `sns_draft.py`. E2E 확인: fitness=힙으뜸 크롤 15건 → 요약 → 소재 15건.
**막힌 것:** lookbook·diet 채널 실제 ref 미등록(+lookbook `sfw_vetted:true` 필요), brand_persona.md 부재, 네이버 데이터랩/CivitAI 키 미확보.

---

## 4. Comment_Center repo

- `origin/main`과 동기, 미추적 파일 없음(`2026-08-20-code-review-worker-protocol.md`는 2026-08-22 커밋됨)
- 협업 채널: 센터장이 `*-hermes-handoff-N.md`를 **main에 push → 할매봇 5분 폴링 pull·수행**. MCP `agent.send_message`로는 할매봇에 안 닿음 — **repo push가 유일 채널.**
- **다음 지시서 번호 = `#64`**
- 승인게이트: `code.change`/`agent.write`/git push 자동통과. `deploy`/`credential.issue`/`rollback`만 사용자 텔레그램 승인.
- 할매봇 보고 확인: origin/main `deepbot_action.md` 새 커밋 read + `ops/inbox.md`

---

## 5. 재개 절차

1. `agent_whoami` → `ag_claude_desktop`(admin) 확인
2. `agent_tasks_list_pending` → 큐 확인
3. `git fetch && git log --oneline -5 origin/main` + `deepbot_action.md` tail → 할매봇 응답 여부
4. `cd D:\naver\SNS자판기_소스 && git log --oneline -3 && git status` → 정본 상태 (**`D:\SNS자판기\SNS자판기_소스` 아님**)
5. `c:\sns\vending\STATUS.md` + `c:\sns\_inbox\*` → 워크스페이스 세션 상태
6. 상세 원칙: `collaboration-spec` / `bootstrap-guide` / `snsjping-upgrade` 메모리

---

## 6. 열린 항목

- **할매봇 liveness 미확인** — #63이 응답 확인 겸용. 무응답 지속 시 VPS 폴러 복구가 선행 과제
- **Part 2 이중 구현 정리** — 죽은 사본의 골든 16종 이관 여부 판단 필요
- **`_shared/` 문서 4종 부재** — persona_suggestive 수위 튜닝의 선행 조건
- **SPEC.md 정합성** — `c6be9b2`에 작성 후 `d76d014`~`9d70d42`에서 갱신되긴 했으나(§전략게이트 반영 확인), 규칙 20종·프로필 3종 기준 전수 대조는 미실시 → #63에서 할매봇에 위임
- **SNS자판기 후속(선택)** — 뒷광고 위치요건 정밀화, M2 headless렌더·M3 STT는 **보류 확정**(무설치 포터블 원칙)
