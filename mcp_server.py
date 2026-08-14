#!/usr/bin/env python3
"""
워크플로우 빌더 MCP 서버 — 외부 AI 세션(Claude 등)이 이 시스템에 붙는 채널

외부 세션은 MCP 툴 5개로 워크플로우 빌더를 조작:
  - workflow_list_pending_tasks(agent_id)  : 내가 처리할 명령 조회 (pull)
  - workflow_get_payload(payload_ref)      : 실제 데이터 로드
  - workflow_report(trace_id, status, result_ref) : 결과 보고
  - workflow_execute(workflow_id)          : 워크플로우 실행 트리거
  - workflow_get_trace(trace_id)           : 실행 상태 조회

실행: python mcp_server.py            (stdio — Claude Desktop용)
      python mcp_server.py --sse PORT (SSE — 원격 접속용)
"""
import sys
import json
import time
import psycopg2
import psycopg2.extras
from mcp.server.fastmcp import FastMCP

DB_DSN = "host=/opt/data/pgdata dbname=odds user=hermes"

mcp = FastMCP("workflow-builder")

def db():
    return psycopg2.connect(DB_DSN)

# ── 1. 펜딩 작업 조회 (pull) ──
@mcp.tool()
def workflow_list_pending_tasks(agent_id: str) -> str:
    """에이전트가 처리해야 할 명령/지시 조회. agent_id는 발급받은 자격증명 키를 사용.
    결과: [{id, type(command/instruction), from_agent, payload_ref, trace_id, task_status, ts}]"""
    try:
        conn = db(); cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT id, msg_type, from_agent, to_agent, payload_ref, trace_id, status, created_at
            FROM agent_messages
            WHERE to_agent = %s AND msg_type IN ('command','instruction')
            ORDER BY created_at ASC LIMIT 50
        """, (agent_id,))
        rows = cur.fetchall()
        conn.close()
        if not rows:
            return json.dumps({"success": True, "pending": []}, ensure_ascii=False)
        out = []
        for r in rows:
            out.append({
                "id": r["id"], "type": r["msg_type"], "from": r["from_agent"],
                "payload_ref": r["payload_ref"], "trace_id": r["trace_id"],
                "status": r["status"], "ts": str(r["created_at"])[:19]
            })
        return json.dumps({"success": True, "pending": out}, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)}, ensure_ascii=False)

# ── 2. 페이로드 로드 ──
@mcp.tool()
def workflow_get_payload(payload_ref: str) -> str:
    """payload_ref(예: result_6)로 실제 데이터 로드. payload-by-reference 패턴."""
    try:
        conn = db(); cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # wf_results에서 node_id로 조회
        cur.execute("SELECT id, wf_id, node_id, result, run_at FROM wf_results WHERE node_id = %s ORDER BY id DESC LIMIT 1", (payload_ref,))
        row = cur.fetchone()
        if not row:
            return json.dumps({"success": False, "error": "payload not found: " + payload_ref}, ensure_ascii=False)
        conn.close()
        return json.dumps({"success": True, "payload": row}, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)}, ensure_ascii=False)

# ── 3. 결과 보고 ──
@mcp.tool()
def workflow_report(trace_id: str, status: str, result_ref: str = "", summary: str = "") -> str:
    """작업 결과를 워크플로우 빌더에 보고. status: completed/failed. result_ref는 wf_results의 node_id."""
    try:
        conn = db(); cur = conn.cursor()
        # 메시지 상태 갱신 (trace_id로)
        cur.execute("""
            UPDATE agent_messages SET status = %s, read_at = now()
            WHERE trace_id = %s OR id::text = %s
        """, (status, trace_id, trace_id))
        # 결과 저장 (result_ref 있으면)
        if result_ref:
            cur.execute(
                "INSERT INTO wf_results (wf_id, node_id, result) VALUES (%s,%s,%s)",
                (trace_id[:8], result_ref, json.dumps({"summary": summary, "status": status}, ensure_ascii=False)[:2000])
            )
        conn.commit(); conn.close()
        return json.dumps({"success": True, "reported": {"trace_id": trace_id, "status": status}}, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)}, ensure_ascii=False)

# ── 4. 워크플로우 실행 트리거 ──
@mcp.tool()
def workflow_execute(workflow_id: str) -> str:
    """워크플로우를 실행 트리거. 서버의 POST /api/workflows/:id/execute 호출과 동일한 효과."""
    try:
        import urllib.request
        req = urllib.request.Request(
            "http://localhost:3737/api/workflows/" + workflow_id + "/execute",
            data=b"{}", headers={"Content-Type": "application/json"}, method="POST"
        )
        r = urllib.request.urlopen(req, timeout=60)
        return r.read().decode()
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)}, ensure_ascii=False)

# ── 5. 트레이스 조회 ──
@mcp.tool()
def workflow_get_trace(trace_id: str) -> str:
    """실행 트레이스(trace_id)로 각 스팬/상태 조회."""
    try:
        conn = db(); cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT node_id, agent_id, operation, duration_ms, result
            FROM agent_spans WHERE trace_id = %s ORDER BY duration_ms
        """, (trace_id,))
        rows = cur.fetchall()
        conn.close()
        return json.dumps({"success": True, "trace_id": trace_id, "spans": rows}, ensure_ascii=False, default=str)
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)}, ensure_ascii=False)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--sse":
        port = int(sys.argv[2]) if len(sys.argv) > 2 else 8787
        print(f"MCP SSE 서버 시작: http://0.0.0.0:{port}/sse", flush=True)
        mcp.run(transport="sse", host="0.0.0.0", port=port)
    else:
        print("MCP stdio 서버 시작 (Claude Desktop용)", flush=True)
        mcp.run(transport="stdio")
