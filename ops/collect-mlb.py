#!/usr/bin/env python3
"""MLB 일정·결과 수집기 — MLB Stats API(무료·키 불필요) → fb_games UPSERT.

지시서 #49 B1. 야구 픽 프로젝트의 games/odds_snapshots 는 건드리지 않고
우리 fb_games 테이블에만 쓴다. 재실행 멱등(UPSERT — 중복 행 0).

사용: .agentenv/bin/python ops/collect-mlb.py
"""
import json
import sys
import urllib.request
from datetime import date, timedelta

import psycopg2

API = "https://statsapi.mlb.com/api/v1/schedule"
DSN = {"host": "/opt/data/pgdata", "dbname": "odds", "user": "hermes"}


def fetch_schedule(start: str, end: str) -> dict:
    url = f"{API}?sportId=1&startDate={start}&endDate={end}"
    req = urllib.request.Request(url, headers={"User-Agent": "fb-collector/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main() -> int:
    today = date.today()
    start = (today - timedelta(days=1)).isoformat()
    end = (today + timedelta(days=7)).isoformat()
    data = fetch_schedule(start, end)

    conn = psycopg2.connect(**DSN)
    cur = conn.cursor()
    inserted = 0
    for d in data.get("dates", []):
        for g in d.get("games", []):
            game_pk = g["gamePk"]
            game_date = g.get("officialDate") or g.get("gameDate", "")[:10]
            start_time = g.get("gameDate")
            home = g["teams"]["home"]["team"]["name"]
            away = g["teams"]["away"]["team"]["name"]
            status = g["status"]["detailedState"]
            home_score = away_score = None
            if status == "Final":
                home_score = g["teams"]["home"].get("score")
                away_score = g["teams"]["away"].get("score")
            cur.execute(
                """
                INSERT INTO fb_games
                  (game_pk, game_date, start_time, home_team, away_team,
                   home_score, away_score, status, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s, now())
                ON CONFLICT (game_pk) DO UPDATE SET
                  home_score = EXCLUDED.home_score,
                  away_score = EXCLUDED.away_score,
                  status = EXCLUDED.status,
                  updated_at = now()
                """,
                (game_pk, game_date, start_time, home, away,
                 home_score, away_score, status),
            )
            inserted += 1
    conn.commit()
    cur.close()
    conn.close()
    print(f"UPSERT {inserted}건 → fb_games")
    return 0


if __name__ == "__main__":
    sys.exit(main())
