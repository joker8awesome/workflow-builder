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

def send_message(from_agent, to_agent, msg_type, payload, session_id=""):
    """에이전트 간 메시지 전송"""
    conn = db()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO agent_messages (msg_type, from_agent, to_agent, session_id, payload, status)
           VALUES (%s,%s,%s,%s,%s,'sent')""",
        (msg_type, from_agent, to_agent, session_id, json.dumps(payload, ensure_ascii=False)),
    )
    conn.commit()
    msg_id = cur.lastrowid
    conn.close()
    return msg_id

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

def run_workflow(wf_id, dry=False):
    wf = load_workflow(wf_id)
    print(f"=== 워크플로우 실행: {wf['name']} ===")
    sessions = create_sessions(wf)
    print(f"에이전트 세션 {len(sessions)}개 생성")

    global wf_edges
    wf_edges = wf["data"].get("edges", [])
    nodes = wf["data"].get("nodes", [])
    node_map = {n["id"]: n for n in nodes}
    ctx = {"score": 85, "count": 3, "status": "ok"}

    # 시작 노드부터 DFS 실행
    start = next((n for n in nodes if n.get("type") == "start"), nodes[0])
    visited = set()
    report_chain = []

    def visit(node_id):
        if node_id in visited:
            return
        visited.add(node_id)
        node = node_map.get(node_id)
        if not node:
            return
        agent_id = node.get("agentId")
        session = next((s for s in sessions if s["node_id"] == node_id), None)

        # 명령/지시 메시지: 선행 에이전트 → 이 노드 에이전트
        if session and agent_id:
            prev_edges = [e for e in wf_edges if e["to"] == node_id]
            for pe in prev_edges:
                prev_node = node_map.get(pe["from"])
                prev_agent = prev_node.get("agentId") if prev_node else None
                if prev_agent and prev_agent != agent_id:
                    send_message(
                        prev_agent, agent_id, "command",
                        {"action": "execute", "node": node_id, "label": node.get("label", "")},
                        session["session_id"],
                    )
                    print(f"  명령: {prev_agent} → {agent_id} ({node.get('label','')})")

        result, next_id = execute_node(node, ctx, session or {"session_id": "-"})

        # 보고: 이 노드 → 선행 에이전트 회신
        if session and agent_id:
            prev_edges = [e for e in wf_edges if e["to"] == node_id]
            for pe in prev_edges:
                prev_node = node_map.get(pe["from"])
                prev_agent = prev_node.get("agentId") if prev_node else None
                if prev_agent and prev_agent != agent_id:
                    send_message(
                        agent_id, prev_agent, "report",
                        {"node": node_id, "label": node.get("label", ""), "ok": result["ok"]},
                        session["session_id"],
                    )
                    print(f"  보고: {agent_id} → {prev_agent} ({node.get('label','')})")

        report_chain.append(result)
        if next_id:
            visit(next_id)

    visit(start["id"])
    print(f"=== 완료: {len(report_chain)}개 노드 실행 ===")
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
