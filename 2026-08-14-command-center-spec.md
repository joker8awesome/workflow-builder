# 커멘드센터 (Command Center) — 시스템 스펙 & 구축 현황

작성일: 2026-08-14
프로젝트: 워크플로우 빌더 → **커멘드센터** (사용자 명명)
저장소: github.com/joker8awesome/workflow-builder (커밋 81개)
GitHub Pages: https://joker8awesome.github.io/workflow-builder/

---

## 1. 개요

AI 에이전트 협업을 위한 워크플로우 오케스트레이션 플랫폼.
웹 UI에서 워크플로우를 설계하고, 15개 에이전트 팀이 역할 기반으로 협업하며,
외부 AI 세션(Claude Code 등)이 MCP로 참여할 수 있는 시스템.

---

## 2. 기술 스택

| 계층 | 기술 |
|------|------|
| 프론트엔드 | 단일 HTML (index.html 5,589줄) — Vanilla JS, SVG, PWA |
| 백엔드 | Node.js + Express (server.js 1,739줄, **API 84개**) |
| DB | PostgreSQL 17 (/opt/data/pgdata, odds DB) |
| 에이전트 실행 | Python (agent_orchestrator.py, mcp_server.py, agent_sdk.py) |
| 실시간 | WebSocket (/ws 웹 + /ws/agent 에이전트 브릿지) |
| 스케줄링 | scheduler.py + Hermes cron |
| MCP | Streamable HTTP (POST /mcp) — 12개 툴 |
| 외부 노출 | https://187.127.124.16.sslip.io/mcp (Let's Encrypt + traefik) |
| 폰트 | 이사만루 3종 (로컬) |
| 배포 | GitHub Pages(정적) + 로컬 VPS(풀 기능) |

---

## 3. 에이전트 팀 (팀 15명 + 운영 4 = 19)

| ID | 이름 | 역할 | 색상 |
|----|------|------|------|
| ag_orch | 오케스트레이터 | 팀 총괄·분배·수렴 | #00ff87 |
| ag_researcher | 리서처 | 조사·수집·요약 | #4da3ff |
| ag_analyst | 분석가 | 데이터 분석·인사이트 | #8957e5 |
| ag_writer | 콘텐츠 작가 | 문서·보고서 작성 | #ff8a5c |
| ag_reviewer | 검토자 | 품질 검증·피드백 | #0d9488 |
| ag_collector | 데이터 수집가 | 웹/API 수집·정제 | #f78166 |
| ag_developer | 코드 개발자 | 코드 작성·수정 | #1f6feb |
| ag_tester | 테스터 | 테스트·회귀 검증 | #e26dd4 |
| ag_designer | 디자이너 | UI/UX 설계 | #ffc24d |
| ag_security | 보안 담당 | 취약점·PII 보호 | #ff5d5d |
| ag_communicator | 커뮤니케이터 | 외부 보고·알림 | #00b8d9 |
| ag_scheduler | 스케줄러 | 일정·크론·마감 | #7c8db5 |
| ag_integrator | 통합 담당 | MCP·API 연동 | #9a7dff |
| ag_archiver | 아카이버 | 기록·버전·지식 | #6c8e5a |
| ag_auditor | 감사자 | 감사·준수 | #c9a227 |

각 에이전트 워크스페이스: /opt/data/agents/<id>/ (input/output/logs/workspace.md)

**팀 15명 외 등록 에이전트 (2026-08-15 기준 총 19)**

| ID | 역할 |
|----|------|
| ag_claude_desktop | 센터장 — Claude Code 세션 (MCP 커넥터) |
| ag_hermes | 할매봇 — VPS 배포·운영·검증 |
| ag_deepseek | 딥시크 워커 — LLM 분석·요약 |
| ag_user_* | 웹 UI 사용자 (owner 로 실명 귀속) |

`capabilities` / `tools` / `trust_score` 는 `agents.machine` (JSONB) 에 저장한다.
전용 컬럼은 없다. `agent.list(capability=...)` 로 필터링된다.

---

## 4. 협업 구조

### 상호 프로토콜 (역할 기반 라우팅)
- `GET /api/team/next/:agentId` — 다음 담당자 추천
- 예: 작가→검토자→오케스트레이터
- 수신 허용 규칙 정의 (TEAM_ROUTES)

### 세션 & 메시지
- agent_sessions (id/agent_id/status/workspace)
- agent_messages (msg_type: command/instruction/report, status, trace_id, payload_ref)
- 체크포인트 (agent_checkpoints) + 스팬 (agent_spans)

### 팀 상태 대시보드
- `GET /api/team/status` — 15명 세션/활성/대기 메시지
- 웹 UI `🤝 팀` 패널 — 실시간 상태 ●○

---

## 5. MCP 외부 연결

### 엔드포인트
```
POST https://187.127.124.16.sslip.io/mcp  (Bearer 인증)
GET  /.well-known/mcp-server-card
```

### 툴 12개
- 워크플로우: workflow.list/execute/get_status/get_trace
- 에이전트: agent.whoami/list/send_message/tasks.list_pending/tasks.claim/payload.get/report/checkpoint

### 클라이언트
- Claude Code CLI (.mcp.json + Bearer 헤더) — 실사용 경로
- Claude Desktop Custom Connector — https 필수 + OAuth 한계로 제한적

---

## 6. 핵심 기능 (고도화 15차+)

```
1차  에이전트 레지스트리·할당       9차  자동화(크론/오프라인/메모리)
2차  핸드오프·격리·상태             10차 관찰성(볼트/트레이스/차트)
3차  HITL·평가·지식                11차 효율(리뷰어/비용/온보딩)
4차  세션 메시징                   12차 거버넌스(PII/신뢰/시뮬레이션)
5차  A2A급(트레이스/체크포인트)      13차 UX 진화(점진적 위임)
6차  플랫폼(키/감사/마켓/캐시)      14차 사용자 UX(온보딩/접근성)
7차  Agent UX(피드/신뢰도/알림)     15차 운영(폴백/DR/벤치마크)
8차  병렬/테스트/회귀 게이트         16차 MCP·외부 AI 세션 연동
                                    UX  노드 팔레트/마퀴/플로팅바/스냅가이드/필터
```

### UX 요소 (한글 기반)
- 노드 팔레트 (드래그 앤 드롭 9종) · 플로팅 액션 바 · 마퀴 선택
- 스냅 가이드 · 복사/붙여넣기(Ctrl+C/V) · 상태 사이클(대기/진행/검토/완료/블로커)
- 결과 미리보기 · 유효성 경고 ⚠ · 단축키 카테고리 · 상태 필터
- MCP 지시 패널 (🤖 버튼) · 팀 대시보드 (🤝 버튼) · 토스트 우상단

---

## 7. 워크플로우 템플릿 (6종)

| ID | 이름 |
|----|------|
| wf_workspace | 첫 워크스페이스 (시작→종료) |
| wf_tpl_research | 에이전트 리서치 (수집→판단→보고) |
| wf_tpl_review | AI 콘텐츠 검토 (초안→검토→승인→배포) |
| wf_tpl_team | **팀 오케스트레이션** (감독→병렬→검토→보안→승인→보고→감사) |
| ex_content | 콘텐츠 제작 |
| ex_data | 데이터 처리 |
| ex_approval | 승인 프로세스 |

---

## 8. DB 스키마 (26 테이블)

| 테이블 | 용도 | 레코드 |
|--------|------|--------|
| wf_workflows | 워크플로우 | 50 |
| wf_versions | 자동 버전 | - |
| wf_runlogs | 실행 로그 | - |
| wf_results | 실행 결과 | - |
| wf_tests | 테스트 스위트 | - |
| wf_knowledge | 공유 지식 | - |
| wf_approvals | 승인 감사 | - |
| agents | 에이전트 | 26 |
| agent_sessions | 세션 | 19 |
| agent_messages | 메시지 | - |
| agent_checkpoints | 체크포인트 | - |
| agent_spans | 트레이스 | - |
| agent_credentials | 자격증명 (SHA-256 hash) | 2 (실사용) |
| audit_logs | 감사 로그 | - |
| wf_templates | 템플릿 마켓 | - |
| llm_cache | semantic cache | - |

---

## 9. 운영 상태

| 항목 | 상태 |
|------|------|
| pm2 (workflow-builder) | online |
| scheduler.py | 30초 폴링 |
| Hermes cron | wf-daily-backup(02:00) · wf-weekly-report(월 09:00) |
| HTTPS MCP | https://187.127.124.16.sslip.io/mcp (Let's Encrypt) |
| 방화벽 | Hostinger 80/443/3737 허용 |
| CORS | GitHub Pages + localhost 제한 |
| 백업 | wf_backup.sh + cron |

---

## 10. 보안

| 항목 | 상태 |
|------|------|
| MCP 인증 | Bearer 키 (SHA-256 hash 저장) |
| CORS | 허용 오리진 제한 |
| XSS | 이스케이프 + 조건식 프로토타입 차단 |
| SQL | 준비문 ($1 파라미터) |
| PII | 레드액션 필터 |
| 시크릿 볼트 | AES-256-CTR |
| SSRF | 내부 IP 차단 |
| 속도 제한 | 분당 60회 |
| 키 관리 | wf_ak_ 발급/회전/폐기 · .gitignore 제외 |

---

## 11. VPS 용량 (15개 세션 운영 타당성)

| 항목 | 값 |
|------|-----|
| CPU | 4 vCPU (EPYC 9354P) |
| 메모리 | 15GiB (사용 2.3GB) |
| 디스크 | 193GB (7%) |
| 판정 | ✅ 15개 세션 충분 (여유 70%) |
| 유일 제약 | 외부 LLM API 응답 속도 |

---

## 12. 환경 변수 / 실행 명령

### 환경 변수 (실측 20종)

**DB 접속** — 미설정 시 VPS 기본값(유닉스 소켓). 로컬 개발은 반드시 설정해야 한다.

| 변수 | 기본값 |
|------|--------|
| `DATABASE_URL` | — (있으면 우선) |
| `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` | `/opt/data/pgdata` · `hermes` · `odds` |

**서버·인증**

| 변수 | 역할 |
|------|------|
| `PORT` | 3737 |
| `WF_ACCESS_TOKEN` | 편집 API 보호 토큰. 미설정 시 인증 없이 통과 |
| `WF_ALLOWED_ORIGINS` | CORS 허용 오리진 (기본: GitHub Pages + localhost) |
| `WF_VAULT_KEY` | 시크릿 볼트 AES-256-CTR 키. **미설정 시 공개 저장소의 리터럴이 쓰인다** |
| `WF_REQUIRE_AUTH_ALL` | `1` 이면 변경 API 20개에 `mcp:execute` 요구 |
| `WF_APPROVALS_AUTH` | `1` 이면 `/api/approvals` 에 인증 요구 |

**승인·알림**

| 변수 | 역할 |
|------|------|
| `WF_APPROVAL_REQUIRED` | 사람 승인이 필요한 작업 목록 (쉼표 구분). 미설정 시 넓게 |
| `WF_TELEGRAM_TOKEN` | 봇 토큰. **커멘드센터 전용 봇을 쓸 것** (아래 주의) |
| `WF_TELEGRAM_CHAT_ID` | 알림 수신 채팅 |
| `WF_TELEGRAM_WEBHOOK_SECRET` | 웹훅 위조 방지. 없으면 서버가 모든 콜백을 거부 |
| `WF_PUBLIC_URL` | 웹훅 등록용 공개 https 주소 |
| `WF_SCHEDULER_KEY` | `scheduler.py` 가 `/api/approvals` 호출에 쓰는 키 (ag_scheduler) |

**MCP·기타**

| 변수 | 역할 |
|------|------|
| `WF_MCP_OPEN` | `1` 이면 **Bearer 없이 mcp:admin 부여**. 운영에서 절대 설정 금지 |
| `WF_MCP_STRICT_HEADERS` | MCP 헤더 엄격 검사 |
| `WF_LLM_WORKER_MODEL` | 딥시크 워커 모델 (기본 `deepseek/deepseek-v4-flash-0731`) |

> ⚠️ **텔레그램 봇 주의**: 한 봇 토큰에 webhook 과 getUpdates(롱폴링)를 동시에 쓸 수 없다.
> Hermes 게이트웨이가 롱폴링을 도는 토큰을 공유하면 웹훅이 조용히 해제되어
> 승인 버튼이 먹통이 된다. 커멘드센터는 **전용 봇**을 쓴다.

> `.env.example` 에 전체 목록과 설명이 있다. `server.js` 는 `.env` 를 자동으로 읽지 않는다.

### 실행 명령

```bash
# 서버 실행
npx pm2 start server.js --name workflow-builder

# 오케스트레이터
./.agentenv/bin/python agent_orchestrator.py --workflow <id> --run

# MCP 서버 (Python)
./.agentenv/bin/python mcp_server.py --sse 8787

# 검증 venv
PLAYWRIGHT_BROWSERS_PATH=/opt/data/.cache/ms-playwright ./.venv/bin/python <script>

# 테스트 — DB·네트워크 없이 돌아간다
npm test          # 9스위트 135건
npm run check     # 문법 검사 7파일
```

---

## 13. 테스트 체계 (2026-08-15 추가)

`npm test` 한 명령으로 9개 스위트가 돈다. 전부 DB·네트워크 의존이 없어 어디서나 같은 결과가 나온다.

| 스위트 | 무엇을 지키는가 |
|--------|----------------|
| auth-credential | 자격증명 검증·스코프·만료·복구 경로 |
| approval-notify | 승인 범위 설정, 알림 미설정 시 안전 실패 |
| telegram-webhook | 위조 차단, 중복 클릭, **웹훅 해제 감지** |
| session-status | `running`→`done` 전이, 상태 어휘 3파일 일치 |
| no-silent-catch | 빈 `catch` 재발 차단 |
| mcp-contract | **선언된 파라미터가 실제로 동작하는가** |
| jsonb | JSONB 이중 파싱 방지, 수제 분기 재발 차단 |
| route-auth | 무인증 변경 라우트 신규 추가 차단 |
| scheduler-queue | 알림 스팸 가드(기준 시각·수신자 실존) |

> 이 체계는 "선언은 있고 구현은 없음" 유형의 결함이 반복돼서 만들었다.
> `agent.list` 의 `capability` 필터가 스키마에만 있고 `args` 를 꺼내지도 않았던 것이 대표 사례다.
