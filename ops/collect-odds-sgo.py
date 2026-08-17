#!/usr/bin/env python3
"""SGO(SportsGameOdds) MLB moneyline 배당 스냅샷 수집기 → fb_odds_snapshots.

지시서 #50 B2. 매 실행 = 새 스냅샷(append, upsert 아님). collected_at=now().
키는 env WF_SGO_API_KEY 에서만 읽고, 없으면 SPORTS_ODDS_API_KEY 폴백(변수명 불일치 대응).
무료 플랜은 일부 bookmaker(8개)만 제공 — byBookmaker 에 있는 것만 저장.
"""
import os
import sys
import json
import urllib.request

import psycopg2

API = "https://api.sportsgameodds.com/v2/events"
DSN = {"host": "/opt/data/pgdata", "dbname": "odds", "user": "hermes"}


def get_key():
    for name in ("WF_SGO_API_KEY", "SPORTS_ODDS_API_KEY"):
        v = os.environ.get(name)
        if v:
            return v
    try:
        for line in open("/opt/data/.env"):
            if line.startswith("SPORTS_ODDS_API_KEY="):
                return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return None


def fetch_events(key: str) -> dict:
    url = f"{API}?leagueID=MLB&oddsAvailable=true"
    req = urllib.request.Request(url, headers={"x-api-key": key, "User-Agent": "fb-collector/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main() -> int:
    key = get_key()
    if not key:
        print("❌ SGO 키 없음 (WF_SGO_API_KEY / SPORTS_ODDS_API_KEY)", file=sys.stderr)
        return 2

    data = fetch_events(key)
    events = data.get("data", [])

    conn = psycopg2.connect(**DSN)
    cur = conn.cursor()
    inserted = 0
    for ev in events:
        sgo_event_id = ev.get("eventID")
        home = ev["teams"]["home"]["names"].get("long", "")
        away = ev["teams"]["away"]["names"].get("long", "")
        starts = ev["status"].get("startsAt", "")
        game_date = starts[:10] if starts else None
        odds = ev.get("odds", {})
        for side, mlkey in (("home", "points-home-game-ml-home"),
                            ("away", "points-away-game-ml-away")):
            ml = odds.get(mlkey)
            if not ml:
                continue
            for book, info in ml.get("byBookmaker", {}).items():
                price = info.get("odds")
                if price is None:
                    continue
                try:
                    price = float(price)
                except (TypeError, ValueError):
                    continue
                cur.execute(
                    """
                    INSERT INTO fb_odds_snapshots
                      (sgo_event_id, game_date, home_team, away_team,
                       bookmaker, market, side, price, collected_at)
                    VALUES (%s,%s,%s,%s,%s,'moneyline',%s,%s, now())
                    """,
                    (sgo_event_id, game_date, home, away, book, side, price),
                )
                inserted += 1
    conn.commit()
    cur.close()
    conn.close()
    print(f"스냅샷 {inserted}행 → fb_odds_snapshots")
    return 0


if __name__ == "__main__":
    sys.exit(main())
