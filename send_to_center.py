#!/usr/bin/env python
"""센터장(ag_claude_desktop)에게 작업 상황을 전달한다.

사용법:
    ./.agentenv/bin/python send_to_center.py "요약" [trace_id]
    ./.agentenv/bin/python send_to_center.py --help

주의: 예전에는 인자를 그대로 받아 **무조건 발송**했다. 그래서
`--help` 를 치면 도움말 대신 "--help" 라는 보고가 센터장에게 갔고,
인자 없이 실행하면 "작업 완료" 라는 빈 보고가 나갔다.
실제로 msg_234·msg_249 두 건이 그렇게 발송돼 센터장이 헛읽었다.
그래서 요약을 필수로 받고, 플래그처럼 생긴 값은 거부한다.
"""
import sys, json, datetime

USAGE = __doc__


def die(msg, code=2):
    print(msg, file=sys.stderr)
    print(USAGE, file=sys.stderr)
    sys.exit(code)


args = sys.argv[1:]

if not args or args[0] in ('-h', '--help', 'help'):
    # 발송하지 않는다. 도움말만 보여준다.
    print(USAGE)
    sys.exit(0 if args else 1)

summary = args[0].strip()

# 플래그를 요약으로 오인해 보내지 않는다
if summary.startswith('-'):
    die(f'요약이 플래그처럼 보인다: {summary!r}')

# 빈 보고는 받는 쪽 시간만 쓴다
if len(summary) < 5:
    die(f'요약이 너무 짧다 ({len(summary)}자). 무슨 일을 했는지 적어라.')

trace = args[1] if len(args) > 1 else 'trace_' + datetime.datetime.now().strftime('%H%M%S')

import psycopg2

conn = psycopg2.connect(host='/opt/data/pgdata', dbname='odds', user='hermes')
cur = conn.cursor()
cur.execute(
    """INSERT INTO agent_messages (msg_type, from_agent, to_agent, payload, status, trace_id)
       VALUES ('report', 'ag_hermes', 'ag_claude_desktop', %s, 'pending', %s) RETURNING id""",
    (json.dumps({'summary': summary, 'log': 'deepbot_action.md 갱신됨',
                 'ts': datetime.datetime.now().isoformat()}), trace)
)
mid = cur.fetchone()[0]
conn.commit()
conn.close()
print(f'✅ 센터장에게 전달: msg {mid} ({trace})')
