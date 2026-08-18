#!/usr/bin/env python3
"""무료 과거배당 데이터셋(ArnavSaraogi/mlb-odds-scraper) → fb_odds_hist 로드 + fb_games 조인.

지시서 #54. JSON(76MB) → fb_odds_hist에 정규시즌(gameType='R') 경기당 1행 로드.
moneyline = 여러 북메이커 currentLine 의 decimal 평균(단일 마감값).
조인: (game_date + 정규화 홈 + 정규화 원정) 매칭. 더블헤더/연기경기는
      startDate ↔ fb_games.start_time 으로 추가 구분(최근접 시간 매칭).

사용: ./.agentenv/bin/python ops/load-odds-hist.py <json_path>
"""
import json
import sys
from collections import defaultdict
from datetime import date, datetime, timezone

import psycopg2

DSN = {"host": "/opt/data/pgdata", "dbname": "odds", "user": "hermes"}


def am_to_decimal(am):
    """미국식 moneyline → decimal 배당. 0/None 은 라인 없음으로 None 반환."""
    if am is None:
        return None
    am = float(am)
    if am == 0:
        return None
    return round(1 + am / 100.0, 4) if am > 0 else round(1 + 100.0 / abs(am), 4)


def aggregate_moneyline(moneylines):
    """여러 북메이커 currentLine 의 decimal 평균. (home, away) 반환. 없으면 (None, None)."""
    home, away = [], []
    for m in moneylines or []:
        cl = m.get("currentLine") or {}
        h = am_to_decimal(cl.get("homeOdds"))
        a = am_to_decimal(cl.get("awayOdds"))
        if h is not None:
            home.append(h)
        if a is not None:
            away.append(a)
    if not home or not away:
        return None, None
    return round(sum(home) / len(home), 3), round(sum(away) / len(away), 3)


def normalize_team(fullname, game_date):
    """데이터셋 팀명 → fb_games 팀명 정규화.

    실측 차이 (지시서 #54 §4):
      - 'Athletics Athletics'(데이터셋 2025 버그) → fb_games 'Athletics'(2025+) / 'Oakland Athletics'(~2024)
      - 'Cleveland Guardians'(데이터셋 전 연도) → fb_games 'Cleveland Indians'(2021만)
    """
    if fullname == "Athletics Athletics":
        return "Athletics" if game_date.year >= 2025 else "Oakland Athletics"
    if fullname == "Cleveland Guardians" and game_date.year == 2021:
        return "Cleveland Indians"
    return fullname


def parse_ts(s):
    """ISO 시각 → timezone-aware datetime. 실패 시 None."""
    if not s:
        return None
    try:
        t = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return t if t.tzinfo else t.replace(tzinfo=timezone.utc)
    except (ValueError, AttributeError):
        return None


def build_fb_index(conn):
    """fb_games (game_date, home, away) → list[(game_pk, start_time)]. 스코어 있는 행만."""
    cur = conn.cursor()
    cur.execute(
        """SELECT game_pk, game_date, home_team, away_team, start_time
           FROM fb_games"""
    )
    idx = defaultdict(list)
    for pk, gd, h, a, st in cur.fetchall():
        idx[(str(gd), h, a)].append((pk, st))
    cur.close()
    return idx


def pick_game_pk(candidates, ds_start):
    """후보 중 start_time 이 데이터셋 startDate 와 가장 가까운 game_pk."""
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0][0]
    st = parse_ts(ds_start)
    if st is None:
        return candidates[0][0]  # 시간 정보 없으면 첫 후보(임의)
    best, best_diff = candidates[0][0], None
    for pk, ts in candidates:
        t = parse_ts(str(ts)) if ts else None
        if t is None:
            continue
        diff = abs((t - st).total_seconds())
        if best_diff is None or diff < best_diff:
            best, best_diff = pk, diff
    return best


def main():
    if len(sys.argv) < 2:
        print("usage: load-odds-hist.py <json_path>")
        return 2
    json_path = sys.argv[1]

    with open(json_path) as f:
        data = json.load(f)

    conn = psycopg2.connect(**DSN)
    fb_idx = build_fb_index(conn)
    cur = conn.cursor()

    total = 0
    matched = 0
    unmatched = 0
    no_ml = 0
    skipped = defaultdict(int)
    unmatched_rows = []

    for dt, games in data.items():
        gd = date.fromisoformat(dt)
        for g in games:
            gv = g.get("gameView") or {}
            gt = gv.get("gameType", "Unknown")
            if gt != "R":
                skipped[gt] += 1
                continue
            home = normalize_team((gv.get("homeTeam") or {}).get("fullName"), gd)
            away = normalize_team((gv.get("awayTeam") or {}).get("fullName"), gd)
            ml_home, ml_away = aggregate_moneyline((g.get("odds") or {}).get("moneyline"))
            if ml_home is None:
                no_ml += 1

            # 조인: (date+home+away) → start_time 으로 더블헤더 구분
            key = (dt, home, away)
            cands = fb_idx.get(key, [])
            # 연기경기(officialDate≠실제일) 보정: startDate 날짜로 재시도
            if not cands:
                sd = parse_ts(gv.get("startDate"))
                if sd is not None:
                    cands = fb_idx.get((sd.date().isoformat(), home, away), [])
            game_pk = pick_game_pk(cands, gv.get("startDate"))

            cur.execute(
                """
                INSERT INTO fb_odds_hist
                  (game_pk, game_date, home_team, away_team, ml_home, ml_away, source)
                VALUES (%s,%s,%s,%s,%s,%s,'sbr-github')
                """,
                (game_pk, gd, home, away, ml_home, ml_away),
            )
            total += 1
            if game_pk is not None:
                matched += 1
            else:
                unmatched += 1
                if len(unmatched_rows) < 40:
                    unmatched_rows.append((dt, home, away))
        conn.commit()

    cur.close()
    rate = round(100.0 * matched / total, 2) if total else 0.0

    # 실험셋 = 배당+결과 겹침
    cur = conn.cursor()
    cur.execute(
        """SELECT count(*) FROM fb_odds_hist o
           JOIN fb_games g ON g.game_pk = o.game_pk WHERE g.home_score IS NOT NULL"""
    )
    overlap = cur.fetchone()[0]
    cur.close()
    conn.close()

    print(f"[load] fb_odds_hist {total}행 / 배당없음 {no_ml} / 제외 gameType={dict(skipped)}")
    print(f"[join] 매칭 {matched} / 미매칭 {unmatched} / 매칭율 {rate}%")
    print("--- 미매칭 대표 ---")
    for r in unmatched_rows:
        print(f"  {r[0]} {r[1]} vs {r[2]}")
    print(f"[실험셋] (배당+결과) 겹치는 경기 {overlap}건")
    return 0


if __name__ == "__main__":
    sys.exit(main())
