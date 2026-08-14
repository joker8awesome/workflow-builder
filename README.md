# 커멘드센터 — AI 에이전트 협업 플랫폼

단일 HTML + Express + PostgreSQL 기반의 AI 에이전트 협업 커멘드센터.

## 🔗 GitHub Pages (정적 데모)

**https://joker8awesome.github.io/workflow-builder/**

GitHub Pages에서는 **로컬 저장(localStorage) 모드**로 동작합니다 — 서버 없이도 워크플로우 설계·실행·저장 가능.

## 🚀 로컬 서버 (풀 기능)

```bash
# 1. PostgreSQL 기동 (필요 시)
/usr/lib/postgresql/17/bin/pg_ctl -D /opt/data/pgdata -l /opt/data/pgdata/server.log start

# 2. 서버 실행 (Express + PostgreSQL + WebSocket)
npm install
npx pm2 start server.js --name workflow-builder

# 3. 접속
http://localhost:3737
```

## ✨ 기능

### 에디터
- 노드 7종: 시작/프로세스/판단/승인/감독/검토/종료
- 베지어 엣지 + 분기(Yes/No) + 드래그 고스트/스냅/바운스
- 언두/리두, 다중 선택, 그룹, 미니맵, 줌, 명령 팔레트(Ctrl+K)

### 에이전트 협업
- 에이전트 레지스트리 (머신스펙/환경/워크스페이스/세션역할)
- 노드 할당 + 배지 + 핸드오프 + 작업 격리 + 상태 단계
- 파이썬 세션 메시징 (명령/지시/보고 — agent_orchestrator.py)
- A2A급: payload-ref, trace_id, 체크포인트, supervisor, Agent Card

### 실행
- 병렬 fan-out/fan-in + 테스트 스위트 + 회귀 게이트
- 크론 스케줄 (scheduler.py) + 자연어 스케줄 + 웹훅
- LLM 판단 노드 (Nous Portal) + 모델 라우팅 + semantic cache

### 운영
- 승인 게이트 (Strong HITL) + 점진적 위임
- PII 레드액션 + 시크릿 볼트(AES) + 감사 로그
- 트레이스 타임라인 + 퍼널/병목 차트 + 비용 추정
- 백업 cron + 복원 테스트 + DR 문서

## 📁 구성

```
index.html          — 단일 HTML 앱 (4,300+줄)
server.js           — Express + PG + WS (API 60+)
agent_orchestrator.py — 에이전트 세션 오케스트레이터
scheduler.py        — 크론 스케줄러
fonts/              — 이사만루 폰트 3종
MIGRATION.md        — 배포/이전 가이드 + DR
```

## 🔒 보안

- XSS 이스케이프 / SQL 준비문 / 실행 샌드박스
- 시크릿 볼트 (AES-256-CTR, WF_VAULT_KEY)
- PII 레드액션 (전화/이메일/주민번호 마스킹)
- 선택적 인증 (WF_ACCESS_TOKEN) + CORS 제한

## 📝 라이선스

MIT
