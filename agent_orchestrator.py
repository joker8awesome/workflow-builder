#!/usr/bin/env python3
"""
에이전트 세션 오케스트레이터
- 워크플로우 정의(JSON)를 읽어 노드별 에이전트 세션 생성
- 에이전트 간 명령(command)/지시(instruction)/보고(report) 메시지 라우팅
- 실행: python agent_orchestrator.py --workflow wf_id --run

DB: odds (agent_sessions, agent_messages)
"""
import argparse
import json
import os
import sys
import time
import uuid
from datetime import datetime

import psycopg2

DB_DSN = "host=/opt/data/pgdata dbname=odds user=hermes"

def db():
    return psycopg2.connect(DB_DSN)

def now():
    return datetime.utcnow().isoformat()

def load_workflow(wf_id):
    """서버 DB(wf_workflows)에서 워크플로우 로드"""
    conn = db()
    cur = conn.cursor()
    cur.execute("SELECT id, name, data FROM wf_workflows WHERE id = %s", (wf_id,))
    row = cur.fetchone()
    conn.close()
    if not row:
        raise SystemExit(f"워크플로우 없음: {wf_id}")
    return {"id": row[0], "name": row[1], "data": row[2]}

def create_sessions(wf):
    """워크플로우의 각 노드에 에이전트 세션 생성 (agentId 있는 노드만)"""
    conn = db()
    cur = conn.cursor()
    sessions = []
    for node in wf["data"].get("nodes", []):
        agent_id = node.get("agentId")
        if not agent_id:
            continue
        sess_id = "sess_" + uuid.uuid4().hex[:10]
        workspace = f"/opt/data/agents/{agent_id}"
        cur.execute(
            """INSERT INTO agent_sessions (id, agent_id, node_id, wf_id, status, workspace)
               VALUES (%s,%s,%s,%s,'idle',%s)
               ON CONFLICT (id) DO NOTHING""",
            (sess_id, agent_id, node["id"], wf["id"], workspace),
        )
        sessions.append({
            "session_id": sess_id, "agent_id": agent_id,
            "node_id": node["id"], "label": node.get("label", ""),
            "workspace": workspace,
        })
    conn.commit()
    conn.close()
    return sessions

def send_message(from_agent, to_agent, msg_type, payload, session_id="",
                  trace_id="", parent_id="", payload_ref="", task_status="completed"):
    """에이전트 간 메시지 전송 — A2A 스타일 (trace/참조/lifecycle)"""
    conn = db()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO agent_messages
           (msg_type, from_agent, to_agent, session_id, payload, status, trace_id, parent_id, payload_ref, task_status)
           VALUES (%s,%s,%s,%s,%s,'sent',%s,%s,%s,%s) RETURNING id""",
        (msg_type, from_agent, to_agent, session_id, json.dumps(payload, ensure_ascii=False),
         trace_id, parent_id, payload_ref, task_status),
    )
    msg_id = cur.fetchone()[0]
    conn.commit()
    conn.close()
    return msg_id

def store_payload_ref(data, wf_id="", node_id=""):
    """payload-by-reference: 큰 데이터를 DB에 저장하고 참조 id 반환"""
    conn = db()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO wf_results (wf_id, node_id, result, run_at) VALUES (%s, %s, %s, now()) RETURNING id""",
        (wf_id, node_id, json.dumps(data, ensure_ascii=False)),
    )
    rid = cur.fetchone()[0]
    conn.commit()
    conn.close()
    return f"result_{rid}"

def poll_inbox(session_id, agent_id, mark_read=True):
    """에이전트 세션의 수신 메시지 폴링"""
    conn = db()
    cur = conn.cursor()
    cur.execute(
        """SELECT id, msg_type, from_agent, to_agent, payload, created_at
           FROM agent_messages
           WHERE to_agent = %s AND status = 'sent'
           ORDER BY id ASC""",
        (agent_id,),
    )
    rows = cur.fetchall()
    if mark_read and rows:
        ids = [r[0] for r in rows]
        cur.execute(
            "UPDATE agent_messages SET status='read', read_at=now() WHERE id = ANY(%s)",
            (ids,),
        )
        conn.commit()
    conn.close()
    return [
        {"id": r[0], "type": r[1], "from": r[2], "to": r[3],
         "payload": r[4], "time": r[5].isoformat()}
        for r in rows
    ]

def checkpoint(session_id, wf_id, node_id, status, data=None):
    """세션 체크포인트 — 중단 후 재개용"""
    conn = db()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO agent_checkpoints (session_id, wf_id, node_id, status, data)
           VALUES (%s,%s,%s,%s,%s)""",
        (session_id, wf_id, node_id, status, json.dumps(data or {}, ensure_ascii=False)),
    )
    conn.commit()
    conn.close()

def last_checkpoint(session_id):
    """마지막 체크포인트 조회"""
    conn = db()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, node_id, status, data FROM agent_checkpoints WHERE session_id=%s ORDER BY id DESC LIMIT 1",
        (session_id,),
    )
    row = cur.fetchone()
    conn.close()
    return {"id": row[0], "node_id": row[1], "status": row[2], "data": row[3]} if row else None

def add_span(trace_id, parent_id, session_id, node_id, agent_id, operation, duration_ms, result=None):
    """분산 추적 스팬 기록"""
    conn = db()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO agent_spans (trace_id, parent_id, session_id, node_id, agent_id, operation, duration_ms, result)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
        (trace_id, parent_id, session_id, node_id, agent_id, operation, duration_ms,
         json.dumps(result or {}, ensure_ascii=False)),
    )
    conn.commit()
    conn.close()

def register_agent_card(agent_id, name, description, capabilities, tools):
    """Agent Card — 에이전트 능력 선언"""
    conn = db()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO agent_cards (id, name, description, capabilities, tools)
           VALUES (%s,%s,%s,%s,%s)
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
             capabilities=EXCLUDED.capabilities, tools=EXCLUDED.tools, updated_at=now()""",
        (agent_id, name, description, json.dumps(capabilities), json.dumps(tools)),
    )
    conn.commit()
    conn.close()

def execute_node(node, ctx, session):
    """단일 노드 실행 — 액션/스크립트 수행 + 보고 전송"""
    node_id = node["id"]
    label = node.get("label", node_id)
    action = node.get("action", "")
    print(f"  [세션 {session['session_id']}] {label} 실행...")

    result = {"ok": True, "node": node_id, "label": label}

    if action == "telegram":
        result["message"] = f"[보고] {label} 완료"
    elif action and not action.startswith("http"):
        # 로컬 스크립트 실행 (안전 화이트리스트)
        import subprocess
        SAFE = r"^[a-zA-Z0-9_/.\-\s=]+$"
        import re
        if re.match(SAFE, action):
            try:
                out = subprocess.run(
                    action.split(), capture_output=True, text=True, timeout=10,
                    cwd=session["workspace"] if os.path.isdir(session["workspace"]) else None,
                )
                result["output"] = out.stdout[:500]
                result["ok"] = out.returncode == 0
            except Exception as e:
                result["ok"] = False
                result["error"] = str(e)
        else:
            result["ok"] = False
            result["error"] = "unsafe command"
    else:
        result["output"] = f"{label} 시뮬레이션 완료"

    # 조건식/분기 처리 (다음 노드 결정)
    next_node_id = None
    if node.get("type") == "decision":
        yes = bool(node.get("condition", "")) and eval_condition(node["condition"], ctx)
        edges = [e for e in wf_edges if e["from"] == node_id]
        next_edge = next((e for e in edges if (e.get("label") == "Yes") == yes), None)
        next_node_id = next_edge["to"] if next_edge else None
    else:
        edges = [e for e in wf_edges if e["from"] == node_id]
        next_node_id = edges[0]["to"] if edges else None

    return result, next_node_id

def eval_condition(expr, ctx):
    """안전한 조건식 평가 (프로토타입 차단)"""
    import re
    if re.search(r"constructor|prototype|__proto__", expr or ""):
        return False
    try:
        allowed = re.sub(r"[^0-9a-zA-Z_\s.()+*\-/<>!=&|'\"-]", "", expr or "")
        return bool(eval(allowed, {"__builtins__": {}}, dict(ctx)))
    except Exception:
        return False

def save_run_snapshot(wf_id, node_id, phase, data):
    """실행 스냅샷 보존 — 재현성/감사"""
    try:
        conn = db()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO wf_results (wf_id, node_id, result) VALUES (%s,%s,%s)",
            (wf_id, node_id + '_' + phase, json.dumps(data, ensure_ascii=False)[:2000])
        )
        conn.commit()
        conn.close()
    except Exception:
        pass

def run_workflow(wf_id, dry=False):
    wf = load_workflow(wf_id)
    print(f"=== 워크플로우 실행: {wf['name']} ===")
    # 실행 스냅샷 — 시작 시각/노드 수 (wf 데이터에서 계산)
    try:
        _snap_data = json.loads(wf.get('data', '{}')) if isinstance(wf.get('data'), str) else (wf.get('data') or {})
        save_run_snapshot(wf_id, 'wf', 'start', {'nodes': len(_snap_data.get('nodes', [])), 'edges': len(_snap_data.get('edges', [])), 'ts': now()})
    except Exception:
        pass
    sessions = create_sessions(wf)
    print(f"에이전트 세션 {len(sessions)}개 생성")

    global wf_edges
    wf_edges = wf["data"].get("edges", [])
    nodes = wf["data"].get("nodes", [])
    node_map = {n["id"]: n for n in nodes}
    ctx = {"score": 85, "count": 3, "status": "ok"}

    # Agent Card 등록 (능력 선언)
    for s in sessions:
        register_agent_card(s["agent_id"], s["agent_id"], s["label"] or s["agent_id"],
                            ["execute", "report"], ["script", "telegram"])

    # 시작 노드부터 DFS 실행 — trace_id 공유
    start = next((n for n in nodes if n.get("type") == "start"), nodes[0])
    trace_id = "trace_" + uuid.uuid4().hex[:10]
    visited = set()
    report_chain = []

    _memo = {}
    def visit(node_id, parent_trace=None, depth=0):
        if node_id in visited:
            return
        visited.add(node_id)
        node = node_map.get(node_id)
        if not node:
            return
        agent_id = node.get("agentId")
        session = next((s for s in sessions if s["node_id"] == node_id), None)
        sess_id = (session or {}).get("session_id", "-")
        import time as _t
        t0 = _t.time()

        # 지연 스텝 — 노드 delay 속성 (초)
        delay_s = float(node.get("delay") or 0)
        if delay_s > 0:
            import time as _delay_t
            _delay_t.sleep(min(delay_s, 3600))

        # 스텝 결과 메모이즈 — 재실행 시 완료 스텝 스킵
        memo_key = (wf_id, node_id)
        if memo_key in _memo:
            print(f"  [memo] {node.get('label', node_id)} 결과 재사용")
            ctx[node_id] = _memo[memo_key]
            return None

        # 체크포인트 — 실행 전 기록
        if session:
            checkpoint(sess_id, wf_id, node_id, "running", {"label": node.get("label", "")})

        # Supervisor 노드: 작업 분해 → 하위 노드 병렬 실행 (fan-out/fan-in)
        # 실행 결과 메모이즈 — execute_node 후 저장
        _node_results = {}
        if node.get("type") == "supervisor":
            children = [e["to"] for e in wf_edges if e["from"] == node_id]
            print(f"  [supervisor] {node.get('label','')} → 하위 {len(children)}개 (병렬)")
            import concurrent.futures as cf
            max_parallel = node.get("max_parallel", 0) or 4
            results_map = {}
            with cf.ThreadPoolExecutor(max_workers=max_parallel) as pool:
                futs = {pool.submit(visit, child, trace_id, depth + 1): child for child in children}
                for fut in cf.as_completed(futs):
                    results_map[futs[fut]] = fut.result()
            # fan-in: 병렬 결과를 컨텍스트에 병합
            for child in children:
                child_node = node_map.get(child)
                child_agent = child_node.get("agentId") if child_node else None
                if child_agent and agent_id and child_agent != agent_id:
                    send_message(agent_id, child_agent, "command",
                                 {"action": "delegate", "node": child, "from_supervisor": node_id},
                                 session_id=sess_id, trace_id=trace_id, parent_id=parent_trace or trace_id)

        # 명령/지시 메시지: 선행 에이전트 → 이 노드 에이전트 (payload-by-reference)
        prev_edges = [e for e in wf_edges if e["to"] == node_id]
        for pe in prev_edges:
            prev_node = node_map.get(pe["from"])
            prev_agent = prev_node.get("agentId") if prev_node else None
            if prev_agent and prev_agent != agent_id and agent_id:
                ref = store_payload_ref({"node": node_id, "label": node.get("label", "")}, wf_id=wf_id, node_id=node_id)
                send_message(
                    prev_agent, agent_id, "command",
                    {"action": "execute", "node": node_id},  # payload 최소화 — ref로
                    session_id=sess_id, trace_id=trace_id, parent_id=parent_trace or trace_id,
                    payload_ref=ref, task_status="working",
                )
                print(f"  명령: {prev_agent} → {agent_id} ({node.get('label','')}) [ref:{ref}]")

        result, next_id = execute_node(node, ctx, session or {"session_id": "-"})
        # 실행 결과 메모이즈
        if result and result.get("ok"):
            _memo[(wf_id, node_id)] = result
        dur_ms = int((_t.time() - t0) * 1000)

        # 스팬 기록
        add_span(trace_id, parent_trace or trace_id, sess_id, node_id, agent_id or "",
                 node.get("label", ""), dur_ms, {"ok": result.get("ok"), "output": (result.get("output") or "")[:200]})

        # 체크포인트 — 실행 후
        if session:
            checkpoint(sess_id, wf_id, node_id, "done" if result.get("ok") else "failed", result)

        # 보고 (trace 상속)
        for pe in prev_edges:
            prev_node = node_map.get(pe["from"])
            prev_agent = prev_node.get("agentId") if prev_node else None
            if prev_agent and prev_agent != agent_id and agent_id:
                send_message(agent_id, prev_agent, "report",
                             {"node": node_id, "ok": result.get("ok")},
                             session_id=sess_id, trace_id=trace_id, parent_id=parent_trace or trace_id,
                             task_status="completed" if result.get("ok") else "failed")
                print(f"  보고: {agent_id} → {prev_agent} ({node.get('label','')})")

        report_chain.append(result)
        if next_id:
            visit(next_id, parent_trace=trace_id, depth=depth + 1)
        return result

    visit(start["id"])
    print(f"=== 완료: {len(report_chain)}개 노드 실행 (trace: {trace_id}) ===")
    return sessions

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workflow", required=True)
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--sessions", action="store_true", help="세션만 생성")
    args = ap.parse_args()

    if args.sessions:
        wf = load_workflow(args.workflow)
        sessions = create_sessions(wf)
        print(json.dumps(sessions, ensure_ascii=False, indent=2))
    elif args.run:
        run_workflow(args.workflow)

if __name__ == "__main__":
    main()
