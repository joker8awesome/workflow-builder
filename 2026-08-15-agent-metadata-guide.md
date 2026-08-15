# 🤖 에이전트 메타데이터 채우기 — 작업 지침서 (Claude용)

작성일: 2026-08-15 (v2 — 코드 검증 후 개정)
작업 대상: 커멘드센터 에이전트 16명의 `capabilities` / `tools` / `trust_score`
실행: Orca / Claude Code — MCP 접속 상태

---

## ⚠️ 0. 먼저 읽을 것 — 이 작업은 데이터 입력만으로는 끝나지 않는다

**데이터를 아무리 잘 채워도 `agent.list`는 계속 빈 값을 반환한다.** 코드가 하드코딩돼 있기 때문이다.

`mcp-router.js:171-174`:

```js
case 'agent.list': {
  const { rows } = await pool.query('SELECT id, name, role FROM agents ORDER BY id');
  return { content: [{ type: 'text', text: JSON.stringify({ agents: rows.map(a => ({
    agent_id: a.id, name: a.name,
    capabilities: [], tools: [], online: false, trust_score: 0   // ← 전부 리터럴
  })) }) }] };
}
```

- SQL이 `id, name, role`만 조회한다 — 메타데이터를 **읽는 곳이 아예 없다**
- `capabilities` / `tools` / `online` / `trust_score`는 **하드코딩된 상수**
- 툴 스키마에 선언된 `capability` / `online_only` 파라미터는 **`args`를 꺼내지도 않아서 무시된다**

**실측 확인:** `agent.list(capability="research")` → **16명 전원 반환** (필터 미동작 확정).

> **따라서 작업 순서는 `코드 수정 → 데이터 입력`이다.** 순서를 바꾸면 검증이 통과할 수 없다.

---

## 1. 배경

에이전트 16명 전원이 `capabilities: []`, `tools: []`, `trust_score: 0` 상태.
→ `agent.list(capability=...)` 필터가 항상 전체 반환 = **사실상 죽은 기능**.

이 작업으로 **코드와 데이터를 함께** 고쳐 필터/검색/라우팅이 동작하게 한다.

---

## 2. 확정된 스키마 (조사 완료 — 추측 아님)

`GET /api/agents` 실측 결과, `agents` 테이블 컬럼은 다음 8개다:

```
id, name, person, role, machine, color, created_at, owner
```

**`capabilities` / `tools` / `trust_score` 전용 컬럼은 없다.** → `machine` (JSONB) 안에 넣는다.

**중요: `machine`은 이미 비어 있지 않다.**

```json
{
  "id": "ag_auditor",
  "name": "감사자",
  "person": "커멘드센터",
  "role": "감사 로그·프로세스 검증·준수",
  "machine": { "env": "VPS", "workspace": "/opt/data/agents/ag_auditor" },
  "color": "#c9a227",
  "owner": ""
}
```

→ `machine`을 **통째로 교체하면 `env`와 `workspace`가 사라진다. 반드시 병합할 것.**

목표 형태:

```json
"machine": {
  "env": "VPS",
  "workspace": "/opt/data/agents/ag_auditor",
  "capabilities": ["audit","compliance","verify"],
  "tools": ["audit","db"],
  "trust_score": 50
}
```

---

## 3. 사전 확인 (필수 — 여기서 막히면 작업 자체가 불가)

### 3.1 인증 토큰 확인

`POST /api/agents`에는 `requireAuth`가 걸려 있다 (`server.js:95`):

```js
const ACCESS_TOKEN = process.env.WF_ACCESS_TOKEN || null;
function requireAuth(req, res, next) {
  if (!ACCESS_TOKEN) return next();              // 미설정 시 인증 없음
  if (auth === 'Bearer ' + ACCESS_TOKEN) return next();
  return res.status(401).json({ success:false, error:'unauthorized' });
}
```

**MCP 키(`wf_ak_...`)와 `WF_ACCESS_TOKEN`은 별개다.** MCP 키로는 이 API를 통과하지 못한다.

VPS에서 확인:
```bash
npx pm2 env 0 | grep WF_ACCESS_TOKEN
```

- **값이 있으면** → 그 값을 `Bearer`로 써야 함. 없으면 전부 401로 실패
- **비어 있으면** → 인증 없이 통과. 단, `/api/agents`의 POST/DELETE가 인터넷에 열려 있다는 뜻이므로 **별도 보안 이슈로 보고할 것**

### 3.2 스냅샷 확보 (되돌리기 대비)

**쓰기 전에 반드시 실행.** 아래 §4의 실수 한 번이면 16명 전원의 이름·역할·색상이 날아간다.

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://187.127.124.16.sslip.io/api/agents > agents-before.json
```

---

## 4. 🔴 데이터 쓰기 — POST의 함정

**`PUT /api/agents/:id`는 존재하지 않는다.** 라우트는 셋뿐이다:

| 메서드 | 경로 | 용도 |
|---|---|---|
| GET | `/api/agents` | 전체 조회 |
| POST | `/api/agents` | **생성 + 수정 (upsert)** |
| DELETE | `/api/agents/:id` | 삭제 |

수정은 `POST`로 한다. 그런데 이게 **전체 컬럼 upsert**다 (`server.js:667`):

```js
`INSERT INTO agents (id, name, person, role, machine, color)
 VALUES ($1,$2,$3,$4,$5,$6)
 ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, person=EXCLUDED.person,
   role=EXCLUDED.role, machine=EXCLUDED.machine, color=EXCLUDED.color`,
[id, name || '', person || '', role || '', JSON.stringify(machine || {}), color || '#00ff87']
```

### ❌ 절대 이렇게 보내지 말 것

```json
{ "id": "ag_auditor", "machine": { "capabilities": ["audit"], "trust_score": 50 } }
```

이 한 번의 요청이 일으키는 일:
- `name` → `''` (이름 삭제)
- `person` → `''`
- `role` → `''` (팀 대시보드 역할 표시 파괴)
- `color` → `'#00ff87'` (스펙 §3의 고유 색상 15종이 전부 같은 초록으로)
- `machine` → `env`·`workspace` 유실

### ✅ 올바른 절차 — 읽고 · 병합하고 · 전체 필드로 되쓰기

> **자동화 완료:** `ops/fill-agent-metadata.js`가 아래 절차를 그대로 구현해 두었다.
> ```bash
> node ops/fill-agent-metadata.js            # dry-run (기본 — 전송 안 함)
> node ops/fill-agent-metadata.js --apply    # 실제 전송
> WF_TOKEN=<토큰> node ops/fill-agent-metadata.js --apply   # 인증 필요 시
> ```
> dry-run 검증 완료: 16/16 매핑, `machine`의 `env`·`workspace` 전원 보존 확인.
> 손으로 치지 말고 이 스크립트를 쓸 것.

에이전트 1명당 (스크립트가 수행하는 일):

1. `agents-before.json`에서 해당 행을 찾는다
2. `machine`에 세 키만 **추가**한다 (기존 키 보존 — spread 병합)
3. `id, name, person, role, color, machine`을 **전부** 담아 POST한다
4. 401이면 즉시 중단한다 (부분 적용 방지)

```bash
# 예시 (ag_auditor)
curl -s -X POST https://187.127.124.16.sslip.io/api/agents \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "id": "ag_auditor",
    "name": "감사자",
    "person": "커멘드센터",
    "role": "감사 로그·프로세스 검증·준수",
    "color": "#c9a227",
    "machine": {
      "env": "VPS",
      "workspace": "/opt/data/agents/ag_auditor",
      "capabilities": ["audit","compliance","verify"],
      "tools": ["audit","db"],
      "trust_score": 50
    }
  }'
```

`agents-before.json`을 읽어 위 형태를 16번 생성하는 스크립트를 짜는 편이 안전하다. 손으로 치지 말 것.

> **VPS에서 직접 SQL을 쓸 수 있다면 이쪽이 훨씬 안전하다** (다른 컬럼을 건드릴 수 없음):
> ```sql
> UPDATE agents SET machine = machine || '{"capabilities":["audit","compliance","verify"],
>   "tools":["audit","db"],"trust_score":50}'::jsonb WHERE id = 'ag_auditor';
> ```
> `||` 연산자가 기존 키를 보존한 채 병합한다.

---

## 5. 메타데이터 매핑표 (16명 전원)

`capabilities` / `tools`는 **영문 소문자**. `trust_score`는 전원 **50**(중립)에서 시작해 실행 성공률로 갱신.

| 에이전트 | capabilities | tools |
|----------|-------------|-------|
| ag_orch | orchestrate, delegate, converge | mcp, team |
| ag_researcher | research, summarize, synthesize | web, search |
| ag_analyst | analyze, pattern, insight | db, python |
| ag_writer | write, draft, report | mcp, doc |
| ag_reviewer | review, verify, feedback | mcp, test |
| ag_collector | crawl, scrape, collect | web, api |
| ag_developer | code, refactor, debug | python, git |
| ag_tester | test, regression, verify | test, ci |
| ag_designer | design, ui, ux, visualize | figma, css |
| ag_security | security, audit, pii | scan, vault |
| ag_communicator | report, notify, message | telegram, api |
| ag_scheduler | schedule, cron, deadline | cron, task |
| ag_integrator | integrate, api, mcp | api, mcp |
| ag_archiver | archive, version, knowledge | db, git |
| ag_auditor | audit, compliance, verify | audit, db |
| **ag_claude_desktop** | **connect** | **mcp** |

> **`ag_claude_desktop`은 팀 역할이 아니라 외부 커넥터 신원이다.** 팀 능력을 부여하면 라우팅에
> 섞여 들어가므로 `connect` / `mcp`만 준다. 이렇게 해야 "16명 전원 채움"이 성립한다.
> (구버전 지침서는 표에 15명만 있으면서 "16명 전원"을 요구해 모순이었다.)

**`tools`의 미연동 항목에 대하여 (확정된 방침):**
`figma` · `telegram` · `ci` 등은 **차후 해당 워커들에게 연동할 예정**이다.
따라서 **빼지 않고 그대로 기입한다** — 목표 상태를 선언해 두고 워커 연동 시 실제로 채우는 방식이다.

다만 "선언됨"과 "연동됨"은 구분되어야 하므로, 스크립트가 미연동 항목을
`(연동예정: ...)`으로 표시한다. 현재 연동예정으로 분류된 항목:

```
figma, telegram, ci, scan, vault, cron, doc, team
```

연동이 끝나면 `ops/fill-agent-metadata.js`의 `PLANNED_TOOLS`에서 제거할 것.

---

## 6. 코드 수정 (§0의 하드코딩 제거) — ✅ 로컬 적용 완료

> **상태: `D:\Comment_Center`의 `mcp-router.js`에 이미 반영됨. VPS 배포만 남았다.**
> 아래는 적용된 내용의 기록이다. 실행 에이전트는 §7 검증부터 진행하면 된다.

`mcp-router.js`의 `case 'agent.list'`를 다음으로 교체:

```js
case 'agent.list': {
  const { capability, online_only } = args || {};
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.machine,
            count(DISTINCT s.id) FILTER (
              WHERE s.status IN ('running','working','waiting')) AS active_sessions
     FROM agents a
     LEFT JOIN agent_sessions s ON s.agent_id = a.id
     GROUP BY a.id, a.name, a.machine
     ORDER BY a.id`);
  let agents = rows.map(a => {
    const m = (typeof a.machine === 'string' ? JSON.parse(a.machine || '{}') : (a.machine || {}));
    return {
      agent_id: a.id,
      name: a.name,
      capabilities: m.capabilities || [],
      tools: m.tools || [],
      online: Number(a.active_sessions) > 0,
      trust_score: m.trust_score ?? 0,
    };
  });
  if (capability) agents = agents.filter(x => x.capabilities.includes(capability));
  if (online_only) agents = agents.filter(x => x.online);
  return { content: [{ type: 'text', text: JSON.stringify({ agents }) }] };
}
```

포인트:
- `machine`은 **JSONB라 `pg`가 이미 객체로 준다.** `JSON.parse()`를 무조건 걸면
  `"[object Object]"` 파싱 실패가 난다 — `workflow.list`의 `node_count: 0` 버그와 **동일한 원인**이므로
  위처럼 타입 분기할 것
- `online`은 `/api/team/status`(`server.js:306`)가 쓰는 것과 같은 `agent_sessions` 조인 방식
- `capability` / `online_only` 두 파라미터를 **실제로 사용**한다

---

## 7. 검증

### 7-A. 데이터 쓰기 직후 (코드 수정 전에도 통과해야 함)

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://187.127.124.16.sslip.io/api/agents > agents-after.json
```

1. `machine.capabilities` / `tools` / `trust_score`가 16명 전원에 들어갔는가
2. **`machine.env` / `machine.workspace`가 그대로 남아 있는가**
3. **`agents-before.json`과 diff → `machine` 외의 필드(`name`/`person`/`role`/`color`)가 하나도 안 바뀌었는가**

> 3번이 이 작업의 **가장 중요한 검증**이다. 여기서 차이가 나면 즉시 중단하고
> `agents-before.json`으로 복구할 것.

### 7-B. 코드 수정 후

4. `agent.list` → capabilities/tools/trust_score가 **실제 값**으로 표시
5. `agent.list(capability="research")` → **`ag_researcher` 1명만** 반환
6. `agent.list(capability="verify")` → **3명** (`ag_reviewer`, `ag_tester`, `ag_auditor`)
7. `agent.list(online_only=true)` → 활성 세션 있는 에이전트만 (현재 전원 0이면 빈 배열이 정상)

---

## 8. 주의사항

1. **코드 → 데이터 순서** — 반대로 하면 §7-B가 통과할 수 없다 (§0)
2. **쓰기 전 스냅샷 필수** — POST 한 번의 실수가 16명 전원을 망가뜨린다 (§3.2, §4)
3. **`machine`은 교체가 아니라 병합** — `env`/`workspace` 보존 (§2)
4. **POST에 전체 필드 포함** — `id`만 빼먹어도 그 컬럼이 기본값으로 덮인다 (§4)
5. **영문 소문자** — capabilities/tools
6. **없는 능력을 적지 말 것** — 실제 연동과 대조 (§5)
7. `workspace.md`는 VPS(`/opt/data/agents/<id>/`)에만 있어 로컬에서 못 읽는다.
   역할 정보는 `GET /api/agents`의 `role` 필드로 충분하다
8. **`WF_ACCESS_TOKEN`이 비어 있으면 보안 이슈로 별도 보고** (§3.1)

---

## 9. 완료 보고 양식

```
[사전 확인]
- WF_ACCESS_TOKEN: 설정됨 / 미설정(→ 보안 이슈 보고)
- agents-before.json 스냅샷: 확보

[코드]
- mcp-router.js agent.list 수정: 완료 / 미완
- capability·online_only 필터 실동작: 확인 / 미확인

[데이터]
- 16명 전원 capabilities/tools/trust_score 기입: N명
- machine.env·workspace 보존: 확인
- before/after diff — machine 외 필드 변경 없음: 확인   ← 필수

[검증]
- agent.list(capability="research") → 1명 (ag_researcher)
- agent.list(capability="verify")   → 3명
- agent.list(online_only=true)      → N명

[미해결 / 판단 보류]
- 실제 연동이 없어 제외한 tools 항목:
```
