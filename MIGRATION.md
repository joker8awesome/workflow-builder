# 워크플로우 빌더 — 마이그레이션 가이드

## 배포 준비 완료 상태

- **단일 HTML 파일**: `index.html` (17.5KB) — 외부 리소스(폰트/이미지/CDN/JS 라이브러리) 0개
- **독립 동작**: 기존 사이트와 스타일/구조 공유 없음. 파일만 배치하면 됨
- **localStorage 네임스페이스**: 페이지 경로 기반 키 사용
  - `/workflow-builder/` → `wf_app_workflow-builder`
  - `/tools/builder/` → `wf_app_tools_builder`
  - 기존 사이트 데이터와 충돌 없음 (같은 도메인 공유 localStorage에서 분리)

## 배치 방법 (하위 슬러그 편입)

### 1. 파일 복사
```bash
# 예: 도메인 루트의 /workflow-builder/ 슬러그로
cp index.html /var/www/html/workflow-builder/index.html
```

### 2. 슬러그 경로가 바뀌어도 문제없음
- 상대 경로/외부 리소스가 없어서 어떤 슬러그에 두든 동일 동작
- localStorage 키는 자동으로 경로별 분리됨

### 3. 기존 사이트와의 연동 (필요 시)
- **헤더/푸터 공유**: 현재는 미포함. 필요하면 index.html 상단/하단에 기존 사이트 내비 삽입
- **스타일 충돌**: body 선택자가 아닌 ID 기반(#topbar, #app 등)이라 기존 CSS와 충돌 위험 낮음
- **폰트**: system-ui 사용 — 기존 사이트 폰트와 자동 일치

## 데이터 마이그레이션 (기존 사용자 데이터가 있다면)

localStorage 키가 경로 기반이라, **슬러그가 바뀌면 기존 데이터가 안 보임** (의도된 격리).
기존 데이터를 옮기려면:

```js
// 브라우저 콘솔에서: 구 키 → 새 키 복사
const oldKey = 'wf_app_old-slug';       // 이전 슬러그 키
const newKey = 'wf_app_new-slug';       // 새 슬러그 키
const data = localStorage.getItem(oldKey);
if (data) localStorage.setItem(newKey, data);
```

## 검증 체크리스트 (배치 후)

- [ ] `index.html` 접속 → 4대 레이아웃 렌더
- [ ] 노드 추가/드래그/연결/분기 동작
- [ ] 변경 후 새로고침 → 복원
- [ ] 기존 사이트의 localStorage 데이터가 영향받지 않음 (DevTools → Application → Local Storage 확인)

## 파일 구조

```
workflow-builder/
├── index.html          ← 배포 대상 (단일 파일)
├── MIGRATION.md        ← 이 가이드
├── docs/superpowers/specs/2026-08-13-workflow-builder-design.md  ← 설계 명세
└── .hermes/plans/2026-08-13_142527-workflow-builder.md           ← 구현 계획
```

---

## 서버 연동 (2단계 확장)

### 구성
- **API 서버**: `server.js` (Express + PostgreSQL) — 포트 3737
- **DB**: `wf_workflows` 테이블 (id, name, data JSONB, updated_at) — odds DB 내
- **동작**: index.html이 서버에 접속 가능하면 서버에서 로드 + 변경 시 자동 동기화, 서버가 없으면 localStorage만으로 동작 (하위 호환)

### 서버 실행
```bash
cd /opt/data/projects/workflow-builder
node server.js          # http://localhost:3737
```

### API
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | /api/workflows | 목록 |
| GET | /api/workflows/:id | 상세 (전체 데이터) |
| POST | /api/workflows | 생성 (upsert) |
| PUT | /api/workflows/:id | 저장 (전체 덮어쓰기) |
| DELETE | /api/workflows/:id | 삭제 |

### 접속 URL 변경 (필요 시)
index.html의 `API_BASE` 상수를 배포 환경에 맞게 수정:
```js
const API_BASE = (window.__WF_API__ || 'http://localhost:3737');
```
- 배포 시 `window.__WF_API__ = 'https://도메인/api'` 설정 가능
- 하위 슬러그 배포 시 서버 라우트와 슬러그 경로 정렬 필요

## DR — 백업/복원 (2026-08-13)

### 백업
- 자동: 매일 02:00 cron (`wf_backup.sh` → /opt/data/backups/)
- 수동: `psql -h /opt/data/pgdata -U hermes -d odds -c "SELECT pg_dump..."`

### 암호화 키 별도 보관 (필수)
- `WF_VAULT_KEY` (시크릿 볼트 키)는 **DB 백업과 같은 위치에 두지 말 것**
- 별도 보안 저장소(패스워드 매니저 등)에 보관

### 복원 테스트 (정기 실행 권장)
```bash
/opt/data/scripts/wf_restore_test.sh /opt/data/backups/wf_YYYYMMDD.sql
```

### 복구 절차
1. `psql -h /opt/data/pgdata -U hermes -d postgres -c "CREATE DATABASE odds_restored"`
2. `psql -h /opt/data/pgdata -U hermes -d odds_restored -f 백업.sql`
3. 검증 후 `odds` DB 교체
