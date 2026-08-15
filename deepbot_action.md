# CLAUDE.md — 커멘드센터 팀 컨텍스트 (Claude Code용)

> 이 파일은 Orca/Claude Code 세션에서 **자동으로 로드**되어 항상 기억됩니다.
> 사용자가 "중지"라고 하기 전까지 계속 유지·참조할 것.

---

## 1. 프로젝트 개요

- **이름**: 커멘드센터 (Command Center) — 워크플로우 빌더 프로젝트
- **저장소**: github.com/joker8awesome/workflow-builder (커밋 84개 — 기준 `648c51e`)
- **GitHub Pages**: https://joker8awesome.github.io/workflow-builder/
- **서버**: VPS (Hostinger srv1803151) — Node.js + Express + PostgreSQL 17
- **MCP**: https://187.127.124.16.sslip.io/mcp (12개 툴, Bearer 인증)

---

## 2. 현재 아키텍처

```
웹 UI (index.html 5,500줄) ──REST/WS──▶ Express (server.js 1,462줄, API 78개)
  · 노드 9종 · 에이전트 팀 15명 · MCP · PWA        │
  · 다크 테마 #00ff87 · 시스템 한글 폰트             ▼
                                          PostgreSQL 17 (odds DB)
에이전트 실행: Python (agent_orchestrator.py, .agentenv)
MCP 서버: mcp-router.js (Streamable HTTP) + mcp_server.py (Python)
```

---

## 3. 에이전트 팀 (15명 + 클로드 데스크톱 = 16)

| ID | 이름 | 역할 | capabilities |
|----|------|------|-------------|
| ag_orch | 오케스트레이터 | 팀 총괄·분배·수렴 | orchestrate, delegate |
| ag_researcher | 리서처 | 조사·수집·요약 | research, summarize |
| ag_analyst | 분석가 | 데이터 분석·인사이트 | analyze, pattern |
| ag_writer | 콘텐츠 작가 | 문서·보고서 작성 | write, draft |
| ag_reviewer | 검토자 | 품질 검증·피드백 | review, verify |
| ag_collector | 데이터 수집가 | 웹/API 수집 | crawl, collect |
| ag_developer | 코드 개발자 | 코드 작성·수정 | code, refactor |
| ag_tester | 테스터 | 테스트·회귀 검증 | test, regression |
| ag_designer | 디자이너 | UI/UX 설계 | design, visualize |
| ag_security | 보안 담당 | 취약점·PII 보호 | security, audit |
| ag_communicator | 커뮤니케이터 | 외부 보고·알림 | report, notify |
| ag_scheduler | 스케줄러 | 일정·크론·마감 | schedule, cron |
| ag_integrator | 통합 담당 | MCP·API 연동 | integrate, api |
| ag_archiver | 아카이버 | 기록·버전·지식 | archive, knowledge |
| ag_auditor | 감사자 | 감사·준수 | audit, compliance |
| ag_claude_desktop | 클로드 데스크톱 | 사용자 세션 (Claude Code) | — |

**워크스페이스**: 각 에이전트는 /opt/data/agents/<id>/ (input/output/logs/workspace.md)
**상태**: 대기/진행/검토/완료/블로커 (한글)

---

## 4. 협업 프로토콜

### 메시지 3종
- `command` — 실행 지시
- `instruction` — 설정/지침
- `report` — 결과 보고

### 핵심 규칙
1. **trace_id 필수 유지** — 보고에 원래 trace_id 사용
2. **payload_ref로 데이터 참조** — 대용량은 참조만 전달
3. **핸드오프 체인** — 작업 끝나면 다음 담당자에게 인계 (agent.send_message)
4. **역할 라우팅** — /api/team/next/:agentId 로 다음 담당자 추천
5. **작업 격리** — 각자 워크스페이스에서만 실행

---

## 5. MCP 툴 (12개)

```
workflow.list / execute / get_status / get_trace
agent.whoami / list / send_message / tasks.list_pending / tasks.claim
agent.payload.get / report / checkpoint
```

- 인증: `Authorization: Bearer wf_ak_...` 헤더
- 엔드포인트: `https://187.127.124.16.sslip.io/mcp`

---

## 6. 진행 완료된 작업 (기억할 것)

- ✅ MVP → 16차 고도화 (에이전트 협업/오케스트레이션/MCP)
- ✅ 15명 에이전트 팀 구축 + 워크스페이스
- ✅ MCP 외부 연결 (Claude Code, HTTPS, Let's Encrypt)
- ✅ UX: 노드 팔레트/마퀴/플로팅바/스냅가이드/상태필터
- ✅ 보안: CORS 제한, Bearer 인증, 시크릿 볼트 키 설정, 테스트 정리
- ✅ node_count 버그 수정, 서버카드 https (커밋 `7b52bb3`)
- ⚠️ DB 접속 파라미터화 — **`server.js`만 완료. `mcp-router.js`는 누락돼 있었음**
  → 2026-08-15 수정했으나 **아직 미커밋·미배포**. 로컬 개발은 이게 배포돼야 가능
- ⏸ `agent.list` 하드코딩 수정 (machine JSONB + capability/online_only 필터) — **미커밋·미배포**

## 7. 진행 중 / 다음 작업

- ⏳ **에이전트 메타데이터 채우기** — capabilities/tools/trust_score (지침서: 2026-08-15-agent-metadata-guide.md)
- ⏳ 스펙 문서 갱신
- 사용자가 지시할 때까지 대기

## 8. 중요 경고

1. **WF_MCP_OPEN 비활성 유지** — 인증 우회 금지 (Bearer 인증 필수)
2. **WF_VAULT_KEY 설정됨** — 시크릿 볼트는 새 키 사용
3. **야구 픽 프로젝트와 분리** — 커멘드센터는 야구 프로젝트와 무관
4. **읽기 전용 점검 원칙** — 프로덕션 쓰기는 사용자 승인 후
5. **키/토큰 절대 커밋 금지** — .mcp.json은 .gitignore에 있음

---

## 9. 실행 환경

- 로컬 개발: Windows (D:\Comment_Center) — DB는 DATABASE_URL로 연결
- VPS: pm2 workflow-builder online, scheduler.py 30초 폴링
- 검증: PLAYWRIGHT_BROWSERS_PATH=/opt/data/.cache/ms-playwright ./.venv/bin/python

---

## 10. 작업 기록 규칙 (중요)

> 사용자 지시 (2026-08-15): **이 파일(`deepbot_action.md`)에 작업 내용을 계속 갱신**하라.
> 사용자가 "중지"라고 할 때까지 유지.

### 기록 규칙
1. **모든 작업 수행 후** 이 파일의 `## 작업 로그` 섹션에 기록
2. 기록 형식: 날짜 · 작업 내용 · 결과 (완료/진행/차단)
3. 프로젝트 상태 변경 시 상단 섹션도 함께 갱신
4. 새 작업 지시를 받으면 이 파일을 먼저 읽고 컨텍스트 파악

## 작업 로그

| 날짜 | 작업 | 결과 |
|------|------|------|
| 2026-08-15 | 팀 컨텍스트 파일 생성 (deepbot_action.md) | ✅ 완료 |
| 2026-08-15 | 스펙 문서 검토 — 라이브 시스템 + 저장소 대조 (`2026-08-15-spec-review.md`) | ✅ 완료 |
| 2026-08-15 | 저장소 로컬 체크아웃 (`D:\Comment_Center`) | ✅ 완료 |
| 2026-08-15 | 키 노출 점검 — 커밋 84개 전수 검사, 실제 키 없음 확인 | ✅ 완료 (이상 없음) |
| 2026-08-15 | 에이전트 메타데이터 지침서 검토·개정 v2 (`2026-08-15-agent-metadata-guide.md`) | ✅ 완료 |
| 2026-08-15 | `agent.list` 하드코딩 발견 — 데이터만 채워선 필터 동작 불가 확인 | ✅ 완료 (원인 규명) |
| 2026-08-15 | upstream 동기화 — 81→84 커밋 ff. 중복 수정분은 upstream 채택, 내 변경은 `stash@{0}` 보존 | ✅ 완료 |
| 2026-08-15 | `mcp-router.js` DB 풀 파라미터화 — upstream 누락분 (server.js만 적용돼 있었음) | ✅ 완료 (미커밋) |
| 2026-08-15 | `mcp-router.js` `agent.list` 재작성 — machine JSONB 읽기 + capability/online_only 필터 | ✅ 완료 (미커밋) |
| 2026-08-15 | `.env.example` 작성 (환경변수 7종 문서화) | ✅ 완료 |
| 2026-08-15 | 에이전트 프로덕션 스냅샷 확보 (`ops/agents-before.json`, 16명) | ✅ 완료 |
| 2026-08-15 | 메타데이터 주입 스크립트 작성 (`ops/fill-agent-metadata.js`) + dry-run 검증 16/16 | ✅ 완료 |
| 2026-08-15 | **메타데이터 프로덕션 반영** (승인 후 `--apply`) — 16/16 성공 | ✅ 완료 |
| 2026-08-15 | 반영 검증 — machine 3키 16/16, **machine 외 필드 변경 없음**, 기존 키 전원 보존 | ✅ 완료 |
| 2026-08-15 | 커밋 `126b5c1` (브랜치 `fix/agent-list-and-db-pool`, 미푸시) | ✅ 완료 |
| 2026-08-15 | Hermes 봇 인계 문서 작성 (`2026-08-15-hermes-handoff.md`) + 패치 `ops/mcp-router-fix.patch` | ✅ 완료 |
| 2026-08-15 | **VPS 배포** (Hermes 수행, 커밋 `06acf07`) — capability 필터 실동작 확인 | ✅ 완료 |
| 2026-08-15 | 배포 독립 검증 (로컬 MCP) — `capability=verify` → 3명 정확 | ✅ 완료 |
| 2026-08-15 | **`online` 지표가 영구 false임을 발견** — `agent_sessions.status`에 `running/working/waiting`을 쓰는 코드가 없음 | ⚠️ 미해결 (아래 참조) |
| 2026-08-15 | 파생 발견: `/api/team/status`의 `active_sessions`도 동일 사유로 **항상 0** (기존 버그) | ⚠️ 미해결 |
| 2026-08-15 | 조치 방침 확정 — **1번 정공법** (오케스트레이터가 running 기록) | ✅ 사용자 결정 |
| 2026-08-15 | `agent_orchestrator.py` 수정 — `ACTIVE_STATUSES` 어휘 + running/done/failed 전이 + 예외·중단 시 고착 방지 sweep + DSN 파라미터화 | ✅ 완료 (커밋 `75cd44a`, 미배포) |
| 2026-08-15 | `ops/test-session-status.py` 작성 — DB 없이 전이·어휘 일치·예외 경로 검증, **10/10 PASS** | ✅ 완료 |
| 2026-08-15 | Hermes 지시서 #2 작성 (`2026-08-15-hermes-handoff-2.md`) + 패치 | ✅ 완료 |
| 2026-08-15 | 브랜치 `fix/agent-list-and-db-pool` 푸시 (`75cd44a`) — 이제 Hermes가 `git pull` 가능 | ✅ 완료 |
| 2026-08-15 | main(`06acf07`)과 대조 — `mcp-router.js`는 **주석 차이뿐, 코드 동일** (충돌 없음) | ✅ 확인 |
| 2026-08-15 | **main 머지 완료** (`f0894a3`) — `mcp-router.js` 충돌은 main 버전 채택(코드 동일, 주석만 상이) | ✅ 완료 |
| 2026-08-15 | 프론트엔드 검토 리포트 (`2026-08-15-frontend-review.md`) — 배포본 실측 + 소스 대조 | ✅ 완료 |
| 2026-08-15 | 방향 결정: **팀 도구** (공개 읽기전용 아님) + 키 귀속은 **owner 컬럼** 방식 | ✅ 사용자 결정 |
| 2026-08-15 | 🔴 **자격증명 API 무인증 노출 발견** — GET이 헤더 없이 200, 발급·폐기도 동일 | ⚠️ 발견 |
| 2026-08-15 | P0 구현 — `auth-credential.js` 신설, 3개 라우트에 `mcp:admin`, `parseScopes` 정정, owner 지원, 프론트 관리자 키 입력 | ✅ 완료 (`5f81cf5`, **미배포**) |
| 2026-08-15 | `ops/test-auth-credential.js` 18/18 통과 | ✅ 완료 |
| 2026-08-15 | 지시서 #2를 `git pull` 방식으로 갱신 — 수동 패치는 fallback으로 접어둠, 롤백도 git 기반으로 교체 | ✅ 완료 |
| 2026-08-15 | Hermes 전달 시도 — **MCP 채널 없음 확인** (등록 에이전트 16명에 hermes 없음, `agent.send_message` 주소 부재) | ℹ️ 확인 |
| 2026-08-15 | 대안 경로로 전달 — 지시서 #1·#2 + 로드맵 + 스펙검토를 저장소에 푸시 (`c80526a`) | ✅ 완료 |
| 2026-08-15 | **오케스트레이터 VPS 배포** (할매봇 수행) — 테스트 10/10, 워크플로우 실행 | ✅ 완료 |
| 2026-08-15 | 배포 독립 검증 (로컬) — 세션 `done` **14개** 확인. 이전엔 19개 전부 `idle` | ✅ **전이 동작 확정** |
| 2026-08-15 | `active_sessions` 실행 후 0 — 정상 (`done`은 활성 어휘가 아니므로 sweep 대상 아님) | ✅ 설계대로 |
| 2026-08-15 | `agent.list` 배포 후 검증 (capability 필터) | ⏸ 배포 대기 |

| 2026-08-15 | 프론트엔드 검토 — Pages가 백엔드에 못 닿음(API_BASE=''), SW가 미사용 폰트 1.9MB 캐시 | ✅ 완료 |
| 2026-08-15 | 자동 협업 프로토콜 설계 — 큐/승인은 이미 있고 **알림 경로가 공백**임을 규명 | ✅ 완료 |
| 2026-08-15 | 프로토콜 1~4단계 구현 (`notify.js`·`approval-gate.js`·scheduler 큐 감시) | ✅ 완료 |
| 2026-08-15 | 텔레그램 승인 버튼 웹훅 — secret + chat_id 2중 검증, 중복 클릭 차단 | ✅ 완료 |
| 2026-08-15 | 5단계 폴링 — Windows 작업 `CommandCenter-QueuePoll` 15분 간격 등록 | ✅ 완료 |
| 2026-08-15 | 지시서 #4 배포 (할매봇) — rollback 게이트 + 웹훅 | ✅ 완료 |
| 2026-08-15 | **배포 독립 검증** — required에 rollback, 웹훅 403(2종), pending 0, owner 정상, machine 보존 | ✅ **전 항목 일치** |
| 2026-08-15 | 버튼 경로 실증 — 승인 id 6 approver=`@hanwoo79` (웹훅만이 만드는 형식) | ✅ 확인 |

> 이후 작업은 이 표에 계속 추가할 것.

### 해결됨

| 항목 | 결과 |
|------|------|
| **`online` / `active_sessions` 영구 0** | `agent_sessions.status`에 `running`/`working`/`waiting`을 쓰는 코드가 없어(전부 `idle`) 팀 대시보드 실시간 표시가 **처음부터 동작한 적 없었음.** → 오케스트레이터가 `running` → `done`/`failed`로 전이하도록 수정(`75cd44a`), `f0894a3` 배포. **검증: 세션 `done` 14개** (이전 19개 전부 `idle`) |
| `agent.list` 하드코딩 | `capabilities`/`tools`/`trust_score`가 리터럴 빈 값, `capability` 필터 무시됨 → `machine` JSONB에서 읽도록 수정(`06acf07`). **검증: `capability=verify` → 3명** |
| `workflow.list` `node_count: 0` | JSONB 이중 파싱을 빈 `catch`가 삼킴 → 타입 분기 + `console.warn` (`7b52bb3`) |

### 미해결 / 확인 필요

| 항목 | 내용 |
|------|------|
| **작업 로그 동시 편집 주의** | `deepbot_action.md`가 이제 저장소에 있어 **로컬 세션과 할매봇이 같은 파일을 편집**한다. 각자 커밋하면 충돌한다. 규칙: 편집 전 `git pull` → 자기 행만 추가 → 즉시 push. 남의 행을 지우거나 재정렬하지 말 것 |
| 세션 무한 누적 | `create_sessions`가 실행마다 새 UUID로 세션을 만든다. 19 → **43개**로 늘었고 정리 로직이 없다. 급하지 않으나 로드맵 Phase 3에 넣을 것 |
| 8/14 22:28 대량 쓰기 | 워크플로우 50행이 서버 부팅 +11초에 일괄 갱신. 침해 정황 없음(배포 작업 중). 원인 코드 미특정 — `updated_at` 트리거 확인 SQL은 spec-review §2 참조 |
| `WF_ACCESS_TOKEN` | 미설정이면 `/api/agents` POST/DELETE가 무인증 노출. `npx pm2 env 0`로 확인 필요 |
| 템플릿 중복 | `wf_tpl_team` 과 `wf_tpl_team_mstiqejr` 등 각 2벌 — 정본 결정 필요 |


## 작업 로그

| 날짜 | 작업 | 결과 |
|------|------|------|
| 2026-08-15 | 지시서#4: rollback 게이트 + 웹훅 — 테스트 3종 통과, env 설정, 웹훅 등록, 버튼 승인 확인(id6→approved @hanwoo79), 정리 완료 | ✅ |
| 2026-08-15 | 딥시크 워커 편성 — ag_deepseek 등록, /api/llm/worker(deepseek-v4-flash), TEAM_ROUTES 추가(16명), 규칙 문서화 | ✅ |
| 2026-08-15 | 지시서#8: UI 4건 수정 배포 (대비/스크롤/패널오류) — npm test 120건 통과 | ✅ |
| 2026-08-15 | 지시서#7: PHASE A 배포 완료(플래그 꺼짐), B 사용자 키 발급+서버 URL 접속 확인 | ✅ |
| 2026-08-15 | 지시서#7: PHASE C WF_REQUIRE_AUTH_ALL=1 켬, D 검증 — LLM 라우트 401/키 400/스케줄러 정상 | ✅ |
| 2026-08-15 | 워크플로우 정리 — wf_server1만 남기고 38개 삭제 | ✅ |
| 2026-08-15 | 지시서#7 PHASE D-3: 사용자 UI 재확인 완료 — 서버 URL에서 서버 연결됨 + 워크플로우 정상 | ✅ |
| 2026-08-15 | 지시서#7 전체 완료 — 변경 API 인증 강제 (유료 LLM 라우트 401) | ✅ |
| 2026-08-15 | 지시서#9: UI 2차 수정 배포 (팀 버튼 구분/togglePanel) — npm test 120건, 검증 4건 통과 | ✅ |
| 2026-08-15 | scheduler.py 최신 코드로 재시작 (옛 코드 8/13 시작이었음) — [큐] 미처리 감지 정상 | ✅ |
| 2026-08-15 | msg 158 (센터장→할매봇, trace_handoff9) 완료 처리 | ✅ |
| 2026-08-15 | 작업 자동 전달 루틴 구축 — send_to_center.py, 작업 후 센터장에게 report 전송 | ✅ |
| 2026-08-15 | 지시서#10: 알림 스팸 차단 — npm test 9스위트 128건, scheduler 재시작(큐 감시 기준 시각), 스팸 재발 0건 | ✅ |
| 2026-08-15 | 지시서#10: 보고 경로 복구 — list_pending types 파라미터로 report 조회 성공(msg 161) | ✅ |
| 2026-08-15 | 지시서#10: 정리 — 스팸 승인 8~14 rejected, 죽은 큐 메시지 7건 cancelled | ✅ |
| 2026-08-15 | 지시서#12: 워크플로우 손실 확인 — 의도된 삭제(사용자 지시), 백업 wf_20260815.sql에 wf_tpl_team 포함(복구 가능), _preserve 보존 | ✅ |
| 2026-08-15 | 지시서#11: /api/approvals 잠금 — ag_scheduler 키, WF_SCHEDULER_KEY, WF_APPROVALS_AUTH=1, 무인증 401/키 200/알림 지속 | ✅ |
| 2026-08-15 | 센터장 handoff-12 취소 수신(msg 165) — 의도된 정리 확인 일치 | ✅ |
| 2026-08-15 | 지시서#14: 커멘드센터 전용 봇 전환 — 새 토큰/chat_id, 웹훅 등록, 버튼 콜백 수신(acceptCount 1, id24 approved) | ✅ |
| 2026-08-15 | 지시서#15: 큐 정리(163·164·165·167·168 completed), 배포(135건), 웹훅 유지(true), 스키마 덤프 20테이블, 기동방식 답변 | ✅ |
| 2026-08-15 | 지시서#16: 자동 픽업 — WF_GATEWAY_TOKEN(게이트웨이 봇) 설정, pm2+scheduler 재시작, wake 테스트 woken=true | ✅ |
| 2026-08-15 | 지시서#19: 자동 픽업 배포 — npm test 157건, Hermes cron 등록(시스템 cron 데몬 없음), wrapper 경로 수정, hermes -z 실동작 확인(자동 #17 수행, claim 3건, 커밋 58aaa25) | ✅ |
| 2026-08-15 | 지시서#6: LLM 워커 무인증 차단(P0) — npm test 8스위트 119건 통과, 401/400 확인, limit 적용 | ✅ |
| 2026-08-15 | 지시서#17: 자동 픽업 검증 — 사람 개입 없이 지시 수신·수행 (ops/.queue-trigger.json 읽고 git pull 후 지시서 수행) | ✅ 완료 |
| 2026-08-16 | 센터장 봇 양방향 대화 구현 — 텔레그램 텍스트 수신(/status·/queue·/help 직접 응답, 자유 문장은 큐 적재), 봇 메시지 무시로 루프 차단, allowed_updates에 message 추가 (3c0acbf) | ✅ |
| 2026-08-16 | 할매봇→센터장 자동 픽업 — report는 ops/inbox.md 기록 후 claim(세션 불필요), command/instruction만 세션 기동. 본문은 REST /api/messages로 보완(list_pending은 payload_ref만 반환) | ✅ |
| 2026-08-16 | 버그 발견·수정: POST /api/messages 기본 status='sent' → list_pending('pending'만 조회)에 영영 안 잡힘. 기본값 'pending'으로 변경, ops/test-message-status.js(6건)로 고정 | ✅ |
| 2026-08-16 | 실증: msg_175(ag_hermes→ag_claude_desktop, 'sent')가 위 버그로 미수신 상태 확인. 배포 후 신규 메시지부터 해소, msg_175는 잔존 | 확인 |
| 2026-08-16 | 지시서#20 작성·전달(msg_176) — 배포 3c0acbf + 웹훅 재등록 필수(allowed_updates 변경) | 대기 |
| 2026-08-16 | ops/queue-trigger.sh 자기-exec 무한루프 발견·복원 — d3e3d9a에서 진짜 스크립트가 자기 경로를 exec하는 3줄 스텁으로 덮임. 검증된 픽업(58aaa25) 69초 뒤 발생, 이후 msg_176 정체 (원인 확정은 VPS 확인 필요) | ✅ 복원 |
| 2026-08-16 | 재발 방지 — ops/queue-trigger-wrapper.sh.example(저장소 밖 복사용) 분리, exec 전 queue-trigger.log 기록 추가, 테스트 3건(자기exec 금지·ROOT 블록·로그) 11스위트 166건 (12140c4) | ✅ |
| 2026-08-16 | 지시서#21 작성 — 큐로 전달 불가(큐 자체가 막힘), 사람이 직접 전달. STEP1 증거 확보 후 복구 순서 | 대기 |
| 2026-08-16 | 할매봇 #21 중간보고 반영 — 스텁 자기-exec은 pull로 이미 해소(무한루프 프로세스 없음), Hermes cron 실경로는 /opt/data/scripts/queue-trigger.sh(저장소 밖 래퍼)로 확인 | 확인 |
| 2026-08-16 | 기동 실패 시 지시 유실 수정 — seen을 기동 전 저장하던 것을 시도 횟수(tries)로 대체. 성공해야 seen, 실패는 MAX_TRIES(3)까지 재시도 후 포기+경고. msg_176이 이 경로로 묻혔던 건 (fb1ab65) | ✅ |
| 2026-08-16 | 지시서#20 수행 (자동 픽업) — 배포 확정(HEAD 580333c, npm test 11스위트 166건), 웹훅 재등록(--apply, allowed_updates=message,callback_query, 오류 없음), 서버 restart, msg_176 claim | ✅ 완료 |
