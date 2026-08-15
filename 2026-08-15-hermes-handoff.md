# 🔧 Hermes 봇 작업 지시서 — 최우선 항목만

발신: Claude Code (로컬 Windows 세션)
수신: **Hermes Agent (VPS)**
작성일: 2026-08-15
기준 커밋: `648c51e`

> **이 문서는 "먼저 해야 할 것"만 담는다.** 나머지 로드맵은 `2026-08-15-roadmap.md` 참조.
> 로컬에서 할 수 없는 **VPS 접근이 필요한 작업**만 추렸다.

---

## 왜 당신이 해야 하는가

로컬 세션에는 VPS 접근 권한도, DB 접근 권한도 없다. 그래서 아래 두 가지가 막혀 있다:

1. **환경변수 확인** — 코드만 읽어서는 보안 상태를 판정할 수 없다
2. **스키마 확인** — 새로 작성한 SQL이 실제로 도는지 검증하지 못했다

**⚠️ 2번을 건너뛰고 배포하면 `agent.list`가 지금보다 나빠질 수 있다.**
(지금은 "빈 값 반환", 스키마가 예상과 다르면 "쿼리 에러")

---

## STEP 1 — 환경변수 점검 (읽기 전용, 최우선)

```bash
npx pm2 env 0 | grep -E 'WF_MCP_OPEN|WF_VAULT_KEY|WF_ACCESS_TOKEN'
```

| 변수 | 확인할 것 | 문제 시 조치 |
|------|-----------|--------------|
| `WF_MCP_OPEN` | **비어 있어야 정상** | `=1`이면 Bearer 없이 `mcp:admin`이 부여된다 (`mcp-router.js:11`). **즉시 해제 후 재시작** |
| `WF_VAULT_KEY` | 값이 있어야 정상 | 비어 있으면 볼트가 공개 저장소의 리터럴 `wf-vault-local-key-2026`으로 암호화된다. 키 설정 후 볼트 재암호화 |
| `WF_ACCESS_TOKEN` | 값이 있어야 정상 | 비어 있으면 `/api/agents`·`/api/workflows`의 POST/DELETE가 **무인증 공개**다 (`server.js:96` — 미설정 시 `next()`) |

> 컨텍스트 문서(`deepbot_action.md` §8)에는 앞의 둘이 안전하다고 적혀 있으나 **실측 확인은 안 됐다.**
> 문서를 믿지 말고 위 명령으로 직접 확인할 것.

**보고할 것:** 세 변수의 설정 여부 (값 자체는 절대 출력·기록하지 말 것)

---

## STEP 2 — 스키마 확인 (배포 전 필수)

로컬에서 작성한 새 `agent.list` SQL은 **한 번도 실행된 적이 없다.** 아래 두 전제 위에 쓰였다.

```bash
psql -h /opt/data/pgdata -U hermes -d odds
```

```sql
-- ① machine 컬럼 타입
\d agents

-- ② agent_sessions의 실제 상태값
SELECT DISTINCT status FROM agent_sessions;
```

### 판정 기준

| 확인 | 기대값 | 다를 경우 |
|------|--------|-----------|
| ① `agents.machine` 타입 | **`jsonb`** | `json`이면 `GROUP BY a.machine`이 `could not identify an equality operator`로 **쿼리 자체가 실패**한다 → **배포 중단하고 보고** |
| ② `agent_sessions.status` 값 | `running` / `working` / `waiting` 포함 | 다른 값 체계면 `online`이 **에러 없이 항상 false**가 된다 → 실제 값을 보고하면 로컬에서 수정본을 보내겠다 |

> ②가 특히 중요하다. 조용히 틀리는 유형이라 배포 후에도 눈치채기 어렵다.
> 이번에 잡은 `node_count: 0` 버그와 정확히 같은 실패 방식이다.

**둘 다 기대값과 일치할 때만 STEP 3으로 진행한다.**

---

## STEP 3 — 패치 적용 및 배포

### 3-1. 백업 먼저

```bash
cd /opt/data/workflow-builder   # 실제 경로에 맞게
cp mcp-router.js mcp-router.js.bak-$(date +%Y%m%d-%H%M%S)
git rev-parse --short HEAD      # 648c51e 여야 함. 다르면 보고 후 중단
```

### 3-2. 패치 적용

패치 파일: `ops/mcp-router-fix.patch` (로컬 저장소에 있음. 브랜치는 **미푸시** 상태)

```bash
git apply --check ops/mcp-router-fix.patch   # 먼저 검사만
git apply ops/mcp-router-fix.patch
node --check mcp-router.js                   # 문법 확인
```

패치를 받을 수 없으면 아래 두 곳을 직접 수정한다.

**(a) `mcp-router.js:5` — DB 풀 파라미터화**

`7b52bb3`에서 `server.js`만 고쳐지고 여기가 누락됐다. 로컬 개발이 막히는 원인.

```js
// 변경 전
const pool = new Pool({ host: '/opt/data/pgdata', database: 'odds', user: 'hermes' });

// 변경 후 — server.js와 동일 규칙. 미설정 시 기존 동작 그대로 유지된다
const pool = new Pool(process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : { host: process.env.PGHOST || '/opt/data/pgdata',
      database: process.env.PGDATABASE || 'odds',
      user: process.env.PGUSER || 'hermes',
      password: process.env.PGPASSWORD,
      port: process.env.PGPORT });
```

**(b) `case 'agent.list'` 블록 전체 교체**

```js
    case 'agent.list': {
      // capabilities/tools/trust_score 전용 컬럼은 없다 — agents.machine (JSONB)에 저장한다.
      // online은 /api/team/status와 동일하게 agent_sessions 조인으로 계산한다.
      const { capability, online_only } = args || {};
      const { rows } = await pool.query(
        `SELECT a.id, a.name, a.role, a.machine,
                count(DISTINCT s.id) FILTER (
                  WHERE s.status IN ('running','working','waiting')) AS active_sessions
         FROM agents a
         LEFT JOIN agent_sessions s ON s.agent_id = a.id
         GROUP BY a.id, a.name, a.role, a.machine
         ORDER BY a.id`);
      let agents = rows.map(a => {
        // machine은 JSONB — pg가 이미 객체로 준다 (workflow.list의 node_count 버그와 동일 주의점)
        let m = {};
        try { m = (typeof a.machine === 'string') ? (JSON.parse(a.machine) || {}) : (a.machine || {}); }
        catch (e) { console.warn('[mcp] agents.machine 파싱 실패:', a.id, e.message); }
        return {
          agent_id: a.id,
          name: a.name,
          role: a.role,
          capabilities: Array.isArray(m.capabilities) ? m.capabilities : [],
          tools: Array.isArray(m.tools) ? m.tools : [],
          online: Number(a.active_sessions) > 0,
          trust_score: typeof m.trust_score === 'number' ? m.trust_score : 0,
        };
      });
      if (capability) agents = agents.filter(x => x.capabilities.includes(capability));
      if (online_only) agents = agents.filter(x => x.online);
      return { content: [{ type: 'text', text: JSON.stringify({ agents }) }] };
    }
```

### 3-3. 재시작

```bash
npx pm2 restart workflow-builder
npx pm2 logs workflow-builder --lines 30 --nostream
```

로그에 `[mcp] agents.machine 파싱 실패` 또는 SQL 에러가 보이면 **즉시 롤백**(STEP 5).

---

## STEP 4 — 검증

에이전트 메타데이터는 **이미 프로덕션에 반영 완료**됐다 (16/16, `machine` 병합 방식).
따라서 배포 직후 바로 아래가 나와야 한다.

```bash
# ① 전체 — capabilities가 빈 배열이 아니어야 함
curl -s -X POST https://187.127.124.16.sslip.io/mcp \
  -H "Authorization: Bearer <MCP_KEY>" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"agent.list","arguments":{}}}'

# ② capability 필터 — 핵심 검증
#    arguments를 {"capability":"research"} 로 바꿔 재호출
```

| # | 호출 | 기대 결과 |
|---|------|-----------|
| 1 | `agent.list {}` | 16명, `capabilities`/`tools` 채워짐, `trust_score: 50` |
| 2 | `agent.list {capability:"research"}` | **`ag_researcher` 1명만** |
| 3 | `agent.list {capability:"verify"}` | **3명** (`ag_reviewer`, `ag_tester`, `ag_auditor`) |
| 4 | `agent.list {online_only:true}` | 활성 세션 있는 것만 (전원 0이면 빈 배열이 정상) |

**2번이 16명을 반환하면 필터가 여전히 죽어 있는 것이다.** 배포가 안 됐는지 확인.

---

## STEP 5 — 롤백

```bash
cp mcp-router.js.bak-<타임스탬프> mcp-router.js
npx pm2 restart workflow-builder
```

에이전트 데이터를 되돌려야 하면 (거의 불필요):
`ops/agents-before.json`의 각 행을 `POST /api/agents`로 그대로 되쓰면 원복된다.

---

## 하지 말 것

1. **`WF_MCP_OPEN=1`로 설정하지 말 것** — 인증 우회. 문제 해결용으로도 금지
2. **환경변수 값을 로그·보고서에 출력하지 말 것** — 설정 여부만 보고
3. **STEP 2를 건너뛰고 배포하지 말 것** — `agent.list`가 에러로 죽을 수 있다
4. **`agents` 테이블에 직접 UPDATE 하지 말 것** — 메타데이터는 이미 반영됨. 재작업 불필요
5. **강제 푸시·히스토리 재작성 금지**

---

## 보고 양식

```
[STEP 1] 환경변수
- WF_MCP_OPEN     : 미설정 / 설정됨(→조치함)
- WF_VAULT_KEY    : 설정됨 / 미설정
- WF_ACCESS_TOKEN : 설정됨 / 미설정
※ 값은 기재하지 않음

[STEP 2] 스키마
- agents.machine 타입        : jsonb / json / 기타(____)
- agent_sessions.status 값   : (SELECT DISTINCT 결과 그대로)
- 배포 가능 판정             : 가능 / 불가(사유)

[STEP 3] 배포
- 적용 전 HEAD : ______  (648c51e 기대)
- 백업 파일    : mcp-router.js.bak-______
- 패치 적용    : 성공 / 실패(사유)
- pm2 재시작   : 성공 / 실패
- 로그 이상    : 없음 / 있음(내용)

[STEP 4] 검증
- agent.list {}                    → __명, capabilities 채워짐 Y/N
- agent.list {capability:research}  → __명  (기대 1)
- agent.list {capability:verify}    → __명  (기대 3)
- agent.list {online_only:true}     → __명

[결과] 완료 / 진행 / 차단(사유)
```

보고 후 `deepbot_action.md`의 `## 작업 로그`에 `날짜 | 작업 | 결과` 형식으로 추가할 것.
