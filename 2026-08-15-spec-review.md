# 커멘드센터 스펙 검토 (2026-08-15)

대상: `2026-08-14-command-center-spec.md`
검토 방식: 문서 정독 + 라이브 시스템 read-only 점검 (MCP 툴 / REST API)
원칙: 이번 검토는 **읽기 전용**. `mcp:admin` 권한과 `workflow_execute`를 보유했지만 프로덕션에 아무것도 쓰지 않았음.

---

## 0. 한 줄 요약

문서는 **수치가 전부 정확한 좋은 현황 스냅샷**이지만 **스펙(명세)은 아니다.** 시스템은 살아있고 MCP도 정상 동작한다.

- **좋은 소식:** 키는 공개되지 않았고, 문서의 정량 주장(5,491줄 / 78 API / 81커밋)은 실측과 **전부 일치**한다. 8/14 대량 쓰기도 침해 정황 없음.
- **먼저 볼 것:** VPS 환경변수 2개(`WF_MCP_OPEN`, `WF_VAULT_KEY`) — 설정 상태에 따라 §10 보안 주장이 성립하거나 무너진다.
- **로컬 개발의 유일한 실질 blocker:** `server.js:60`의 DB 접속이 하드코딩된 **Unix 소켓 경로**라 Windows에서 연결 불가.

---

## 1. 라이브 점검 결과 (직접 확인함)

| 항목 | 결과 |
|------|------|
| GitHub Pages | `200` — 정상 |
| GitHub 저장소 URL | `200` — **인증 없이 접근 가능 = 공개 저장소** |
| MCP 서버 카드 | 정상 응답 (`Workflow Builder` v1.0.0, protocol `2026-07-28`) |
| MCP 인증 | 정상. 내 신원 = `ag_claude_desktop`, scopes = `mcp:read`, `mcp:execute`, **`mcp:admin`** |
| `workflow.list` | 50개 반환 — 문서 §8의 "wf_workflows 50"과 일치 |
| `agent.list` | **26개** 반환 |
| `/api/team/status` | 정상. 역할·색상·세션수 반환 (확인분 전원 `active_sessions:0`, `pending_msgs:0`) |
| `/api/workflows/wf_tpl_team` | 정상. 노드 11개 + 엣지 13개가 `data` JSONB에 온전히 존재 |

**결론: 백엔드·DB·MCP·HTTPS·인증은 실제로 살아있다.** 문서가 허구를 적은 게 아니다.

---

## 2. 지금 당장 처리할 것 (우선순위 순)

### 🟡 P0 → P2 강등 — MCP 키는 공개되지 않았음 (저장소 확인 완료)

저장소를 클론해 히스토리 전체를 검사한 결과:

- `.mcp.json`은 **저장소에 추적되지 않음** (`git ls-files` 미검출)
- 커밋 81개 전체에서 실제 키 값 **없음**. `git log --all -p -S 'wf_ak_'` 검출분은 `mcp-live-verify.sh`의 플레이스홀더 `wf_ak_ag_claude_desktop_XXXX` 뿐
- 현재 사용 중인 키 문자열은 저장소 어디에도 **없음**
- 과거 노출은 이미 처리됨 — 커밋 `cd68615` 메시지에 "rotate exposed key, gitignore config"

**→ 즉시 회전할 필요 없음.** 다만 아래 한 가지는 남는다.

**남은 조치:** `.gitignore`에 `.env`·`auth.json`·`claude_desktop_config*.json`은 있으나 **`.mcp.json`이 없다.**
`D:\Comment_Center`를 저장소로 만들면 키가 커밋될 수 있다. `.gitignore`에 `.mcp.json` 한 줄 추가할 것.

<details><summary>최초 지적 내용 (조사 전)</summary>

### MCP 관리자 키가 평문으로 프로젝트 폴더에 있음

`D:\Comment_Center\.mcp.json` 7번 줄:

```
"Authorization": "Bearer wf_ak_ag_claude_desktop_<폐기된 키 — 2026-08-17 회전>"
```

이 키는 **`mcp:admin` 스코프**를 가진다 (`agent.whoami`로 확인). 즉 이 문자열 하나면 워크플로우 실행·에이전트 조작이 가능하다.

- 현재 `D:\Comment_Center`는 git 저장소가 **아니므로** 아직 유출은 없다.
- 그러나 저장소 `joker8awesome/workflow-builder`는 **공개**다. 여기서 `git init` → push 하는 순간 키가 공개된다.
- 문서 §10은 "키 관리 … `.gitignore` 제외"라고 적었지만, **이 로컬 `.mcp.json`은 그 보호를 받고 있지 않다.**

**확인이 필요한 것 (내가 못 한 부분):**
아래 두 URL을 직접 열어서 키가 **이미** 공개돼 있는지 확인해 주세요. 저는 이 요청이 보안 스캔으로 분류되어 두 번 차단됐습니다.

```
https://raw.githubusercontent.com/joker8awesome/workflow-builder/main/.mcp.json
https://raw.githubusercontent.com/joker8awesome/workflow-builder/main/.gitignore
```

- **404 두 개면** → 아직 안전. `.mcp.json`을 `.gitignore`에 넣고, 키는 환경변수로 옮기면 됨.
- **`.mcp.json`이 200이고 `wf_ak_`가 보이면** → **즉시 키 폐기·회전.**

→ **저장소 클론으로 직접 확인 완료. 노출 없음.**

---

> 🔴 **2026-08-17 추가 — 위 결론은 이 문서 자신에 의해 뒤집혔다.**
>
> 이 문서를 쓸 때 `D:\Comment_Center` 는 git 저장소가 아니었고, 그래서
> "여기서 `git init` → push 하는 순간 키가 공개된다" 고 경고했다.
> 그 뒤 실제로 `git init` 되어 **이 문서가 키를 담은 채로 공개 저장소에 올라갔다.**
> 경고가 경고한 그 경로로 유출이 일어났다.
>
> 위 본문의 키 문자열은 폐기·회전 대상이다. `.mcp.json` 을 `.gitignore` 에
> 넣는 것만으로는 부족했다 — **키를 인용한 문서**가 남아 있었다.
> 앞으로 키는 문서에도 적지 마라. `wf_ak_ag_..._<앞 6자>…` 로만 적는다.

</details>

### 🔴 P0 — VPS에서 즉시 확인할 환경 변수 2개

코드를 읽고 나온 항목입니다. **둘 다 "설정 안 하면 위험한 기본값"** 유형이라, 문서 §10의 보안 주장이 실제로 성립하는지가 여기 달려 있습니다.

**(a) `WF_MCP_OPEN` — 설정되면 MCP 인증이 통째로 무력화됨** (`mcp-router.js:11`)

```js
if (process.env.WF_MCP_OPEN === '1') {
  req.agent_id = 'ag_connector';
  req.scopes = ['mcp:read', 'mcp:execute', 'mcp:admin'];   // ← Bearer 없이 admin
  return next();
}
```

주석에 "Custom Connector OAuth 대응"이라 적혀 있다 — 문서 §5의 *"Claude Desktop … OAuth 한계로 제한적"* 이슈를
우회하려고 **한 번이라도 켰다면 그대로 남아 있을 수 있다.** 켜져 있으면 인터넷에 admin MCP가 무인증 공개된 상태다.

**(b) `WF_VAULT_KEY` — 미설정 시 공개 저장소의 리터럴 키로 암호화** (`server.js:818`)

```js
const VAULT_KEY = process.env.WF_VAULT_KEY || 'wf-vault-local-key-2026';
```

문서 §10의 "시크릿 볼트 AES-256-CTR"은, 이 변수가 미설정이면 **키가 GitHub에 공개된 암호화**다.

**확인 명령 (VPS):**
```bash
npx pm2 env 0 | grep -E 'WF_MCP_OPEN|WF_VAULT_KEY|WF_ACCESS_TOKEN'
```
`WF_MCP_OPEN=1`이면 **즉시 해제 후 재시작.** `WF_VAULT_KEY`가 비어 있으면 키 설정 후 볼트 재암호화.

### 🟠 P1 — 서버 카드가 평문 HTTP 주소를 광고함

`/.well-known/mcp-server-card` 응답:

```json
"endpoints": { "mcp": "http://187.127.124.16.sslip.io/mcp" }
```

실제로 동작하는 건 `https://`인데, **디스커버리 카드는 `http://`를 알려준다.**
카드를 보고 자동 연결하는 클라이언트는 Bearer 토큰을 **평문으로 전송**하게 된다.
→ 서버 카드 생성부의 스킴을 `https`로 수정.

### 🟡 P2 — 8/14 22:28:20 대량 쓰기: 배포 작업 중 발생, 원인 코드는 미특정

사용자는 "확실히 내가 안 했음"이라고 답했다. 추적 결과는 다음과 같다.

**확인된 사실:**

```
/api/health → uptime 1735.0s @ 2026-08-14T22:57:04Z
  → 서버 부팅            = 2026-08-14T22:28:09.4Z
  → 워크플로우 50개 쓰기 = 2026-08-14T22:28:20.44 ~ .68Z   (부팅 +11.0초)

git log:
  22:24:19  1510a23  "15-agent orchestration team … session bootstrap (idempotent)"
  22:28:09  ← 서버 부팅 (이 커밋 배포)
  22:28:20  ← 50행 일괄 기록
  22:30:29  e1fca10  "team orchestration template"
```

즉 **본인이 활발히 배포 작업을 하던 4분 구간 한복판**에서 발생했다. 외부 침입자가 이 타이밍을 맞출 이유는 없다.

**그러나 원인 코드는 찾지 못했다.** 배포된 커밋(`1510a23`)과 HEAD(`e1fca10`)의 `server.js`는 동일하며(diff는 `index.html` 3줄뿐), 두 버전 모두 **부팅 시 `wf_workflows`를 일괄 기록하는 코드가 없다.** `scheduler.py`·`agent_orchestrator.py`도 읽기만 한다.

**남은 유력 가설 (DB 접근이 있어야 확정 가능):**
1. `wf_workflows`에 `BEFORE UPDATE → updated_at = now()` **트리거**가 있고, 그 시점에 `ALTER TABLE`(예: `schedule`/`trigger_type` 컬럼 추가)이나 정규화 마이그레이션이 돌면서 전 행이 스탬프됨 — **가장 유력**
2. 배포 스크립트의 덤프 복원/재시드 단계

**닫는 방법 (VPS에서 실행):**
```sql
SELECT tgname FROM pg_trigger WHERE tgrelid = 'wf_workflows'::regclass AND NOT tgisinternal;
SELECT * FROM audit_logs WHERE created_at BETWEEN '2026-08-14 22:27' AND '2026-08-14 22:30' ORDER BY created_at;
```
`.hermes/plans/` 와 셸 히스토리도 같은 시각대를 확인할 것.

**판단: 침해 정황은 없다. 신규 작업을 막을 사유는 아니되, 위 SQL 두 줄로 확실히 닫고 갈 것.**

---

## 3. 버그 / 데이터 위생

### `workflow.list`의 `node_count`가 전부 0 — **원인 확정, 1줄 수정**

MCP `workflow.list`는 50개 전부 `node_count: 0`으로 보고한다. 실제로는 데이터가 멀쩡하다
(`GET /api/workflows/wf_tpl_team` → 노드 11 / 엣지 13).

원인은 **`mcp-router.js:142`**:

```js
const wfs = rows.map(r => {
  let d = {};
  try { d = JSON.parse(r.data); } catch (e) {}   // ← 여기
  return { id: r.id, name: r.name, node_count: (d.nodes || []).length, ... };
});
```

`data` 컬럼은 **JSONB**이고, `pg` 드라이버가 **이미 객체로 파싱해서** 준다.
그런데 그 객체를 다시 `JSON.parse()`에 넣으면 → 문자열 `"[object Object]"`로 강제 변환 → `SyntaxError` →
**빈 `catch (e) {}`가 조용히 삼킴** → `d`는 `{}` 그대로 → 전 행 `node_count: 0`.

`/api/workflows/:id`가 `data`를 중첩 객체로 정상 반환하는 것이 JSONB 자동 파싱의 증거다.

**수정:**
```js
const d = (typeof r.data === 'string') ? (JSON.parse(r.data) || {}) : (r.data || {});
```

같은 파일에 빈 `catch (e) {}`가 여럿 있다. 이 버그가 조용히 넘어간 이유가 정확히 그 패턴이므로,
최소한 `console.warn` 정도는 남기도록 함께 손볼 것.

부가: `/api/workflows`(웹용)는 노드 수 필드를 **아예 반환하지 않는다.** 웹 목록과 MCP 목록의 응답 형태가 서로 다르다.

### 에이전트 26개 중 11개가 테스트 잔여물

문서 §3은 15명, §8은 26개로 적혀 있어 문서 내부에서 두 숫자가 화해되지 않는다. 실제는 **15 + 테스트 11**:

```
ag_dbg, ag_e2e, ag_fail, ag_rt3, ag_rt4, ag_rt5, ag_rt6, ag_rt7,
ag_mss6y6s2, ag_claude1, ag_claude_desktop
```

`ag_rt5`/`ag_rt6`는 이름이 그냥 `t`다. 정리 대상.

### 에이전트 메타데이터가 전부 비어 있음

26개 **전원** `capabilities: []`, `tools: []`, `trust_score: 0`.
→ 문서 §6의 7차(신뢰도)·11차(리뷰어) 기능은 **스키마만 있고 데이터가 없다.**
→ `agent.list(capability=...)` 필터는 현재 항상 빈 결과다. 사실상 죽은 기능.

### 워크플로우 50개 중 다수가 테스트 잔여물

`wf_t`(툴팁), `wf_edge`, `wf_line`, `wf_long`, `wf_empty`, `새 워크플로우 30/31/32` 등.
게다가 템플릿이 **중복**돼 있다 — `wf_tpl_team` **과** `wf_tpl_team_mstiqejr`, `wf_tpl_research` **과** `wf_tpl_research_mstgmj8z`, review도 동일.
문서 §7은 템플릿 6종이라 했지만 실제 목록에는 각각 2벌씩 존재한다. **어느 쪽이 정본인지** 정해야 한다.

---

## 4. 문서 자체의 문제 (시작하기 전에 메워야 할 구멍)

1. **§12 제목이 "환경 변수 / 실행 명령"인데 환경 변수가 하나도 없다.** 실제 전체 목록은 7개뿐이다:

   | 변수 | 기본값 | 비고 |
   |---|---|---|
   | `PORT` | `3737` | |
   | `WF_ACCESS_TOKEN` | `null` | |
   | `WF_ALLOWED_ORIGINS` | `https://joker8awesome.github.io` | CORS |
   | `WF_VAULT_KEY` | `'wf-vault-local-key-2026'` | ⚠ 아래 참조 |
   | `WF_MCP_OPEN` | — | ⚠ 아래 참조 |
   | `WF_MCP_STRICT_HEADERS` | — | |
   | `PATH` | — | |

2. **🔴 로컬 개발의 실제 blocker — DB 접속이 하드코딩돼 있다.** `server.js:60`:

   ```js
   const pool = new Pool({
     host: '/opt/data/pgdata',   // ← Unix 도메인 소켓 경로
     database: 'odds',
     user: 'hermes',
   });
   ```

   **환경 변수가 하나도 없고, `host`가 Unix 소켓 경로다. Windows에서는 원리적으로 연결 불가.**
   → 로컬 개발을 하려면 **이 블록의 파라미터화가 1번 작업**이다:

   ```js
   const pool = new Pool(process.env.DATABASE_URL
     ? { connectionString: process.env.DATABASE_URL }
     : { host: process.env.PGHOST || '/opt/data/pgdata',
         database: process.env.PGDATABASE || 'odds',
         user: process.env.PGUSER || 'hermes',
         password: process.env.PGPASSWORD,
         port: process.env.PGPORT });
   ```
   기존 VPS 동작은 기본값으로 그대로 보존된다 (무중단 변경).

3. **§8: "26 테이블"이라 쓰고 16개만 나열.** 나머지 10개 미상.

4. **주소가 전부 생 IP 하나에 묶여 있다.** 스펙·`.mcp.json`·서버 카드 3곳 모두 `187.127.124.16.sslip.io`.
   IP가 바뀌면 **셋이 동시에 깨진다.** 도메인 + 단일 설정 출처로 뽑아낼 것.

5. **"다음에 뭘 할지"가 없다.** 16차까지의 완료 이력은 있는데 백로그·미완 항목·알려진 이슈가 없다.
   "이제 시작"하려는 사람에게 정확히 필요한 부분이 비어 있다.

---

## 5. 문서 주장 검증 결과 (저장소 클론 후)

### ✅ 정확히 일치 — 문서 신뢰도 높음

| 문서 주장 | 실측 | 판정 |
|---|---|---|
| `index.html` 5,491줄 | 5,491 | ✅ |
| `server.js` 1,462줄 | 1,462 | ✅ |
| API 78개 | `app.(get\|post\|put\|patch\|delete)` = 78 | ✅ |
| 커밋 81개 | 81 | ✅ |
| SSRF 내부 IP 차단 | `isInternalHost()` — 127./10./localhost/.local/.internal | ✅ 존재 |
| 속도 제한 | `rateBuckets` 구현 존재 | ✅ 존재 |
| CORS 제한 | 커밋 `c7b018b`에서 GitHub Pages + localhost로 제한 | ✅ |

숫자를 지어내지 않은 문서다. 이 점은 신뢰의 근거가 된다.

### ⏳ 아직 미검증 (VPS 접근 필요)

- pm2 online / scheduler.py 30초 폴링 / Hermes cron / `wf_backup.sh`
- §8 "26 테이블" (16개만 나열) — 실제 스키마 확인 필요
- §11 VPS 용량 수치
- AES-256-CTR 볼트, PII 레드액션의 실제 적용 범위

### 📄 `MIGRATION.md`는 낡았음

"단일 HTML 파일 (17.5KB), 외부 리소스 0개, localStorage 기반"이라고 적혀 있으나
현재는 5,491줄 + Postgres 백엔드 + 로컬 폰트 3종이다. **초기 버전 문서가 그대로 남은 것.**
로컬 개발 문서를 쓸 때 이 파일부터 교체할 것.

---

## 6. 권장 시작 순서

확정된 방향: **저장소 클론 후 Windows 로컬 개발.**

### 완료됨 (이번 세션)

- [x] 저장소를 `D:\Comment_Center`에 체크아웃 (`main` @ `e1fca10`, 커밋 81개). 기존 파일 3개 보존됨
- [x] 키 노출 여부 확인 — **노출 없음** (히스토리 81커밋 전수 검사)
- [x] `.gitignore`에 `.mcp.json` + `.claude/settings.local.json` 추가 (**유일하게 수정한 파일**)
- [x] 문서 수치 주장 검증 (5,491 / 1,462 / 78 / 81 전부 일치)
- [x] `node_count` 버그 원인 확정 (`mcp-router.js:142`)

### 다음 (권장 순서)

1. **🔴 VPS에서 `WF_MCP_OPEN` / `WF_VAULT_KEY` 확인** — 코드만 보고는 판정 불가, 5초면 끝남
   ```bash
   npx pm2 env 0 | grep -E 'WF_MCP_OPEN|WF_VAULT_KEY|WF_ACCESS_TOKEN'
   ```
2. **DB 접속 파라미터화** (`server.js:60`) — 기본값을 유지하므로 VPS 동작에는 영향 없음
3. **로컬 Postgres 17 설치 + 스키마 확보** — VPS에서 `pg_dump --schema-only`로 26개 테이블 실측 겸 확보

   > ⚠️ **2번만으로는 로컬에서 서버가 뜨지 않습니다.** 2번은 "연결할 수 있게" 만들 뿐이고,
   > 연결할 **대상 DB가 아직 없습니다.** `node server.js`는 2번 단독으로는 여전히 실패합니다.
   > **2 + 3을 한 묶음으로** 처리하세요.

4. `.env.example` 작성 + 스펙 §12를 실제 환경 변수 표로 교체
5. `node_count` 1줄 수정 + 빈 `catch` 로깅 추가
6. 서버 카드 `https` 수정
7. 테스트 잔여물 정리 (에이전트 11개 / 워크플로우 다수 / 템플릿 중복 — **어느 쪽이 정본인지 먼저 결정**)
8. `MIGRATION.md` 교체 (현재 내용은 초기 localStorage 버전 기준으로 낡음)
9. 8/14 대량 쓰기 트리거 확인 SQL 2줄 (§2 참조)
10. 그 다음에 신규 기능

**2~5번은 서로 엮여 있어서 한 덩어리로 처리하는 게 낫습니다.**
