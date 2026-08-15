#!/usr/bin/env python3
"""
워크플로우 크론 스케줄러
- wf_workflows.schedule(cron) 컬럼을 읽어 주기 실행
- 실행: python scheduler.py (백그라운드)
"""
import json
import os
import subprocess
import time
import re
from datetime import datetime

import psycopg2

# server.js / mcp-router.js / agent_orchestrator.py 와 동일 규칙
DB_DSN = os.environ.get("DATABASE_URL") or (
    "host=%s dbname=%s user=%s" % (
        os.environ.get("PGHOST", "/opt/data/pgdata"),
        os.environ.get("PGDATABASE", "odds"),
        os.environ.get("PGUSER", "hermes"),
    )
)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VENV_PY = os.environ.get("WF_VENV_PY", os.path.join(BASE_DIR, ".agentenv/bin/python"))
ORCH = os.path.join(BASE_DIR, "agent_orchestrator.py")
CHECK_INTERVAL = 30  # 초

# 알림은 server.js 의 /api/approvals 를 거친다.
# 텔레그램 전송 로직을 파이썬에 다시 구현하지 않는다 — 두 언어에 같은 로직이
# 갈라지면 반드시 어긋난다 (notify.js 주석 참조).
API_BASE = os.environ.get("WF_API_BASE", "http://127.0.0.1:%s" % os.environ.get("PORT", "3737"))

def db():
    return psycopg2.connect(DB_DSN)

def parse_cron(expr):
    """간단 cron 파서 — 분/시/일/월/요일 (5필드)"""
    if not expr: return None
    parts = expr.split()
    if len(parts) != 5: return None
    def field_match(f, v):
        if f == '*': return True
        if '/' in f:  # */N
            base, step = f.split('/')
            return int(v) % int(step) == 0
        if '-' in f:
            a, b = map(int, f.split('-'))
            return a <= int(v) <= b
        if ',' in f:
            return int(v) in [int(x) for x in f.split(',')]
        return int(f) == int(v)
    return lambda now: field_match(parts[0], now.minute) and field_match(parts[1], now.hour) \
        and field_match(parts[2], now.day) and field_match(parts[3], now.month) \
        and field_match(parts[4], now.weekday())

def run_workflow(wf_id):
    try:
        subprocess.run([VENV_PY, ORCH, '--workflow', wf_id, '--run'],
                       capture_output=True, text=True, timeout=60)
        conn = db(); cur = conn.cursor()
        cur.execute("INSERT INTO audit_logs (actor, resource, action, detail) VALUES (%s,%s,%s,%s)",
                    ('cron', wf_id, 'run', 'scheduled trigger'))
        conn.commit(); conn.close()
        print(f"[{datetime.now():%H:%M:%S}] 실행: {wf_id}")
    except Exception as e:
        print(f"[{datetime.now():%H:%M:%S}] 오류 {wf_id}: {e}")

def request_approval(wf_id, agent_id, action, context):
    """승인 요청 생성 — server.js 가 텔레그램 전송까지 처리한다."""
    import urllib.request
    payload = json.dumps({
        "wf_id": wf_id or "-", "agent_id": agent_id or "-",
        "action": action, "context": context or "", "decision": "pending",
    }).encode()
    req = urllib.request.Request(
        API_BASE + "/api/approvals", data=payload,
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            out = json.loads(r.read().decode())
            if out.get("notified") is False:
                print(f"[승인] id={out.get('id')} 생성됨 — 그러나 알림 전송 실패(텔레그램 설정 확인)")
            else:
                print(f"[승인] id={out.get('id')} 요청 전송")
            return out.get("id")
    except Exception as e:
        print(f"[승인] 요청 실패: {e}")
        return None

def poll_agent_messages(seen):
    """ag_hermes 앞으로 온 미처리 명령을 감지해 사용자에게 알린다.

    할매봇이 직접 처리하더라도, 사용자가 '무슨 일이 시작됐는지' 모르는 상태를
    만들지 않기 위해 여기서 한 번 알린다.
    """
    try:
        conn = db(); cur = conn.cursor()
        cur.execute(
            """SELECT id, from_agent, to_agent, msg_type, trace_id, payload_ref, created_at
               FROM agent_messages
               WHERE status = 'pending' AND msg_type IN ('command','instruction')
               ORDER BY created_at ASC LIMIT 20""")
        rows = cur.fetchall(); conn.close()
    except Exception as e:
        print(f"[큐] 조회 실패: {e}")
        return
    for mid, frm, to, mtype, trace, ref, created in rows:
        if mid in seen:
            continue
        seen.add(mid)
        print(f"[큐] 미처리 {mtype}: {frm} → {to} (msg {mid}, trace {trace})")
        request_approval(
            wf_id=trace or "-", agent_id=to, action="workflow.execute",
            context=f"{frm} → {to} / {mtype} / payload_ref={ref or '-'} / msg_id={mid}")

def main():
    print("워크플로우 스케줄러 시작 (30초 간격)")
    print(f"  DB   : {DB_DSN.split('dbname=')[-1].split()[0] if 'dbname=' in DB_DSN else '(DATABASE_URL)'}")
    print(f"  API  : {API_BASE}")
    last_minute = None
    seen_msgs = set()
    while True:
        try:
            conn = db(); cur = conn.cursor()
            cur.execute("SELECT id, schedule FROM wf_workflows WHERE schedule != ''")
            rows = cur.fetchall(); conn.close()
            now = datetime.now()
            for wf_id, schedule in rows:
                match = parse_cron(schedule)
                if match and match(now) and now.minute != last_minute:
                    run_workflow(wf_id)
            last_minute = now.minute
            # 에이전트 큐 감시 — 새 지시가 들어오면 사용자에게 알린다
            poll_agent_messages(seen_msgs)
            if len(seen_msgs) > 5000:
                seen_msgs.clear()   # 무한 증가 방지
        except Exception as e:
            print(f"루프 오류: {e}")
        time.sleep(CHECK_INTERVAL)

if __name__ == '__main__':
    main()
