#!/usr/bin/env python3
"""MLB 이번 시즌 결과 backfill — MLB Stats API(무료·키 불필요) → fb_games UPSERT.

지시서 #51 A. collect-mlb(#49) 수집기를 이번 시즌 전체 범위로 1회 실행하는 백필.
날짜 청크(30일)로 나눠 호출. 재실행 멱등(UPSERT).

사용: .agentenv/bin/python ops/collect-mlb-backfill.py [start] [end]
기본: start=2026-03-01, end=오늘(UTC)
"""
import json
import sys
import urllib.request
from datetime import date, timedelta

import psycopg2

API = "https://statsapi.mlb.com/api/v1/schedule"
DSN = {"host": "/opt/data/pgdata", "dbname": "odds", "user": "hermes"}
CHUNK_DAYS = 30


def fetch_schedule(start: str, end: str) -> dict:
    url = f"{API}?sportId=1&gameTypes=R&startDate={start}&endDate={end}"
    req = urllib.request.Request(url, headers={"User-Agent": "fb-backfill/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main() -> int:
    today = date.today()
    start = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else date(2026, 3, 1)
    end = date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else today

    conn = psycopg2.connect(**DSN)
    cur = conn.cursor()

    inserted = 0
    calls = 0
    cur_start = start
    while cur_start <= end:
        cur_end = min(cur_start + timedelta(days=CHUNK_DAYS - 1), end)
        data = fetch_schedule(cur_start.isoformat(), cur_end.isoformat())
        calls += 1
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
        print(f"chunk {cur_start}~{cur_end}: 호출완료", flush=True)
        cur_start = cur_end + timedelta(days=1)

    cur.close()
    conn.close()
    print(f"UPSERT 총 {inserted}건 / API 호출 {calls}회 → fb_games")
    return 0


if __name__ == "__main__":
    sys.exit(main())
