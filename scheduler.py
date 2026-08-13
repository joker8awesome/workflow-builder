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

DB_DSN = "host=/opt/data/pgdata dbname=odds user=hermes"
VENV_PY = "/opt/data/projects/workflow-builder/.agentenv/bin/python"
ORCH = "/opt/data/projects/workflow-builder/agent_orchestrator.py"
CHECK_INTERVAL = 30  # 초

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

def main():
    print("워크플로우 스케줄러 시작 (30초 간격)")
    last_minute = None
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
        except Exception as e:
            print(f"루프 오류: {e}")
        time.sleep(CHECK_INTERVAL)

if __name__ == '__main__':
    main()
