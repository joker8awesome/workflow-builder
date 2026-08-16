# 🚀 센터장 새 세션 부트스트랩 가이드

작성: 할매봇 (ag_hermes)
작성일: 2026-08-17
대상: 새로 켠 Orca Claude Code 세션 (센터장 승계)
목적: 이전 세션의 컨텍스트·역할·진행 상태를 30분 안에 복구

---

## STEP 0 — 나(할매봇)의 실측 스냅샷 (지금 이 순간)

```
GitHub main HEAD    : 29eb1de
마지막 지시서       : #39 (2026-08-17-hermes-handoff-39.md) — 완료
큐 상태             : 전체 pending 0건 (센터장·할매봇 앞 둘 다)
자동 픽업 트리거    : 활성, */5분, 다음 실행 22:55
Kimi 워커           : ag_deepseek, moonshotai/kimi-k3, 정상
할매봇 키           : id 68 (hermes-vps-r2, mcp:read+execute)
승인 게이트         : deploy·credential.issue·rollback (텔레그램 버튼)
```

**즉시 처리할 긴급 없음.** 안전하게 컨텍스트 복구부터 시작.

---

## STEP 1 — 신원 확인 (2분)

```bash
# Orca Claude Code에서 .mcp.json 있는 폴더로 이동
cd D:\Comment_Center    # (또는 사용자가 실제 쓰는 경로)

# claude-desktop-main-r2 키가 아직 유효한지 확인
# .mcp.json에 이미 있어야 함
```

**MCP 툴 호출:**
```
agent.whoami
```

**기대 결과:**
```json
{
  "agent_id": "ag_claude_desktop",
  "scopes": ["mcp:read", "mcp:execute", "mcp:admin"]
}
```

**scopes에 `mcp:admin`이 있어야 정상.** 없으면 사용자에게 알리고 키 재발급 필요.

---

## STEP 2 — 프로젝트 클론·최신화 (5분)

```bash
git clone https://github.com/joker8awesome/workflow-builder.git
cd workflow-builder
git pull origin main       # HEAD가 29eb1de 이상
```

**핵심 문서 4개 순서대로 읽기 (총 45KB, 20분):**

1. `deepbot_action.md` — 지금까지의 작업 이력 전체 (필독)
2. `2026-08-17-hermes-handoff-39.md` — 마지막 처리된 지시서
3. `2026-08-14-command-center-spec.md` — 시스템 스펙 §1~§13
4. `2026-08-17-orchestration-team-draft.md` — 팀 구성 v0.1

**요약 (읽기 부담되면 이것만):**
- 커멘드센터 = HTML 5,500줄 + Express API + PostgreSQL + MCP 12툴
- Kimi K3 워커에게 코드 리뷰·수정 배분 → 할매봇이 검수·적용
- 승인 필요 3가지: `deploy`, `credential.issue`, `rollback`
- 배포 경로: 코드 → git push → Pages 자동 배포 + VPS pm2 restart

---

## STEP 3 — 3자 협업 프로토콜 (필수 규칙)

### 나(할매봇)에게 지시하는 법

**지시서 형식 (반드시 handoff MD 파일로):**
```bash
# 파일명 규칙
2026-08-XX-hermes-handoff-N.md     # N = 지시서 번호 (다음 #40)

# 내용 필수 항목
1. 배경/왜 필요한가
2. STEP 1~N 명확한 절차
3. 검증 방법 (실측 명령)
4. "하지 말 것" 목록
5. 보고 양식 (내가 채워 넣을 표)
6. trace_id 지정
```

**저장소에 커밋·push하면:** 5분 안에 내 자동 픽업이 감지 → hermes -z 기동 → 지시서 그대로 수행.

**메시지 큐 전송 (선택):**
```
agent.send_message(
  to_agent="ag_hermes",
  msg_type="instruction",
  payload_ref="2026-08-XX-hermes-handoff-N.md",
  trace_id="task-name-YYYYMMDD"
)
```

### 워커(Kimi) 배분 규칙 (내가 지킴)

- 파일 이름 아닌 **코드 조각** 넣기
- **앵커 문자열** 포함 (실제 코드 인용)
- **한 번에 한 가지** (800토큰 상한)
- **판단 요구 문구**: *"위 코드에 없으면 '제공된 코드에 없습니다'라고만 답하라."*
- 응답 검수: 앵커 grep → 환각 반려 → npm test → 커밋

### 승인 게이트

```
자동 통과 : workflow.execute, credential.revoke, schema.change, code.change, agent.write
🔒 승인 필요 : deploy, credential.issue, rollback
```

승인 필요 작업은 텔레그램 봇으로 사용자에게 인라인 버튼 발송 → 사용자가 승인/거부.

---

## STEP 4 — 이전 세션과 다른 점 (주의)

**나(할매봇)의 모델이 오늘 오전에 바뀌었다:**
- 이전 (~8/15): `deepseek/deepseek-v4-flash-0731`
- 이전 (8/15~16 오전): `anthropic/claude-opus-4-7`
- **지금**: `moonshotai/kimi-k3` (Nous Portal 경유)

**나의 비용 경로**: Anthropic 아님, Nous Portal 크레딧만.
- ANTHROPIC_API_KEY 없음
- Claude 구독 인증 없음
- 어떤 Anthropic 대시보드도 나를 안 봄

**Kimi 워커도 kimi-k3** (동일 모델을 워커로도 사용).

---

## STEP 5 — 최근 큰 이슈 (알아둘 것)

### 해결된 것 (참고용, 조치 불필요)

1. **키 유출 사고** (8/16 오후, #36으로 처리)
   - `wf_ak_ag_hermes_ookX...` 공개 저장소 노출됐음
   - 회전 완료 (신규 id 68). 구 키 401 확인
   - `WF_ACCESS_TOKEN` 새로 발급 (ecosystem에만 저장, gitignore)

2. **쓰기 API 18개 401 회귀** (#37로 처리)
   - `requireAuth` → `maybeAuth(mcp:execute)` 교체 완료

3. **자격증명 API 무인증 복호화** (#38로 처리)
   - GET admin-only + 복호화 제거

4. **index.html CSS 632줄 노출 사고** (8/13부터 잠복, 방금 사용자가 발견)
   - 커밋 `a136756`에서 `<style>` 태그 누락
   - 이후 CSS 리팩터로 잔존
   - 커밋 `29eb1de`로 정리 완료

### 미해결·판단 필요 (센터장 결정 사항)

- **회귀 테스트에 "body에 CSS 문법 없음" 케이스 추가**할지 여부
  (Playwright 회귀가 시각 렌더 안 봐서 3일 방치됐음)
- **오케스트레이션 팀 v0.1 확장**할지 여부
  (2026-08-17-orchestration-team-draft.md 참조 — 로스터는 시뮬레이션)

---

## STEP 6 — 첫 통신 확인 (3분)

새 세션이 정상 작동하는지 나에게 ping 보내기:

```
agent.send_message(
  to_agent="ag_hermes",
  msg_type="instruction",
  payload_ref="[인라인] 새 센터장 세션 시작. 상태 보고 부탁.",
  trace_id="center-bootstrap-YYYYMMDD"
)
```

**5분 안에 내가 report로 응답할 것.** 응답 오면 통신 정상.

---

## STEP 7 — 사용자에게 알림 (필수)

새 세션이 확인되면 사용자(데카르트)에게 텔레그램으로 상황 보고:
- "센터장 새 세션 활성화 완료"
- 이전 세션의 어디까지 봤는지
- 다음에 뭘 할 예정인지

---

## 부록 A — 실행 환경 실측 정리

**할매봇 (나) 실행 환경:**
- Hostinger VPS Docker 컨테이너
- HOME: `/opt/data`
- 저장소: `/opt/data/projects/workflow-builder`
- Postgres 소켓: `/opt/data/pgdata`
- pm2로 workflow-builder(포트 3737) 상주
- Hermes cron: `wf-queue-trigger` (매 5분, `queue-trigger.sh` 실행)

**MCP 접속점:**
- Production: `https://187.127.124.16.sslip.io/mcp`
- 로컬 서버: `http://127.0.0.1:3737/mcp`

**주요 파일:**
- `deepbot_action.md` — 작업 로그 (append-only 관례)
- `ecosystem.config.js` — pm2 env (gitignore)
- `ops/.trigger-env` — 트리거 env (gitignore)
- `ops/queue-trigger.js` — 자동 픽업 스크립트

---

## 부록 B — 자주 쓰는 MCP 툴

```
agent.whoami                   신원 확인
agent.list                     팀 목록
agent.tasks.list_pending       내 앞 지시 확인
agent.tasks.claim              지시 잡기
agent.tasks.claim.done         완료 처리
agent.send_message             메시지 보내기
workflow.list                  워크플로우 목록
workflow.execute               워크플로우 실행 (자동 통과)
```

---

## 부록 C — 나(할매봇) 성격/규칙

- 명확한 지시서 좋아함, 애매하면 되물음
- 승인 필요 판단 서지 않으면 실행 안 함 → 사용자·센터장에게 문의
- 완료 후 반드시 `deepbot_action.md` 로그 + 센터장 report + 사용자 텔레그램 3자 보고
- 워커 결과는 무조건 앵커 grep으로 검수 (환각 방지)
- Nous Portal 크레딧만 씀 — Anthropic 과금 걱정 필요 없음

---

## 시작 체크리스트

- [ ] STEP 1: `agent.whoami`로 admin 스코프 확인
- [ ] STEP 2: 저장소 pull + 4개 문서 훑기 (deepbot_action.md 필독)
- [ ] STEP 3: 3자 협업 프로토콜 숙지
- [ ] STEP 4: 모델·비용 경로 인지 (Anthropic 무관 = 할매봇)
- [ ] STEP 5: 미해결 판단 항목 검토
- [ ] STEP 6: 나에게 ping 보내서 통신 확인
- [ ] STEP 7: 사용자에게 세션 활성화 알림

**7단계 완료하면 이전 세션과 동등한 상태로 운영 가능.**
