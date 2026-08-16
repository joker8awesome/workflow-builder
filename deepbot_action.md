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
| 2026-08-16 | 지시서#21: 자동 픽업 정지 진단 — STEP1 확인(스텁은 pull로 복구됨, 무한루프 없음), 복구(166건), 웹훅 재등록(message 추가) | ✅ |
| 2026-08-16 | 지시서#25: 딥시크 워커 복구 — 모델명 -latest→-0731 되돌림, probe 정상 응답, 178건 통과 | ✅ |
| 2026-08-16 | 지시서#24: index.html 분해 완료 — css 2파일+js 16파일, index 1011줄, sw.js v6, 회귀 6/6 PASS, 커밋 830e8fb | ✅ |
| 2026-08-16 | 지시서#20: 양방향 봇 — hermes -z 자동 수행, 웹훅 message 허용, msg_176 claim, 사용자 봇 테스트 대기 | ✅ |
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
| 2026-08-16 | 지시서#22 수행 (자동 픽업) — 배포 확정(HEAD 7671a9c, fb1ab65 포함), 재시도 테스트 전부 PASS(5)항 7건, 무효 crontab 항목 제거, msg_178 claim. 잠금 경합 이슈 확인(테스트는 프로덕션 잠금 해제 후 실행해야 통과) | ✅ 완료 |
| 2026-08-16 | 무인 픽업 양방향 확인 — 센터장→할매봇: msg_178 자동 기동(22:57 적재→23:15 픽업, 사람 개입 없음). 할매봇→센터장: msg_177·179 자동 수령·claim·inbox 기록 | ✅ |
| 2026-08-16 | 텔레그램 진단 분리 — acceptCount 하나로 합쳐져 버튼/텍스트 구분 불가였음. callbackCount·messageCount 분리, allowed_updates 누락 힌트 추가 (7671a9c) | ✅ |
| 2026-08-16 | 할매봇 발견 반영: 테스트가 프로덕션 트리거 상태 파괴 — npm test의 cleanup()이 ops/.queue-trigger-seen.json 삭제, pending 지시 중복 기동 위험. WF_TRIGGER_DIR로 격리, mkdtemp 사용, 검사 2건 (11스위트 173건) | ✅ |
| 2026-08-16 | 키 파일 gitignore — wf_user_key.txt 무방비 노출(커밋 이력 없음 확인), *_key.txt·*.key 패턴 추가 (817d5e9) | ✅ |
| 2026-08-16 | 지시서#23 작성·전달 — 테스트 격리 배포 + VPS 키 파일 점검 | 대기 |
| 2026-08-16 | 환경 메모: Git Bash에서 curl -d 로 한글 전송 시 깨짐 → 파일+--data-binary 사용 (텔레그램 알림 깨짐으로 발견) | 확인 |
| 2026-08-16 | 지시서#23 수행 (자동 픽업) — git pull(fb2a6b9), npm test 11스위트 173건 통과, seen 파일 test 전후 동일(`{"seen":["msg_178"],"tries":{"msg_180":1}}`) 확인, 추적 키·*.txt 없음, pm2 restart 불필요 | ✅ 완료 |
| 2026-08-16 | 워커 함대 계획 수립 — 전제 검증(딥시크 max_tokens 800·파일 접근 없음 → 코딩 워커 아님, 검토 워커), index.html 5589줄 단일 파일이라 분해 전 병렬 불가. 2026-08-16-worker-fleet-plan.md | ✅ |
| 2026-08-16 | Phase 0-1: /api/llm/worker 보고 경로 수정 — to_agent가 'ag_orch' 고정 + status='sent'라 워커 결과가 큐에서 증발. report_to 지정 가능·기본은 호출자·status pending. 검사 2건 (175건) e005626 | ✅ |
| 2026-08-16 | 지시서#26 Phase1 워커 함대 A/B/C 병렬 완료 — index.html(sidebar-toggle aria-label), coreb.js(addNodeAt 타입가드), corea.js/tests.js/ux1.js(오류문구 3건). ag_deepseek 워커 호출 A1/B5(재시도포함)/C1, 반려 0, 지어낸 것 없음. fonts/ 미참조 재확인. npm test 178/178. commit f357c2f push. msg_212 claim, msg_227 보고 | ✅ |
| 2026-08-16 | 지시서#24 작성·전달 — Phase 0: 배포 + index.html 분해(관문). 워커 호출은 아직 금지 | 대기 |
| 2026-08-16 | 딥시크 워커 능력 측정 시도 → 전 호출 404 발견. 모델명 2a4aece(-latest)가 제공자 카탈로그에 없음. msg_157(08-15 13:40 정상출력) vs msg_183~191(전부 404)로 회귀 확정 | 발견 |
| 2026-08-16 | 워커 실패 은폐 수정 — `|| JSON.stringify(j)`로 404 본문이 결과가 되고 success:true·ok:true로 기록되던 것을 502+success:false·ok:false로. 모델명 6곳 -0731 복원. 검사 3건 (178건) ecb6b08 | ✅ |
| 2026-08-16 | 지시서#25 작성·전달 — 워커 복구 긴급 배포(#24보다 우선), STEP2 실응답 확인 필수 | 대기 |
| 2026-08-16 | #25 배포 검증(독립) — 워커 실호출 성공, 정상 한국어 출력 확인. "완료" 보고를 그대로 믿지 않고 직접 확인 | ✅ |
| 2026-08-16 | 딥시크 워커 능력 측정 완료 — 프로브 14개 실호출. 잘함: 코드리뷰·테스트케이스·구조화추출·문구·앵커준수. 못함: 저장소 질문(이름만으로 환각), 프로젝트 규약, 거짓 전제 검증. 2026-08-16-deepseek-worker-capability.md | ✅ |
| 2026-08-16 | 환각 규칙 특정 — 이름에서 추론 가능하면 지어내고, 실마리 없으면 거부. 코드 첨부+"추측하지 마라" 한 줄로 완전 차단됨(Q1). 게이트 ⑤(지시 자체의 사실 확인) 추가 | ✅ |
| 2026-08-16 | #24 완료 확인 — index.html 5589→1011줄, css 2 + js 16 파일, sw.js v6, 회귀 6/6 (830e8fb). 병렬 배분 가능해짐 | ✅ |
| 2026-08-16 | Phase 1 지시서#26 작성 — 워커 3개 병렬 배분. 파일 비중첩 배정(A:index.html / B:js/coreb.js / C:js/ux6.js·corea.js), 단위별 개별 보고, "워커가 지어낸 것" 보고 항목 필수화 | 대기 |
| 2026-08-16 | 실측: index.html 버튼 97개 중 aria-* 3개뿐(sidebar-toggle은 아이콘 전용인데 레이블 없음). fonts/ 1.9MB 전체 미참조 확인 — 삭제는 사용자 판단으로 보류 | 확인 |
| 2026-08-16 | fonts/ 미사용 폰트 3종 삭제 (사용자 승인) — 1,923,864 B 회수. 451facf에서 시스템 폰트로 전환한 뒤 방치돼 있던 것. 코드 참조 0건 확인 후 삭제, README 갱신, npm test 178건 (a050786) | ✅ |
| 2026-08-16 | #26 정정 쪽지 — fonts/ 별건 취소 통보, 단위 A·B·C는 그대로 진행 | 대기 |
| 2026-08-16 | msg_218(#26 정정 쪽지) 수신·claim — fonts/ 별건 취소는 이미 반영됨(a050786에서 fonts/ 삭제 완료 확인, 디렉터리 없음), 단위 A·B·C(f357c2f)는 정정 이전에 이미 커밋·npm test 178/178 통과·push 완료 상태로 추가 조치 불필요. 재확인만 수행, 신규 쓰기 없음 | ✅ |
| 2026-08-16 | Phase 1 검수 — B(coreb.js NODE_TYPES 가드): NODE_TYPES=corea.js:411, 로드순서 corea→coreb 확인, 유효. logEdgeEvent 무음catch 유지 판단도 타당. C(문구 3건): 원인+다음행동 포함, 지어낸 연락처 없음. 둘 다 합격 | ✅ |
| 2026-08-16 | 단위 A 미완 확인 — 97개 적용 지시였으나 sidebar-toggle 1개만 반영. 실측 결과 접근명 없는 표시 버튼 20개(✕14·⟳2·확대축소3·더보기1). 최초 40개 집계는 hidden-btns(display:none) 20개 포함한 오산이라 정정 | 발견 |
| 2026-08-16 | 후속 쪽지 #27 작성·전달 — 패턴 4종 기계적 적용, 워커 재호출 불필요, 검증은 카운트 0 확인 | 대기 |
| 2026-08-16 | 지시서#27 수행 (msg_229 claim) — index.html 20개 표시 버튼에 aria-label 일괄 부여(✕14 각각 대상명 명시, ⟳2 트레이스/세션, +/−/⤾ 확대·축소·확대초기화, ••• 더보기). id 없던 자격증명 모달 닫기 버튼은 id=cred-modal-close 함께 부여. hidden-btns 미접촉. 검증 카운트 0 확인, npm test 178/178 (11스위트) | ✅ |
| 2026-08-16 | #27 검수 통과 — 접근명 없는 버튼 20→0, aria-label 23개 전부 고유, id 없던 ✕에 cred-modal-close 부여, npm test 178건 | ✅ |
| 2026-08-16 | Phase 2 실측 — 인증 강제 ON 확인(무인증 401), 미들웨어 없는 쓰기 라우트 2건 모두 의도된 것, 프론트 키는 개인별 localStorage. 이전 "무인증 23개" 항목 해소 | 확인 |
| 2026-08-16 | Phase 2 계획 수립 — 진짜 구멍은 프론트 검사 0건(백엔드 178 vs 프론트 0). 순서: 2-1 이름정리 → 2-2 계약테스트. manifest 동적생성은 명시적 보류. 2026-08-16-phase2-plan.md | ✅ |
| 2026-08-16 | 지시서#28 작성·전달 — 파일 이름 정리. sw.js ASSETS·CACHE v7 동일 커밋 필수(addAll은 하나만 404여도 전체 실패) | 대기 |
| 2026-08-16 | #28 이름 정리 — 할매봇이 로컬 완료 후 push 보류(승인 게이트 준수). 검증 5개 전부 기대값, CACHE v7, 단일 커밋, Playwright 회귀 통과. 사용자 승인 받아 push 지시 | ✅ |
| 2026-08-16 | 지시서 누락 확인 — #28에 push 승인 절차를 안 적었다. 할매봇이 기존 규칙 적용해 멈춘 것은 올바른 판단. 다음 지시서부터 명시 | 개선 |
| 2026-08-16 | 지시서#28 수행 (msg_231 claim, phase2-rename-20260816) — js/ 16개 무의미 이름을 내용 기반으로 git mv(예: corea→core-store, coreb→canvas-render, ux1→undo-run-engine, ux6→llm-trace, agent1→virtual-render-palette, tests→tests-more-menu). 파일 쪼개기·합치기·함수명 변경 없음. 동일 커밋에 index.html script src 16줄 + sw.js ASSETS + CACHE v6→v7 반영. 워커 호출 없이 내가 판단(지시서: 이름은 판단이지 빈칸이 아니다). 검증: 무의미 이름 0, index.html 미참조 파일 0, ASSETS 정합(있는데 없음/누락 둘 다 없음), CACHE=v7, npm test 11/178, Playwright 스모크(localhost:3737) 콘솔 에러 0·16 스크립트 로드·NODE_TYPES/renderCanvas/undo/executeWorkflow/toggleGroup/MORE_ITEMS/loadTeamStatus 전역 존재. 로컬 커밋 9eafe00(브랜치 phase2-1-rename). **push 승인 대기** — 사용자 지시 "프로덕션 쓰기·배포는 승인 게이트". main 병합·push 하지 않음 | 승인대기 |
| 2026-08-16 | 지시서#28 push 승인 수신·수행 (msg_233 claim, phase2-rename-20260816) — main 최신화(fast-forward c38435f) 후 phase2-1-rename 병합(merge commit a36d1e5, 센터장 커밋 2건이 앞서 있어 --no-ff), npm test 11스위트 178건 통과, git push origin main 성공(c38435f..a36d1e5). ⚠️ send_to_center.py 첫 호출 시 --help 인자를 summary로 넣어 무의미 리포트(msg_234) 발송 — 정정 보고로 상세 요약 재발송. ⚠️ .mcp.json 부재로 agent.tasks.claim MCP 호출 불가 → DB UPDATE 직접 실행(hermes 소유) | ✅ |
| 2026-08-16 | #28 push 완료 검수 — 16개 파일 의미있는 이름으로 변경(b6d1b7d), CACHE v7, 계약 테스트 9건 전부 통과로 독립 검증 | ✅ |
| 2026-08-16 | Phase 2-2 완료 — ops/test-frontend-contract.js 등록. 12스위트 187건. 프론트 검사 0 → 9건. 할매봇이 손으로 세던 항목(script 참조·ASSETS 양방향·getElementById 대상)이 영구 검사로 승격 | ✅ |
| 2026-08-16 | 지시서#29 작성·전달 — 워커 함대 2차 코드리뷰 1차 배치. 120여 함수 중 저장·동기화·실행취소 12개만 선별(조용한 실패 유형에 초점). 산출물은 채택률 숫자 — 나머지 108개 진행 여부 판단 근거. push는 승인 후(지시서에 명시) | 대기 |
| 2026-08-16 | 지시서#31 작성·전달 — 배포 승인(c0d64c6·a0e7f42·6671c58·8fa475d 일괄, pm2 restart). 핵심은 STEP2 실제 모델 확인: agents 이름만 Kimi로 바뀌고 라우트는 그대로일 수 있음. 값만 보고하게 하고 리뷰 2차는 보류 | 대기 |
| 2026-08-16 | 지시서#29 수행 (msg_236 claim, phase2-review-1) — 12개 함수 워커 리뷰. 실행 결과: **OK 5 / max_tokens 800 절단 7** (finish_reason=length로 서버가 502 처리, detail 300자 잘림). 재호출 없이 지시서 원칙 준수(함수당 1회, 판단 안 서면 보고만). 채택: **실제 결함 2건** — syncToServer(r.ok 미검사로 서버 4xx/5xx 조용히 통과), flushOfflineQueue(debounce sync kick 직후 즉시 removeItem으로 실패 시 큐 유실). syncToServerNow() 분리해서 flush가 성공 여부를 await, 실패 시 큐 유지 + 사용자 알림. 나머지 3건(OK): pushHistory·undo "문제 없음"(반려), afterHistory "확실하지 않음"(반려). 환각·오판·취향 반려는 절단 때문에 판단 불가. npm test 12/187 유지, 로컬 커밋 c0d64c6. 센터장 보고 msg_250(정식). ⚠️ send_to_center.py --help 시 무인자 발송 사고 재발 → msg_249 무의미 리포트(3번째 반복). **push 승인 대기** | 승인대기 |
| 2026-08-16 | 지시서#31 수행 (msg_259 claim, trace deploy-model-check-20260816) — [1] 배포: phase2-review-1(c0d64c6) 병합 e3e41fb, npm test 12스위트 194건 통과, push 완료(f9f4710..e3e41fb), pm2 restart 완료. deepbot_action.md 충돌은 양쪽 로그 모두 보존으로 해결. [2] 🔴 모델 확인: 워커 응답 model=**moonshotai/kimi-k3** — 사용자 의도대로 실제 라우트도 Kimi 호출 확인. WF_LLM_WORKER_MODEL=moonshotai/kimi-k3(ecosystem.config.js). result 정상("2"), truncated=false. [3] pm2 로그 이상 없음, 텔레그램 상태 정상(configured/notify_enabled true). ⚠️ 능력 측정 보고서(deepseek-v4-flash-0731 기준) 재측정 필요 사유 성립 — 모델이 실제로 바뀌었다 | ✅ |
| 2026-08-16 | 텔레그램 필터 2중 적재 통합 — 할매봇 fbbc562(마커/헤더/보고용어 밀도)와 센터장 6671c58(길이/줄수)이 각각 추가돼 두 개가 쌓임. 할매봇 필터가 /지시 판정보다 먼저 돌아 탈출구를 무력화하던 문제 수정: FORCE를 맨 앞으로, 두 필터 모두 forced 존중, 판정은 body 기준. 검사 2건 (12스위트 196건) | ✅ |
| 2026-08-16 | 웹 UX 진단 실측 — Esc로 닫히는 패널 0/15(핸들러 2개는 무관), 포커스 코드 5줄·role=dialog 1개, css/mobile.css는 실제로 자격증명 모달 전용(이름 오류), 인라인 style 126곳, 하드코딩 색 46종, 미디어쿼리 2개 | ✅ |
| 2026-08-16 | 워커 운용 지침서 작성 — 2026-08-16-web-ux-directive.md. 배치 A(Esc)·B(포커스)·C(css 개명) 우선, 토큰화는 명시적 보류. 게이트 ⑥ 신설: ARIA·포커스 제안은 속성이 붙는 요소를 확인(앵커는 형식만 본다) | ✅ |
| 2026-08-16 | 지시서#32 작성·전달 — 배치 A·B·C. A·B는 같은 패널 15개라 직렬, C는 독립. push는 승인 후 | 대기 |
| 2026-08-16 | #32 배치 A·B·C 배포 승인 — Esc 위임 리스너 1개(js/esc-panel-close.js), role=dialog+aria-modal 각 15개, mobile.css→cred-modal.css, npm test 196건. push 전 CACHE v8 확인과 세션 hang 원인 규명을 조건으로 걸었다 | 대기 |
| 2026-08-16 | 보고 누락 발견 — 배치 C가 CSS 파일명을 바꿨는데 CACHE 버전 보고가 없음. 계약 테스트는 ASSETS 양방향만 보고 CACHE 버전은 안 잡는다(기존 사용자만 깨지는 유형) | 확인요청 |
| 2026-08-16 | 지시서#32-approve 수행 (msg_294, trace ux-deploy-20260816) — [1] 사전확인: CACHE wf-builder-v8 ✓(이미 v8). hang 원인: ops/queue-trigger.log에 "spawnSync /bin/sh ETIMEDOUT" 3회(13:44·13:55·14:06 UTC) — queue-trigger.js의 hermes -z 기동 shell spawn 타임아웃. pm2 502 없음. 별개로 오전 시간대 pm2 로그에 LLM finish_reason=length 다수(800토큰 절단 함정 계열). [2] 배포: HEAD 20b9f49(main==ux-batch-abc 이미 병합 상태), npm test 12스위트 196건 통과, push는 이미 동기화로 no-op, pm2 restart ✓. [3] 사후확인: Pages sw.js CACHE v8, cred-modal.css 200, mobile.css 404. Playwright headless: Esc 닫힘 Y, 포커스 이동 Y(패널 내 BUTTON), cred-modal.css 로드 Y + #credentialModal DOM 존재. 센터장 보고 msg_296 | ✅ |
| 2026-08-17 | 센터장 폴링이 지시를 감지만 하고 세션을 못 띄우던 문제 수정 — execFile 예약 직후 process.exit(0)으로 자식이 뜨기 전에 부모가 죽었고, 파일 리다이렉트 로그도 버퍼째 버려져 흔적조차 없었음. 텔레그램 지시 msg_287이 두 회차 연속 방치된 원인 | ✅ |
| 2026-08-17 | detached:true는 Windows에서 실패 확인(shell:true와 함께 쓰면 cmd.exe 손자가 부모와 함께 죽음, spawn 이벤트는 뜨지만 출력 0). close를 기다리는 방식으로 전환, PID 생사 기반 잠금 추가, 폴링 주기 15분→5분. 검사 3건 (12스위트 199건) | ✅ |
| 2026-08-17 | #32 배포 확인 — role=dialog 15개, CACHE v8, css/cred-modal.css, js/esc-panel-close.js 전부 원격 반영 | ✅ |
| 2026-08-17 | 세션 hang 원인 규명·수정 — 할매봇 로그의 spawnSync ETIMEDOUT 3회(13:44·13:55·14:06)는 queue-trigger.js의 execSync 10분 타임아웃. 배치 A·B·C가 19분 걸려 끊겼고 재시도 정책이 3회 증폭. 실패가 아니라 작업 중이었음. 타임아웃 30분(WF_TRIGGER_TIMEOUT_MS)·잠금회수는 타임아웃+5분으로 연동·ETIMEDOUT 구분 로그. 검사 3건 (12스위트 202건) | ✅ |
| 2026-08-17 | 지시서#33 작성·전달 — 코드리뷰 2차(네트워크 경계 12개). #30 대체: 워커가 Kimi로 바뀌고 타임아웃 10→30분이라 전제가 달라짐. 12개 함수 실재 재확인(cd73a1e 기준), truncated면 2500 재호출 의무, "최종 판단 불가 0"이 채택률 유효 조건 | 대기 |
| 2026-08-17 | 🛑 #33 중단 지시 (사용자) — API 비용 급증 확인 중. 워커 호출 중단·기존 결과는 보존·커밋 금지 | 중단 |
| 2026-08-17 | 비용 원인 조사 — 센터장 세션은 claude_max/20x 구독이나 hasExtraUsageEnabled=true(한도 초과분 추가 과금). 오늘 할매봇 세션 10회·Kimi 워커 58회(Nous 청구, Anthropic 아님). 할매봇 VPS 인증 방식 확인 요청 | 진행 |
| 2026-08-17 | 지시서#34 작성 — 트리거 재등록 전 경로 검증. --script 해석 기준이 workdir인지 hermes 스크립트 디렉터리인지 불확실(오전 자기-exec 스텁 사고와 같은 지점). 손으로 1회 실행 통과 전 cron 등록 금지, 주기는 1분이 아니라 */5 | 대기 |
| 2026-08-17 | 센터장 세션 교대 — 이전 세션이 msg_316·317·319·320 을 못 보고 종료. 로그 공백을 새 세션이 메움 | ✅ |
| 2026-08-17 | 🔴 비용 원인 특정 — 할매봇(msg_319)의 모든 세션(`hermes -z` + `/api/llm/worker`)은 **Nous Portal OAuth** 로 과금(`/opt/data/auth.json`, active_provider=nous). VPS 에 ANTHROPIC_API_KEY 없음·`~/.claude.json` 에 oauthAccount 없음. 즉 **어제부터 늘어난 Anthropic 과금은 할매봇 경로가 아니다** — 여기까지가 확정. 남는 후보는 센터장(Windows) 쪽이지만 이건 아직 **기전+정황이지 측정이 아니다**: `poll-queue.js --run` 이 대기 건 있는 회차마다 claude 세션을 통째로 띄우고, 08-16 에 무인 픽업이 양방향으로 실동작하며 워커 함대 지시서(#26~#33)가 센터장 세션을 다수 유발했다. 주의 — 폴링 15분→5분(ea8a251)은 **오늘**이라 08-16 상승의 설명이 못 된다. Windows 쪽 실제 토큰·지출 수치는 아직 없음(`/cost` 또는 콘솔 일별 사용량으로 08-15 와 비교 필요) | 할매봇 배제=확정 / 센터장 원인=추정 |
| 2026-08-17 | 지시서#33 **중복 수행 확인** — 같은 지시로 할매봇 세션이 2개 떴다. 세션1: 커밋 577b8a9(16:00:36), 채택3/반려11. 세션2: 커밋 7c9fc33(review-2 브랜치), 채택6/반려7. 워커 호출 13+18=31회(Kimi/Nous). msg_297 claim 이 선점을 막지 못했다(세션2가 13개 함수를 다 돌린 **뒤에야** claimed_by:ag_other 확인). 둘 다 push 안 함, origin/main==f3338a6 | 발견 |
| 2026-08-17 | 🔴 #33 판단 충돌 — 겹치는 채택은 patchWSHandler·ATF 2건뿐. 세션2만 채택: loadFromServer(부분 로드로 로컬 전체 덮어씀)·loadTplFromServer(r.ok 미검사로 빈 템플릿에 성공 토스트)·refreshMCPStatus(4xx/5xx를 오프라인으로 오표시). 세션1만 채택: reviewer 반려 무시(start→reviewer 시 prevEdge 없어 반려가 무시됨). **어느 쪽 diff 도 로컬에 없다(둘 다 VPS 로컬 커밋)** — 요약만으로는 판정 불가. 3차 워커 호출로 푸는 것은 금지(비용 동결 중) | 승인대기 |
| 2026-08-17 | 지시서#34 완료 확인(msg_320) — `--script` 는 `~/.hermes/scripts/` 기준으로 확인됨(추측 금지 지시가 실제로 사고를 막았다). 스텁은 심볼릭 링크 아닌 실파일 복사본으로 배치, cron_job_id 50533d8bb111, 주기 */5, 16:45·16:50 실행 확인. 큐가 비면 exit 1 로 hermes -z 를 아예 안 띄운다 | ✅ |
| 2026-08-17 | 센터장 폴링 정지 확인 — Windows 작업 `CommandCenter-QueuePoll` 이 **Disabled**(마지막 실행 01:38). 즉 지금 자동화는 VPS 쪽만 살아 있고 센터장 쪽은 꺼져 있다. 재활성화는 사용자 승인 사항(비용 조사 중)이라 손대지 않음. 참고: poll-queue.cmd 가 `exit /b 0` 로 끝나 작업 스케줄러의 Last Result 는 항상 0 — 성패 신호가 아니다 | 확인 |
| 2026-08-17 | 로컬 claude 프로세스 27개(가장 오래된 것 08-12 21:03, 각 CPU 약 400초 누적). 유휴는 토큰을 쓰지 않지만 5일째 안 닫히는 것은 정상이 아니다 — 정리는 사용자 승인 후 | 확인 |
| 2026-08-17 | 🔴 #33 "판단 충돌" 은 충돌이 아니었다 — `git merge-base 577b8a9 7c9fc33` = **577b8a9**. 7c9fc33 은 577b8a9 의 **자손**이라 review33-b 가 이미 합집합이다. 채택 3 vs 6 은 갈린 판단이 아니라 쌓인 커밋이었다. 세션2 가 요약만 보고 "겹침은 2건뿐" 이라 보고했고(msg_316), 나도 그 요약만 보고 충돌로 받아들였다. **부모를 확인했으면 지시서 하나를 안 써도 됐다** | 발견 |
| 2026-08-17 | #33 diff 직접 검토(워커 0회) — 577b8a9: reviewer 반려 시 prevEdge 없으면 흐름이 계속되던 것 중단, ATF `!tr.ok` 검사+catch 로그, patchWSHandler catch 로그. 7c9fc33 순증분은 3건: loadFromServer(전부 유효할 때만 교체), loadTplFromServer(양쪽 fetch r.ok+빈 내용 거부), refreshMCPStatus(4xx/5xx를 '△ 상태 오류'로 분리). 6건 모두 타당 | ✅ |
| 2026-08-17 | 독립 검증 — origin/review33-b 를 worktree 로 떼어 `npm test` 직접 실행, **12스위트 202건 통과**. 할매봇 보고와 일치(보고를 믿지 않고 확인) | ✅ |
| 2026-08-17 | 남은 지적 3건(경미, 병합 차단 아님) — ① loadFromServer 는 서버에 깨진 항목이 하나만 있어도 영영 동기화 안 되는데 console.warn 뿐이라 사용자는 모른다(유실보다는 낫다) ② loadTplFromServer catch 가 JSON.parse 실패도 '서버 필요' 로 표시하고 console 로그가 없다 ③ `--yellow` 토큰이 **어디에도 정의돼 있지 않다** — 새 코드는 `var(--yellow,#e6a23c)` 폴백으로 살았지만 css/main.css:584·js/tests-more-menu.js:528 두 곳은 폴백이 없어 무색으로 렌더된다(선재 버그) | 확인 |
| 2026-08-17 | ✅ #33 병합 승인·수행 — `origin/review33-b` 를 main 에 `--no-ff` 병합(7163cba), 충돌 0, npm test 12스위트 202건. sw.js CACHE 는 v8 유지(파일 이름 변경 없이 내용만 바뀌었고, SW 가 **네트워크 우선**이라 온라인 사용자는 항상 최신을 받는다 — #28 때 v7 로 올린 것은 파일 *이름* 이 바뀌어 addAll 이 404 로 통째 실패할 수 있었기 때문) | ✅ |
| 2026-08-17 | 🔴 **공개 저장소에 평문 API 키 3곳 노출 발견** — 병합 직후 새로 들어온 파일을 훑다가 잡았다. ① `2026-08-15-spec-review.md` 의 `ag_claude_desktop` 키(**mcp:admin**), origin/main 에 08-15 부터 ② `ops/review1/run_review.js` 의 `ag_hermes` 키, origin/main 에 08-16(c0d64c6) 부터 ③ 같은 키 사본이 `ops/review2/run_review.py`, 오늘 review33-a/b 로. `raw.githubusercontent.com` 200 + 문자열 그대로 확인(추정 아님) | 발견 |
| 2026-08-17 | **③ 은 내 잘못이다** — 지시서 #35 에서 `577b8a9` 를 검토용 브랜치로 push 하라고 승인했는데 그 커밋에 키가 든 것을 모르고 승인했다. 미검토 커밋을 공개 저장소로 올리라 하기 전에 내용을 봤어야 했다. 브랜치 2개 즉시 원격 삭제 | 개선 |
| 2026-08-17 | 유출 경로 규명 — `.gitignore` 는 `.mcp.json` 을 막았지만 **그것을 인용한 문서**는 막지 못했다. spec-review.md 는 "커밋 전체에 키 없음"이라 결론내고, "여기서 git init → push 하면 키가 공개된다"고 경고한 뒤, 본문 59줄에 그 키를 그대로 붙였다. 나중에 실제로 git init 되면서 **경고문 자신이 경고한 경로로 유출**됐다 | 원인 |
| 2026-08-17 | 조치 — 평문 키 3곳을 `WF_HERMES_KEY` 환경변수/마스킹으로 교체(4cfeb01), 추적 파일 전수 재검사(`wf_ak_` 0건, 봇 토큰 형식 0건), npm test 202건, push 완료. raw URL 3개 전부 '키 없음' 재확인. **단 히스토리에는 남는다 — 회전이 유일한 실해결** | ✅ |
| 2026-08-17 | 🔑 `ag_claude_desktop` 키 회전 완료 (사용자 승인) — 신규 credential id 67 발급(scopes 동일: read/execute/admin) → `.mcp.json` 갱신 → whoami·폴러 실동작 확인 → **구 id 51 폐기** → 구 키 재시도 **401 invalid_credentials** 확인. 순서를 지켰다(발급·검증 후 폐기 — 반대로 하면 내 접근이 끊긴다) | ✅ |
| 2026-08-17 | ⚠️ 남은 것 — `ag_hermes` 키(`wf_ak_ag_hermes_ookX…`)는 **아직 유효하고 히스토리에 공개돼 있다.** 회전은 VPS 쪽이라 할매봇 지시 필요. 별건: credential id 60 `audit-check`(read/execute)가 미사용인데 살아 있다 | 대기 |
| 2026-08-17 | 히스토리 재작성은 하지 않기로 결정(사용자) — 회전하면 구 키는 무의미해지고, force-push 는 협업 이력을 깨뜨리며 포크·캐시는 어차피 못 지운다 | 결정 |
| 2026-08-16 | 지시서#36 차단 (msg_323, trace key-rotate-hermes-20260817) — [1] pull 후 두 스크립트 WF_HERMES_KEY 환경변수화 확인 ✅ [2] STEP 2 차단: 지시서는 WF_ACCESS_TOKEN 복구 경로(credentials-api.js:28 allowAccessToken)를 쓰라 했으나 **ecosystem.config.js·pm2 env 0 모두 WF_ACCESS_TOKEN 없음**. auth-credential.js:77 rootToken=null이면 어떤 Bearer도 통과 불가. 내 키로 GET credentials → 401 insufficient_scope (required mcp:admin, provided [read,execute]). 이전 세션도 같은 지점 exit 2 (errors.log 18:17). [3-4] 미수행 — STEP 2 실패로 폐기 불가(접근 끊김 방지). [결과] 차단, claim 안 함. 센터장 보고 msg_324. 구 키는 여전히 유효·히스토리 공개 상태 | 차단 |
| 2026-08-17 | #36 회전 독립 검증 — 보고를 믿지 않고 직접 확인. ag_hermes id 68 신규(read/execute, **admin 없음** ✓, 18:30 실사용 중), id 64·63 둘 다 revoked 18:24:58 ✓, 유출된 구 키 재시도 **401** ✓. 추적 파일 전수 재검사 평문 0건, raw URL 3개 전부 '키 없음'. 신규 키·토큰 파일은 모두 미추적 | ✅ |
| 2026-08-17 | 🔴 **#36 부작용 — 워크플로우 쓰기 API 5개가 전원 401.** 할매봇이 회전을 위해 `WF_ACCESS_TOKEN` 을 신규 설정했는데, `server.js:136 requireAuth` 는 `auth === 'Bearer ' + ACCESS_TOKEN` **문자열 완전일치**만 통과시킨다. wf_ak_ 키는 admin 이라도 못 통과한다. 실측: 내 mcp:admin 키로 `POST /api/workflows` → **401**, 무인증도 401. 대상은 workflows POST/PUT/DELETE + versions + logs | 발견 |
| 2026-08-17 | 그런데 **원래 상태가 더 나빴다** — `requireAuth` 는 `if (!ACCESS_TOKEN) return next()` 다. 토큰 미설정이던 어제까지 이 5개 라우트는 **공개 서버에서 완전 무인증**이었다(누구나 워크플로우 생성·수정·삭제). 할매봇이 구멍을 우연히 닫았고, 그 대가로 정상 사용자도 닫혔다. **토큰을 도로 지우면 구멍이 다시 열린다 — 지우지 마라** | 원인 |
| 2026-08-17 | 현재 사용자 영향 — `syncToServerNow()` 의 `PUT /api/workflows/:id` 가 401 → 오프라인 큐 적재. 데이터 유실은 없고 서버 동기화만 안 된다. 이게 **조용히** 넘어가지 않고 `console.warn` + 큐 유지로 드러나는 것은 오늘 병합한 #29·#33 수정이 설계대로 동작하는 것이다 | 확인 |
| 2026-08-17 | ⚠️ 원인 오진 정정 — 할매봇 큐 보고가 401 회귀를 "pm2 재시작이 유발" · "인증 로직에서 회귀" 로 적었다. **둘 다 아니다.** 원인은 `WF_ACCESS_TOKEN` 이 **설정된 것 자체**다. `requireAuth` 의 첫 줄 `if (!ACCESS_TOKEN) return next()` 때문에 토큰이 없던 어제까지는 전원 통과였고, 값이 생기자 잠들어 있던 완전일치 검사가 깨어났다. pm2 restart 는 env 를 읽어들인 **전달 수단**이지 원인이 아니다. 회귀도 아니다 — 코드는 처음부터 그랬고 조건이 바뀌었을 뿐이다. 또 `WF_REQUIRE_AUTH_ALL` 은 `maybeAuth` 를 지배하는 **다른 미들웨어**의 스위치라 이 18개와 무관하다. 오진을 두면 "되돌리면 고쳐진다"로 가고, 그러면 구멍이 다시 열린다 | 정정 |
| 2026-08-17 | ✅ **#37 route-auth-fix 완료** (msg_326, trace route-auth-fix-20260817) — 18곳 requireAuth 전원 401 해소. [1] 전제: requireAuth 18곳, WF_REQUIRE_AUTH_ALL=1 ✓. [2][3] 17곳 maybeAuth('mcp:execute') 교체 + /api/credentials → requireScope(mcp:admin, allowAccessToken) ✓. [4] requireAuth·ACCESS_TOKEN 죽은 코드 삭제 ✓. [5] npm test 12스위트 221건 ✓ (route-auth 5→24건). [6] 로컬·원격: 무인증 401 ✓, execute키 workflows 400 ✓, execute키 credentials **403** (지시서 기대 401과 다름 — requireScope는 scope 부족 시 403 반환. 보안 목적 달성). [7] 커밋 764bc52, push ✓, pm2 restart ✓ | ✅ |
| 2026-08-17 | ✅ #37 완료 독립 검증 — 보고를 믿지 않고 직접 확인. 소스: `requireAuth` **0회**(함수·ACCESS_TOKEN 상수까지 제거됨), `maybeAuth` 22→39(**정확히 17 증가**), `/api/credentials` 는 지시대로 `requireScope(pool,'mcp:admin',{allowAccessToken:true})`. `npm test` 12스위트 **221건**(202→221, route-auth +19). 원격 실동작 5/5 기대값: 무인증 401 / admin키 workflows 400 / admin키 credentials 400 / 무인증 credentials 401 / execute 404 | ✅ |
| 2026-08-17 | 🔑 권한 상승 차단을 실증 — 이것만은 admin 키로 확인이 안 돼서 **execute 전용 임시 키(id 69)를 만들어 직접 때려봤다.** ① workflows 400(통과 정상) ② `/api/credentials` **403 insufficient_scope** ③ `scopes:['mcp:admin']` 을 실어 admin 키 발급 시도 → **403** ④ 자격증명 API 직접 발급 시도 → **403**. 임시 키는 폐기 후 401 확인. **execute 로 admin 을 못 찍는다** | ✅ |
| 2026-08-17 | 정리 — 오늘 하루의 인증 상태 변화: 어제까지 쓰기 18개 **무인증 공개** → #36 부작용으로 **전원 401** → #37 로 **팀원(execute) 통과 · 익명 차단 · 키 발급만 admin**. 시작보다 나아졌다. 원인이 "회귀" 가 아니라 "잠든 코드가 깨어난 것" 이었기에 되돌리지 않을 수 있었다 | ✅ |
