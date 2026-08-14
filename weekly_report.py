#!/usr/bin/env python3
"""
주간 실행 리포트 — 최근 7일 워크플로우 실행 통계를 텍스트로 출력
사용: python weekly_report.py  (cron과 연동 가능)
"""
import json
import urllib.request
import sys
from datetime import datetime, timedelta

API = "http://localhost:3737"

def main():
    try:
        r = json.loads(urllib.request.urlopen(API + "/api/report", timeout=15).read())
        rep = r.get("report", {})
        recent = rep.get("recent", [])
        # 최근 7일 필터
        week_ago = datetime.utcnow() - timedelta(days=7)
        week_runs = [x for x in recent if x.get("run_at", "")[:10] >= week_ago.strftime("%Y-%m-%d")]
        lines = [
            "📊 워크플로우 주간 리포트",
            "━━━━━━━━━━━━━━━━━━",
            f"총 실행: {rep.get('total', 0)}회 · 성공률: {rep.get('rate', 0)}%",
            f"최근 7일 실행: {len(week_runs)}회",
            "",
            "최근 실행:",
        ]
        for x in recent[:8]:
            lines.append(f"  • {x.get('wf_id','')}: {x.get('run_path','')} [{x.get('status','')}] {x.get('run_at','')[:16]}")
        print("\n".join(lines))
    except Exception as e:
        print(f"리포트 오류: {e}")

if __name__ == "__main__":
    main()
