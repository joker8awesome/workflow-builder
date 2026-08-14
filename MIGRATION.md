# 커멘드센터 (Command Center) — 운영/개발 가이드

작성일: 2026-08-15 (구버전 localStorage 문서에서 교체)

## 현재 아키텍처

```
웹 UI (index.html 5,500줄) ──REST/WS──▶ Express server.js ──▶ PostgreSQL 17
  · 노드 9종 · 에이전트 팀 15명 · MCP · PWA          (odds DB, 26 테이블)
```

- 프론트: 단일 HTML (로컬 폰트 3종, 외부 리소스 0)
- 백엔드: Node.js + Express (API 78개)
- 에이전트: Python (agent_orchestrator.py)
- 외부 연결: MCP Streamable HTTP (12툴) + HTTPS

## 로컬 개발 (Windows)

### 1. DB 접속 파라미터화됨
server.js는 `DATABASE_URL` 또는 `PGHOST/PGDATABASE/PGUSER/PGPASSWORD/PGPORT` 환경변수 지원.
기본값은 VPS 소켓 경로(`/opt/data/pgdata`) — VPS 동작 유지.

### 2. 로컬 Postgres 필요
```bash
# 로컬 DB 생성 후
set DATABASE_URL=postgresql://user:pass@localhost:5432/odds
node server.js
```

### 3. 스키마 확보
VPS에서: `pg_dump -h /opt/data/pgdata -U hermes -d odds --schema-only > schema.sql`

## VPS 배포

```bash
npx pm2 start server.js --name workflow-builder
WF_VAULT_KEY=<키> WF_ALLOWED_ORIGINS=<오리진> npx pm2 restart workflow-builder --update-env
```

## 환경변수

| 변수 | 기본값 | 용도 |
|------|--------|------|
| PORT | 3737 | 서버 포트 |
| DATABASE_URL | — | 로컬 DB 연결 |
| PGHOST/PGDATABASE/PGUSER/PGPASSWORD/PGPORT | /opt/data/pgdata, odds, hermes | DB 접속 |
| WF_ACCESS_TOKEN | null | API 인증 |
| WF_ALLOWED_ORIGINS | GitHub Pages + localhost | CORS |
| WF_VAULT_KEY | 'wf-vault-local-key-2026' | 시크릿 볼트 AES 키 |
| WF_MCP_OPEN | — | MCP 인증 우회(테스트 전용, 비활성 권장) |
| WF_MCP_STRICT_HEADERS | — | MCP 헤더 엄격 모드 |

## 백업/복원

```bash
# 백업
/opt/data/scripts/wf_backup.sh  (매일 02:00 cron)
# 복원 테스트
/opt/data/scripts/wf_restore_test.sh <백업파일>
```
