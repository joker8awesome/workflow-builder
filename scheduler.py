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

# /api/approvals 잠금(WF_APPROVALS_AUTH=1) 이후 필요한 키.
# ag_scheduler 자격증명(mcp:execute)을 쓴다. admin 은 필요 없다.
SCHEDULER_KEY = os.environ.get("WF_SCHEDULER_KEY", "")

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
    """승인 요청 생성 — server.js 가 텔레그램 전송까지 처리한다.

    WF_SCHEDULER_KEY 를 항상 함께 보낸다.
    /api/approvals 가 아직 열려 있어도 헤더는 무해하고, 잠근 뒤에는 이게 없으면
    401 로 막혀 '알림이 안 온다'는 조용한 고장이 된다. 키가 없으면 크게 경고한다.
    """
    import urllib.request
    payload = json.dumps({
        "wf_id": wf_id or "-", "agent_id": agent_id or "-",
        "action": action, "context": context or "", "decision": "pending",
    }).encode()
    headers = {"Content-Type": "application/json"}
    if SCHEDULER_KEY:
        headers["Authorization"] = "Bearer " + SCHEDULER_KEY
    req = urllib.request.Request(
        API_BASE + "/api/approvals", data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            out = json.loads(r.read().decode())
            if out.get("notified") is False:
                print(f"[승인] id={out.get('id')} 생성됨 — 그러나 알림 전송 실패(텔레그램 설정 확인)")
            else:
                print(f"[승인] id={out.get('id')} 요청 전송")
            return out.get("id")
    except Exception as e:
        code = getattr(e, 'code', None)
        if code == 401:
            print("[승인] 401 — WF_SCHEDULER_KEY 가 없거나 유효하지 않다. "
                  "승인 알림이 사용자에게 전달되지 않는다. 즉시 확인할 것")
        else:
            print(f"[승인] 요청 실패: {e}")
        return None

def wake_agent(agent_id, mid, trace, ref):
    """수신 에이전트를 깨운다 — server.js 가 게이트웨이 봇으로 메시지를 보낸다.

    텔레그램 로직을 여기 다시 구현하지 않는다. 알림용 봇과 깨우기용 봇이 다르고,
    그 구분은 notify.js 한 곳에만 둔다.
    """
    import urllib.request
    payload = json.dumps({
        "message_id": mid, "trace_id": trace or "", "payload_ref": ref or "",
        "reason": "큐에 새 지시가 적재됨",
    }).encode()
    headers = {"Content-Type": "application/json"}
    if SCHEDULER_KEY:
        headers["Authorization"] = "Bearer " + SCHEDULER_KEY
    req = urllib.request.Request(
        f"{API_BASE}/api/agents/{agent_id}/wake", data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            out = json.loads(r.read().decode())
            if out.get("woken"):
                print(f"[깨움] {agent_id} — msg {mid}")
            else:
                print(f"[깨움] {agent_id} 실패({out.get('reason')}) — "
                      "지시가 큐에 쌓이기만 한다. WF_GATEWAY_TOKEN/CHAT_ID 확인할 것")
    except Exception as e:
        code = getattr(e, 'code', None)
        if code == 401:
            print("[깨움] 401 — WF_SCHEDULER_KEY 확인 필요")
        else:
            print(f"[깨움] 요청 실패: {e}")

def poll_agent_messages(seen, since):
    """미처리 명령을 감지해 사용자에게 알린다.

    할매봇이 직접 처리하더라도, 사용자가 '무슨 일이 시작됐는지' 모르는 상태를
    만들지 않기 위해 여기서 한 번 알린다.

    두 가지를 거른다 — 둘 다 실제로 사고를 냈다:

    1) `since` 이전 메시지는 무시한다.
       seen 집합이 메모리에만 있어서, 재시작할 때마다 밀려 있던 pending 전부를
       다시 알렸다. 실제로 재시작 한 번에 알림 7개가 나갔다.

    2) agents 테이블에 없는 수신자 앞 메시지는 무시한다.
       정리된 테스트 에이전트(ag_rt4, ag_dbg 등) 앞 메시지가 pending 으로
       영원히 남아 매번 알림 대상이 됐다. 아무도 claim 할 수 없는 메시지다.
    """
    try:
        conn = db(); cur = conn.cursor()
        cur.execute(
            """SELECT m.id, m.from_agent, m.to_agent, m.msg_type, m.trace_id,
                      m.payload_ref, m.created_at
               FROM agent_messages m
               JOIN agents a ON a.id = m.to_agent
               WHERE m.status = 'pending'
                 AND m.msg_type IN ('command','instruction')
                 AND m.created_at > %s
               ORDER BY m.created_at ASC LIMIT 20""",
            (since,))
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
        # 감지·알림만으로는 아무 일도 일어나지 않는다.
        # 수신자는 list_pending 폴링 루프가 없고 텔레그램 메시지로 깨어나므로,
        # 여기서 깨워야 실제로 지시를 집어간다. 이게 없으면 사람이 알려줘야 한다.
        wake_agent(to, mid, trace, ref)

def main():
    print("워크플로우 스케줄러 시작 (30초 간격)")
    print(f"  DB   : {DB_DSN.split('dbname=')[-1].split()[0] if 'dbname=' in DB_DSN else '(DATABASE_URL)'}")
    print(f"  API  : {API_BASE}")
    print(f"  승인 키: {'설정됨' if SCHEDULER_KEY else '없음 — /api/approvals 가 잠기면 알림이 끊긴다'}")
    last_minute = None
    seen_msgs = set()
    # 기동 시각 이후에 생긴 메시지만 알린다.
    # 이전에는 재시작할 때마다 밀려 있던 pending 을 전부 다시 알렸다.
    started_at = datetime.now()
    print(f"  큐 감시 기준 시각: {started_at:%Y-%m-%d %H:%M:%S} (이전 메시지는 무시)")
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
            poll_agent_messages(seen_msgs, started_at)
            if len(seen_msgs) > 5000:
                seen_msgs.clear()   # 무한 증가 방지
        except Exception as e:
            print(f"루프 오류: {e}")
        time.sleep(CHECK_INTERVAL)

if __name__ == '__main__':
    main()
