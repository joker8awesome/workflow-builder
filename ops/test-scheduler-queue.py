#!/usr/bin/env python3
"""scheduler.py 의 큐 감시 필터 검증 — DB 없이 정적 + 스텁으로 확인.

왜 필요한가: poll_agent_messages 가 두 가지를 안 걸러서 실제로 사고를 냈다.
  1) 기동 이전 메시지까지 알렸다. seen 집합이 메모리에만 있어서,
     재시작할 때마다 밀려 있던 pending 전부를 다시 알렸다 — 알림 7개가 한 번에 나갔다.
  2) 정리된 테스트 에이전트(ag_rt4, ag_dbg 등) 앞 메시지가 pending 으로 영원히 남아
     매번 알림 대상이 됐다. 아무도 claim 할 수 없는 메시지다.

이 두 가드가 사라지면 사용자 휴대폰으로 알림이 다시 쏟아진다.

실행: python ops/test-scheduler-queue.py
"""
import os, re, sys, types, datetime

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = open(os.path.join(ROOT, 'scheduler.py'), encoding='utf-8').read()

fails = []
def check(name, cond, detail=''):
    print(('  PASS  ' if cond else '  FAIL  ') + name + (('\n         ' + detail) if not cond and detail else ''))
    if not cond:
        fails.append(name)

print('1) 기동 시각 이전 메시지를 거르는가')
check('poll_agent_messages 가 since 를 받는다',
      re.search(r'def poll_agent_messages\(\s*seen\s*,\s*since\s*\)', SRC) is not None,
      '인자가 빠지면 시간 필터가 사라진다')
check('SQL 에 created_at 비교가 있다',
      re.search(r'created_at\s*>\s*%s', SRC) is not None,
      '이게 없으면 재시작 때마다 밀린 pending 을 전부 다시 알린다')
check('main 이 기동 시각을 만들어 넘긴다',
      'started_at = datetime.now()' in SRC and 'poll_agent_messages(seen_msgs, started_at)' in SRC)

print('\n2) 존재하지 않는 수신자 앞 메시지를 거르는가')
check('agents 조인이 있다',
      re.search(r'JOIN\s+agents\s+a\s+ON\s+a\.id\s*=\s*m\.to_agent', SRC, re.I) is not None,
      '조인이 없으면 정리된 테스트 에이전트 앞 메시지가 계속 알림을 만든다')

print('\n3) 알림 경로가 파이썬에 중복 구현되지 않았는가')
check('텔레그램 API 를 직접 부르지 않는다',
      'api.telegram.org' not in SRC,
      '전송 로직은 notify.js 한 곳에만 둔다 — 두 언어로 갈라지면 반드시 어긋난다')
check('/api/approvals 를 통해 알린다', '/api/approvals' in SRC)

print('\n4) 스텁 실행 — 필터가 실제로 동작하는가')
sent = []
class _Cur:
    def __init__(self): self.rows = []
    def execute(self, sql, params=None):
        # 조인·시간조건이 모두 걸린 쿼리에만 행을 돌려준다 (DB 대신 판정)
        if 'agent_messages' in sql and 'JOIN' in sql.upper():
            ok_time = 'created_at > %s' in sql
            ok_join = re.search(r'JOIN\s+agents', sql, re.I) is not None
            self.rows = [(200, 'ag_a', 'ag_b', 'command', 't1', 'r1', None)] if (ok_time and ok_join) else []
        else:
            self.rows = []
    def fetchall(self): return self.rows
    def fetchone(self): return (1,)
class _Conn:
    def cursor(self): return _Cur()
    def commit(self): pass
    def close(self): pass
stub = types.ModuleType('psycopg2'); stub.connect = lambda *a, **k: _Conn()
sys.modules['psycopg2'] = stub
sys.path.insert(0, ROOT)
import scheduler
scheduler.request_approval = lambda **kw: sent.append(kw) or 1

seen = set()
scheduler.poll_agent_messages(seen, datetime.datetime.now())
check('가드가 걸린 쿼리로 조회하면 알림이 나간다', len(sent) == 1, str(sent))
scheduler.poll_agent_messages(seen, datetime.datetime.now())
check('같은 메시지를 두 번 알리지 않는다 (seen)', len(sent) == 1, str(len(sent)))

print('\n5) 감지한 뒤 수신자를 깨우는가')
# 감지·알림만으로는 아무 일도 일어나지 않는다. 할매봇은 list_pending 폴링 루프가
# 없고 텔레그램 메시지로 세션이 시작되므로, 깨우지 않으면 큐에 쌓이기만 한다.
# 실제로 지시 3건이 그 상태로 남아 사람이 알려줘야 진행됐다.
check('wake_agent 함수가 있다', 'def wake_agent(' in SRC)
check('감지 직후 호출한다',
      re.search(r'request_approval\([^)]*\)\s*\n(?:\s*#[^\n]*\n)*\s*wake_agent\(', SRC) is not None,
      '알림만 하고 깨우지 않으면 자동화가 절반에서 멈춘다')
check('텔레그램을 파이썬에 재구현하지 않는다',
      '/wake' in SRC and 'api.telegram.org' not in SRC,
      '알림용 봇과 깨우기용 봇의 구분은 notify.js 한 곳에만 둔다')
check('깨우기 실패가 루프를 멈추지 않는다',
      re.search(r'def wake_agent\(.*?except Exception', SRC, re.S) is not None)

print('\n' + (f'실패 {len(fails)}건: ' + ', '.join(fails) if fails else '전부 통과'))
sys.exit(1 if fails else 0)
