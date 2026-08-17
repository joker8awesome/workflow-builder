#!/usr/bin/env python3
"""agent_sessions.status 전이 검증 — DB 없이 스텁으로 확인.

확인 항목:
  1. 노드 실행 시 running 으로 전환되는가
  2. 정상 종료 시 done, 실패 시 failed 로 빠지는가
  3. execute_node 예외 시에도 running 에 고착되지 않는가
  4. 실행 종료(정상/예외) 시 잔여 활성 세션이 정리되는가
  5. online 판정 필터(ACTIVE_STATUSES)와 실제 기록값이 일치하는가

실행: python ops/test-session-status.py
"""
import sys, os, types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# ---- psycopg2 스텁 (로컬에 미설치) ----
SQL_LOG = []

class _Cur:
    rowcount = 0
    def execute(self, sql, params=None):
        SQL_LOG.append((' '.join(sql.split()), params))
        _Cur.rowcount = 1 if 'UPDATE agent_sessions' in sql else 0
    def fetchone(self): return (1,)
    def fetchall(self): return []
class _Conn:
    def cursor(self): return _Cur()
    def commit(self): pass
    def close(self): pass

stub = types.ModuleType('psycopg2')
stub.connect = lambda *a, **k: _Conn()
sys.modules['psycopg2'] = stub

import agent_orchestrator as orch

def status_updates():
    """SQL 로그에서 agent_sessions 상태 갱신만 뽑아낸다."""
    out = []
    for sql, params in SQL_LOG:
        if 'UPDATE agent_sessions SET status=%s' in sql:
            out.append(('set', params[0], params[1]))
        elif "SET status='idle'" in sql and 'ANY' in sql:
            # params = (wf_id, [활성 상태들]) — 대상 상태 목록은 params[1]
            out.append(('sweep', params[0], params[1]))
    return out

fails = []
def check(name, cond, detail=''):
    print(('  PASS  ' if cond else '  FAIL  ') + name + (('  -> ' + detail) if detail and not cond else ''))
    if not cond: fails.append(name)

print('1) ACTIVE_STATUSES 와 JS 필터 일치')
js = open(os.path.join(os.path.dirname(__file__), '..', 'mcp-router.js'), encoding='utf-8').read()
srv = open(os.path.join(os.path.dirname(__file__), '..', 'server.js'), encoding='utf-8').read()
lit = "'" + "','".join(orch.ACTIVE_STATUSES) + "'"
check('mcp-router.js 필터 일치', lit in js, lit)
check('server.js 필터 일치', lit in srv, lit)

print('\n2) set_session_status 기록')
SQL_LOG.clear()
orch.set_session_status('sess_x', 'running')
u = status_updates()
check('running 기록됨', u == [('set', 'running', 'sess_x')], str(u))

print('\n3) 빈/더미 세션 id 는 기록하지 않음')
SQL_LOG.clear()
orch.set_session_status('', 'running'); orch.set_session_status('-', 'running')
check('무시됨', status_updates() == [], str(status_updates()))

print('\n4) reset_stale_sessions 는 활성 상태만 대상으로 함')
SQL_LOG.clear()
orch.reset_stale_sessions('wf_test')
sw = [x for x in status_updates() if x[0] == 'sweep']
check('활성 목록으로 sweep', sw and sw[0][2] == list(orch.ACTIVE_STATUSES), str(sw))

print('\n5) 기록되는 상태값이 전부 어휘 안에 있는가 (소스 정적 검사)')
src = open(os.path.join(os.path.dirname(__file__), '..', 'agent_orchestrator.py'), encoding='utf-8').read()
import re
written = set(re.findall(r"set_session_status\([^,]+,\s*[\"'](\w+)[\"']\)", src))
written |= set(re.findall(r"set_session_status\([^,]+,\s*_final\)", src) and ['done', 'failed'] or [])
known = set(orch.ACTIVE_STATUSES) | {'done', 'failed', 'idle'}
check('미정의 상태값 없음', written <= known, f'기록={sorted(written)} 허용={sorted(known)}')
check('running 이 실제로 기록됨', 'running' in written, str(sorted(written)))

print('\n6) 예외 경로에서도 활성 상태가 남지 않는가 (구조 검사)')
# 정의부(def execute_node)가 아니라 호출부 직전 줄이 try: 인지 확인한다
lines = src.splitlines()
call_i = next((i for i, l in enumerate(lines) if 'result, next_id = execute_node(' in l), None)
prev = lines[call_i - 1].strip() if call_i else ''
check('execute_node 호출부를 try 로 감쌈', prev == 'try:', f'직전 줄={prev!r}')
check('예외 시 failed 로 전환', "set_session_status(sess_id, \"failed\")" in src, '')
check('run_workflow 에 finally sweep 존재',
      re.search(r'finally:\s*\n\s*#[^\n]*\n\s*#[^\n]*\n\s*reset_stale_sessions', src) is not None, '')

print('\n7) 세션 정리(cleanup) 삭제 경로가 활성 상태를 제외하는가')
m = re.search(r"DELETE FROM agent_sessions[\s\S]*?status IN \(([^)]*)\)", srv)
check('cleanup DELETE 가 done/failed 만 대상 (활성 제외)',
      m is not None and "'done','failed'" in m.group(1)
      and not any(a in m.group(1) for a in orch.ACTIVE_STATUSES),
      '대상 상태=' + (m.group(1) if m else '(DELETE 문 없음)'))

print('\n' + ('전부 통과' if not fails else f'실패 {len(fails)}건: {fails}'))
sys.exit(1 if fails else 0)
