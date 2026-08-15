# 🔧 Hermes 봇 작업 지시서 #2 — `online` / `active_sessions` 복구

발신: Claude Code (로컬 Windows 세션)
수신: **Hermes Agent (VPS)**
작성일: 2026-08-15 (v2 — `git pull` 방식으로 갱신)
선행: 지시서 #1 완료 (커밋 `06acf07` 배포됨)
대상 커밋: **`f0894a3`** (main 에 머지 완료 — `git pull` 로 바로 받으면 된다)

---

## 배경 — 지시서 #1에서 놓친 것

지시서 #1 STEP 2에서 `agent_sessions.status = idle`을 확인하고 **"기대값 일치"로 판정**했으나,
지시서가 명시한 기대값은 `running` / `working` / `waiting`이었다. `idle`은 셋 중 하나가 아니다.

STEP 4의 `online 0 (전원 idle — 정상)` 역시 **"정상적으로 0"과 "영원히 0"을 구분하지 못하는 결과**다.

### 실측 결과 (로컬에서 확인)

```
라이브 세션 19개 → status 전부 'idle'
/api/team/status → active_sessions 전원 "0", total_sessions 전원 "1"
```

코드 전수 조사 결과 `running`/`working`/`waiting`을 **쓰는 곳이 한 군데도 없다**:

| 위치 | 실제로 쓰는 값 |
|---|---|
| `agent_orchestrator.py:52` | `'idle'` 하드코딩 |
| `server.js:777` (INSERT) | `status \|\| 'idle'` |
| `server.js:816` (UPDATE) | `status \|\| 'idle'` |
| `index.html` | `idle` / `ok` / `fail` |

**결론:**
- `agent.list`의 `online` → 구조적으로 항상 false
- `/api/team/status`의 `active_sessions` → 항상 0
- **팀 대시보드 실시간 ●○ 표시(스펙 §4)가 처음부터 동작한 적 없음** — 기존 버그

> 이건 지시서 #1의 배포가 잘못됐다는 뜻이 아니다. `capability` 필터는 정상 동작한다.
> `online`만 데이터가 뒷받침된 적이 없었다.

---

## 수정 방침 — 정공법 (사용자 결정)

오케스트레이터가 노드 실행 시작 시 `running`으로 전환하고, 종료 시 `done`/`failed`로 빠진다.

**핵심:** 오케스트레이터는 **이미** `agent_checkpoints`에 `running`/`done`/`failed`를 기록하고 있었다
(`agent_orchestrator.py` 301·352행). 같은 전이를 `agent_sessions`에도 반영하는 것뿐이다.

### 상태 어휘 (확정)

```
활성: running(실행 중) · working(작업 중) · waiting(대기 중)   ← online = true
종료: done(성공) · failed(실패) · idle(미시작)                 ← online = false
```

이 어휘는 **세 곳이 반드시 일치**해야 한다:
`agent_orchestrator.py`의 `ACTIVE_STATUSES` · `mcp-router.js:185` · `server.js:313`

---

## STEP 1 — `git pull` 로 받기

수정 대상은 **`agent_orchestrator.py` 하나뿐이다.** JS는 이번에 바뀌지 않았다.

로컬 브랜치가 `main`에 머지되어 이제 `git pull` 로 바로 받을 수 있다 (기준 `f0894a3`).

```bash
cd /opt/data/workflow-builder    # 실제 경로에 맞게

# 1) 현재 상태 확인 — 반드시 먼저
git status --short               # 출력이 비어 있어야 한다
git rev-parse --short HEAD       # 06acf07 이어야 한다

# 2) 로컬 수정이 남아 있으면 백업 후 정리 (VPS에서 직접 편집했던 흔적)
#    출력이 비어 있지 않으면 여기서 멈추고 보고할 것

# 3) 받기
git pull origin main
git rev-parse --short HEAD       # f0894a3 이어야 한다

# 4) 문법 확인
./.agentenv/bin/python -m py_compile agent_orchestrator.py
```

### 이번 pull 로 바뀌는 것

| 파일 | 내용 |
|---|---|
| `agent_orchestrator.py` | ← **이번 수정의 본체** |
| `ops/test-session-status.py` | 검증 스크립트 (STEP 2에서 사용) |
| `ops/fill-agent-metadata.js` + 스냅샷 | 지난 작업 기록용 |
| `.env.example` · `.gitignore` | 문서/무시 규칙 |

### ⚠️ `pm2 restart` 는 필요 없다

`mcp-router.js` 와 `server.js` 는 **이번 머지로 바뀌지 않았다.**
(머지 시 `mcp-router.js` 충돌이 있었으나, 당신이 적용한 `06acf07` 쪽 코드가
브랜치와 완전히 동일해서 main 버전을 그대로 채택했다 — 파일 무변경 확인 완료)

오케스트레이터는 pm2 프로세스가 아니라 별도 실행 스크립트이므로
**다음 실행부터 새 코드가 자동 적용된다.**

<details>
<summary>pull 이 막힐 때만 — 수동 적용 (펼치기)</summary>

VPS 저장소에 커밋되지 않은 로컬 수정이 있어 pull 이 거부되면, 먼저 그 사실을 보고할 것.
그래도 진행해야 한다면 `agent_orchestrator.py` 에 아래 5곳을 적용한다.

**(a) 상단 — DSN 파라미터화 + 어휘 상수 + 헬퍼 2개**

```python
DB_DSN = os.environ.get("DATABASE_URL") or (
    "host=%s dbname=%s user=%s" % (
        os.environ.get("PGHOST", "/opt/data/pgdata"),
        os.environ.get("PGDATABASE", "odds"),
        os.environ.get("PGUSER", "hermes"),
    )
)

# agent_sessions.status 어휘 — online/active_sessions 판정의 단일 기준.
ACTIVE_STATUSES = ("running", "working", "waiting")

def set_session_status(session_id, status):
    if not session_id or session_id == "-":
        return
    try:
        conn = db(); cur = conn.cursor()
        cur.execute("UPDATE agent_sessions SET status=%s, updated_at=now() WHERE id=%s",
                    (status, session_id))
        conn.commit(); conn.close()
    except Exception as e:
        print(f"  [warn] 세션 상태 갱신 실패 {session_id} -> {status}: {e}")

def reset_stale_sessions(wf_id):
    """프로세스가 죽으면 running 에 고착되어 online 이 영구 true 가 된다. 쓸어낸다."""
    try:
        conn = db(); cur = conn.cursor()
        cur.execute("UPDATE agent_sessions SET status='idle', updated_at=now() "
                    "WHERE wf_id=%s AND status = ANY(%s)", (wf_id, list(ACTIVE_STATUSES)))
        n = cur.rowcount
        conn.commit(); conn.close()
        if n:
            print(f"  [정리] 활성 상태로 남아 있던 세션 {n}개를 idle로 되돌림")
    except Exception as e:
        print(f"  [warn] 잔여 세션 정리 실패: {e}")
```

**(b) `visit()` — 실행 전 running**

```python
        if session:
            checkpoint(sess_id, wf_id, node_id, "running", {"label": node.get("label", "")})
            set_session_status(sess_id, "running")      # ← 추가
```

**(c) `visit()` — execute_node 를 try 로 감싸기**

```python
        try:
            result, next_id = execute_node(node, ctx, session or {"session_id": "-"})
        except Exception:
            if session:
                set_session_status(sess_id, "failed")
                checkpoint(sess_id, wf_id, node_id, "failed", {"error": "execute_node 예외"})
            raise
```

**(d) `visit()` — 실행 후 종료 상태**

```python
        if session:
            _final = "done" if result.get("ok") else "failed"
            checkpoint(sess_id, wf_id, node_id, _final, result)
            set_session_status(sess_id, _final)          # ← 추가
```

**(e) `run_workflow()` — 시작 시 정리 + finally sweep**

```python
    reset_stale_sessions(wf_id)        # create_sessions 바로 앞
    sessions = create_sessions(wf)
    ...
    try:
        visit(start["id"])
    finally:
        reset_stale_sessions(wf_id)    # 정상/비정상 무관하게 정리
```

</details>

---

## STEP 2 — 자동 검증 (DB 불필요)

```bash
./.agentenv/bin/python ops/test-session-status.py
```

10건 전부 PASS 여야 한다. 특히 아래 두 건이 핵심:

- `mcp-router.js 필터 일치` / `server.js 필터 일치` — 세 파일 어휘 동기화 확인
- `execute_node 호출부를 try 로 감쌈` — 예외 시 running 고착 방지 확인

**하나라도 FAIL 이면 배포하지 말고 출력 그대로 보고할 것.**

---

## STEP 3 — 실제 실행으로 확인

```bash
# 실행 중 다른 터미널에서 관찰해야 한다 (실행이 끝나면 다시 0으로 돌아감)
./.agentenv/bin/python agent_orchestrator.py --workflow wf_tpl_team --run
```

실행 **도중** 다른 셸에서:

```sql
SELECT status, count(*) FROM agent_sessions GROUP BY status;
```

| 시점 | 기대 |
|---|---|
| 실행 전 | `idle` 만 |
| **실행 중** | **`running` 이 1개 이상 나타남** ← 이게 핵심 |
| 실행 후 | `done` / `failed` 로 정리, `running` 0개 |

노드에 `delay` 속성이 없으면 순식간에 끝나 관측이 어렵다. 그럴 땐 실행 직후:

```sql
SELECT status, count(*) FROM agent_sessions GROUP BY status;   -- done/failed 가 생겼는지
```

`done` 또는 `failed` 가 하나라도 생겼다면 전이는 동작한 것이다 (이전에는 영원히 `idle` 뿐이었다).

---

## STEP 4 — 지표 확인

```bash
curl -s -H "Authorization: Bearer <MCP_KEY>" \
  https://187.127.124.16.sslip.io/api/team/status | head -c 400
```

- 실행 중이면 `active_sessions`가 **0이 아닌 값**을 가져야 한다
- 실행이 끝난 뒤면 다시 0 — **이건 정상**이다

`agent.list {online_only:true}` 도 실행 중에는 결과가 나와야 한다.

> ⚠️ **주의:** 실행이 끝난 뒤 0이 나오는 것을 실패로 판정하지 말 것.
> 지시서 #1에서 정확히 이 지점을 잘못 읽었다. **실행 중에 관측해야 한다.**

---

## STEP 5 — 롤백

`git pull` 로 받았으므로 파일 백업이 아니라 git 으로 되돌린다.

```bash
# 오케스트레이터만 이전 상태로 (권장 — 나머지 추가 파일은 무해하므로 남겨둔다)
git checkout 06acf07 -- agent_orchestrator.py
./.agentenv/bin/python -m py_compile agent_orchestrator.py

# 또는 머지 전체를 되돌려야 하면
git reset --hard 06acf07     # ⚠ 이후 커밋이 있으면 유실된다. 실행 전 git log 확인
```

pm2 재시작은 **불필요하다** (오케스트레이터는 별도 프로세스로 실행되는 스크립트).
`server.js`·`mcp-router.js`는 이번 머지로 바뀌지 않았다.

**DB 롤백은 필요 없다.** 이번 수정은 세션 상태를 정상 전이시킬 뿐이고,
`reset_stale_sessions` 가 활성 잔여물을 `idle` 로 되돌리므로 되돌린 뒤에도 데이터는 일관된다.

---

## 하지 말 것

1. **JS 파일을 수정하지 말 것** — 필터는 이미 올바르다. 바꾸면 어휘가 어긋난다
2. **`agent_sessions`에 직접 UPDATE로 `running`을 넣어 검증하지 말 것** — 그건 테스트가 아니라 위조다
3. **`index.html`의 `ok`/`fail` 을 건드리지 말 것** — 별건이며 이번 범위 밖 (아래 참조)
4. **STEP 2가 FAIL인 채로 진행하지 말 것**

---

## 별건으로 남겨둔 것 (지금 고치지 않음)

`index.html`은 세션 상태로 `ok`/`fail`을 보내는데, 오케스트레이터는 `done`/`failed`를 쓴다.
**같은 개념에 두 어휘가 공존**한다. `online` 판정에는 영향이 없어(둘 다 비활성) 이번 범위에서 제외했다.

정리하려면 UI·서버·오케스트레이터를 함께 봐야 하므로 별도 작업으로 잡을 것.
`server.js:816`이 클라이언트가 보낸 임의 문자열을 그대로 저장하는 점도 같이 검토 대상이다.

---

## 보고 양식

```
[STEP 1] git pull
- git status --short 출력 : 비어 있음 / 아래 내용 있음(→ 보고 후 중단)
- pull 전 HEAD           : ______  (06acf07 기대)
- pull 후 HEAD           : ______  (f0894a3 기대)
- py_compile             : 성공 / 실패

[STEP 2] 자동 검증
- ops/test-session-status.py : __/10 PASS
- FAIL 항목 (있으면 출력 그대로):

[STEP 3] 실제 실행
- 실행 전 status 분포 :
- 실행 중 status 분포 :   ← running 이 보였는가 Y/N
- 실행 후 status 분포 :

[STEP 4] 지표
- 실행 중 active_sessions : ____
- 실행 후 active_sessions : ____ (0이면 정상)
- agent.list {online_only:true} 실행 중 결과 : __명

[결과] 완료 / 진행 / 차단(사유)
```

보고 후 `deepbot_action.md`의 `## 작업 로그`에 기록할 것.
