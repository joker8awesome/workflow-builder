#!/usr/bin/env python
# 센터장(ag_claude_desktop)에게 작업 상황 전달 헬퍼
# 사용법: ./.agentenv/bin/python send_to_center.py "요약" [trace_id]
import sys, json, psycopg2, datetime

summary = sys.argv[1] if len(sys.argv) > 1 else '작업 완료'
trace = sys.argv[2] if len(sys.argv) > 2 else 'trace_' + datetime.datetime.now().strftime('%H%M%S')
conn = psycopg2.connect(host='/opt/data/pgdata', dbname='odds', user='hermes')
cur = conn.cursor()
cur.execute(
    """INSERT INTO agent_messages (msg_type, from_agent, to_agent, payload, status, trace_id)
       VALUES ('report', 'ag_hermes', 'ag_claude_desktop', %s, 'pending', %s) RETURNING id""",
    (json.dumps({'summary': summary, 'log': 'deepbot_action.md 갱신됨', 'ts': datetime.datetime.now().isoformat()}), trace)
)
mid = cur.fetchone()[0]
conn.commit(); conn.close()
print(f'✅ 센터장에게 전달: msg {mid} ({trace})')
