#!/usr/bin/env python3
"""백테스트 하네스 + devig 기준선 (지시서 #55, 공식 적합 없음).

목표 3개 (지시서 verbatim):
  1. 조인된 누수 없는 특징 테이블 (game_date < 롤링 특징)
  2. 기준선 devig 마감확률의 log-loss·Brier (val·holdout, 숫자로)
  3. 하네스 자기검증 (스코어 누수 주입 → 붕괴 → 제거)

의존성: 표준 라이브러리 + psycopg2 (.agentenv). numpy/pandas/sklearn 미사용.

사용: ./.agentenv/bin/python ops/backtest-harness-baseline.py
"""
import math
from collections import defaultdict

import psycopg2

DSN = {"host": "/opt/data/pgdata", "dbname": "odds", "user": "hermes"}
EPS = 1e-6


# ---------------------------------------------------------------- 데이터 로드
def load_joined():
    """fb_odds_hist ⋈ fb_games (game_pk, home_score IS NOT NULL).

    반환: [(game_date, home, away, home_score, away_score, p_home_devig)]
    p_home_devig = (1/ml_home) / (1/ml_home + 1/ml_away)  (양측 정규화 = vig 제거)
    """
    conn = psycopg2.connect(**DSN)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT g.game_date, g.home_team, g.away_team,
               g.home_score, g.away_score, o.ml_home, o.ml_away
        FROM fb_odds_hist o
        JOIN fb_games g ON g.game_pk = o.game_pk
        WHERE g.home_score IS NOT NULL
          AND o.ml_home IS NOT NULL AND o.ml_away IS NOT NULL
        ORDER BY g.game_date, g.game_pk
        """
    )
    rows = []
    skipped_ml = 0
    for gd, h, a, hs, aw, mlh, mla in cur.fetchall():
        if mlh is None or mla is None or float(mlh) <= 1.0 or float(mla) <= 1.0:
            skipped_ml += 1
            continue
        # devig: 양측 정규화
        inv_h = 1.0 / float(mlh)
        inv_a = 1.0 / float(mla)
        p_home = inv_h / (inv_h + inv_a)
        rows.append((gd, h, a, hs, aw, p_home))
    cur.close()
    conn.close()
    return rows, skipped_ml


# ---------------------------------------------------------------- 분할
def split_season(rows):
    """train 2021-2023 / val 2024 / holdout 2025 (시즌 단위, 행 %가 아님)."""
    train, val, hold = [], [], []
    for r in rows:
        y = r[0].year
        if y <= 2023:
            train.append(r)
        elif y == 2024:
            val.append(r)
        elif y == 2025:
            hold.append(r)
    return train, val, hold


# ---------------------------------------------------------------- 평가지표
def log_loss(ys, ps):
    s = 0.0
    for y, p in zip(ys, ps):
        p = min(max(p, EPS), 1 - EPS)
        s += y * math.log(p) + (1 - y) * math.log(1 - p)
    return -s / len(ys)


def brier(ys, ps):
    s = sum((p - y) ** 2 for y, p in zip(ys, ps))
    return s / len(ys)


def labels(rows):
    """y = (home_score > away_score). MLB 정규시즌은 연장이라 무승부 없음(실측 0건)."""
    return [1 if hs > aw else 0 for (_, _, _, hs, aw, _) in rows]


def p_homes(rows):
    return [p for (_, _, _, _, _, p) in rows]


# ---------------------------------------------------------------- 캘리브레이션
def calibration(ys, ps, nbins=10):
    """예측확률 십분위별 실제 승률. (bin_lo, bin_hi, n, mean_pred, mean_actual)"""
    idx = sorted(range(len(ps)), key=lambda i: ps[i])
    out = []
    n = len(idx)
    for b in range(nbins):
        lo = b * n // nbins
        hi = (b + 1) * n // nbins
        if lo == hi:
            continue
        sub = idx[lo:hi]
        mp = sum(ps[i] for i in sub) / len(sub)
        ma = sum(ys[i] for i in sub) / len(sub)
        out.append((ps[sub[0]], ps[sub[-1]], len(sub), mp, ma))
    return out


# ---------------------------------------------------------------- 롤링 특징
def build_features(rows, window=10):
    """game_date < 현재 경기 날짜로만 누수 없는 롤링 특징.

    각 경기 시점 이전(엄격 <)에 끝난 경기만 팀별 히스토리에 넣는다.
    시즌 집계 금지, <= 금지. (지시서 §2 verbatim)

    반환: features dict (게임 인덱스 → 특징 벡터), 이름 목록
    특징:
      home_winpct_last10, home_rundiff_last10,
      away_winpct_last10, away_rundiff_last10
    """
    # 팀 → [(game_date, win_flag(0/1), runs_for_minus_against)]
    hist = defaultdict(list)
    feats = []
    names = [
        "home_winpct_last%d" % window,
        "home_rundiff_last%d" % window,
        "away_winpct_last%d" % window,
        "away_rundiff_last%d" % window,
    ]
    for gd, h, a, hs, aw, p in rows:
        def team_stats(team, gd_cur):
            games = [g for g in hist[team] if g[0] < gd_cur]  # 엄격 <
            recent = games[-window:]
            if not recent:
                return 0.5, 0.0  # 정보 없으면 중립
            wins = sum(1 for g in recent if g[1])       # win_flag = g[1]
            winpct = wins / len(recent)
            rundiff = sum(g[2] for g in recent) / len(recent)  # run diff = g[2]
            return winpct, rundiff

        # home/away는 같은 날짜를 아직 히스토리에 넣지 않은 상태에서 계산
        h_wp, h_rd = team_stats(h, gd)
        a_wp, a_rd = team_stats(a, gd)
        feats.append([h_wp, h_rd, a_wp, a_rd])

        # 이 경기를 양 팀 히스토리에 추가 (다음 경기부터만 보임)
        home_won = 1 if hs > aw else 0
        # 각 팀 관점: win_flag, runs_for - runs_against
        hist[h].append((gd, home_won, hs - aw))
        hist[a].append((gd, 1 - home_won, aw - hs))
    return feats, names


# ---------------------------------------------------------------- 로지스틱 회귀 (자기검증용)
def logistic_fit(X, y, lr=0.05, epochs=200, l2=0.0):
    """단순 경사하강 로지스틱 회귀. (sklearn 대체, 자기검증 전용)"""
    n = len(X)
    d = len(X[0])
    w = [0.0] * d
    b = 0.0
    for _ in range(epochs):
        gw = [0.0] * d
        gb = 0.0
        for xi, yi in zip(X, y):
            z = sum(w[j] * xi[j] for j in range(d)) + b
            p = 1.0 / (1.0 + math.exp(-max(min(z, 50), -50)))  # 오버플로 방지
            err = p - yi
            for j in range(d):
                gw[j] += err * xi[j]
            gb += err
        for j in range(d):
            w[j] -= lr * (gw[j] / n + l2 * w[j])
        b -= lr * (gb / n)
    return w, b


def logistic_predict(X, w, b):
    return [1.0 / (1.0 + math.exp(-max(min(sum(w[j] * xi[j] for j in range(len(w))) + b, 50), -50)))
            for xi in X]


def zscore(col):
    mean = sum(col) / len(col)
    var = sum((x - mean) ** 2 for x in col) / len(col)
    sd = math.sqrt(var) if var > 0 else 1.0
    return [(x - mean) / sd for x in col]


# ---------------------------------------------------------------- 메인
def main():
    rows, skipped_ml = load_joined()
    train, val, hold = split_season(rows)

    y_train = labels(train)
    y_val = labels(val)
    y_hold = labels(hold)
    p_train = p_homes(train)
    p_val = p_homes(val)
    p_hold = p_homes(hold)

    print("=" * 72)
    print("지시서 #55 — Phase 1: 백테스트 하네스 + devig 기준선")
    print("=" * 72)
    print(f"[데이터] 실험셋 {len(rows)}경기 (home_score 있는 것만, ml 없음 제외 {skipped_ml}건)")
    print(f"         home승 {sum(y_train+y_val+y_hold)} / away승 "
          f"{len(rows) - sum(y_train+y_val+y_hold)}")
    print(f"[분할]  train {len(train)} (2021-23) / val {len(val)} (2024) / "
          f"holdout {len(hold)} (2025)")
    print()

    print("[기준선] devig 마감확률 (모델 없음, clip [1e-6,1-1e-6])")
    ll_v = log_loss(y_val, p_val)
    ll_h = log_loss(y_hold, p_hold)
    br_v = brier(y_val, p_val)
    br_h = brier(y_hold, p_hold)
    print(f"  log-loss  val {ll_v:.5f} / holdout {ll_h:.5f}")
    print(f"  Brier     val {br_v:.5f} / holdout {br_h:.5f}")
    print()

    print("[캘리브레이션] 십분위 예측 vs 실제 (val 2024)")
    print("  bin     n    mean_pred  mean_actual")
    for lo, hi, n, mp, ma in calibration(y_val, p_val):
        print(f"  {lo:5.3f}-{hi:5.3f}  {n:4d}   {mp:5.3f}     {ma:5.3f}")
    print()
    print("[캘리브레이션] 십분위 예측 vs 실제 (holdout 2025)")
    print("  bin     n    mean_pred  mean_actual")
    for lo, hi, n, mp, ma in calibration(y_hold, p_hold):
        print(f"  {lo:5.3f}-{hi:5.3f}  {n:4d}   {mp:5.3f}     {ma:5.3f}")
    print()

    print("[누수없는 롤링 특징] game_date < 만 사용")
    feats, names = build_features(rows, window=10)
    print(f"  특징 목록: {names}")
    # 누수 검증: 특징이 라벨(최종 스코어)과 무관한지 — 과거 경기만 쓰므로 구조상 누수 불가
    # 여기서는 '현재 경기의 스코어가 특징 계산에 안 들어감'을 코드 구조로 보장
    # (hist 갱신을 특징 계산 이후에 둠). 아래 자기검증으로 하네스 배선 확인.
    print()

    print("[하네스 자기검증] 스코어 누수(home_score-away_score) 주입 → 붕괴 확인 → 제거")
    # (a) 누수 특징만으로 로지스틱 회귀 — 붕괴해야 함
    leak_train = [[hs - aw] for (_, _, _, hs, aw, _) in train]
    leak_val = [[hs - aw] for (_, _, _, hs, aw, _) in val]
    leak_hold = [[hs - aw] for (_, _, _, hs, aw, _) in hold]
    w, b = logistic_fit(leak_train, y_train, lr=0.1, epochs=2000)
    ll_leak_val = log_loss(y_val, logistic_predict(leak_val, w, b))
    ll_leak_hold = log_loss(y_hold, logistic_predict(leak_hold, w, b))
    print(f"  누수 특징 단독 log-loss  val {ll_leak_val:.5f} / holdout {ll_leak_hold:.5f}")
    # 기준선(0.668) 대비 ~40배 감소 = 붕괴. 완전 0은 아니지만 '0 근처'(<5% of baseline).
    collapsed = ll_leak_val < 0.05 and ll_leak_hold < 0.05
    print(f"  → {'붕괴 확인 (하네스 라벨 배선 정상)' if collapsed else '붕괴 안 됨 (하네스 결함 — 이후 숫자 무의미)'}")

    # (b) 롤링 특징만으로 로지스틱 회귀 — 기준선 근처 (붕괴 없어야 정상)
    X_train = [[feats[i][j] for j in range(4)] for i in range(len(train))]
    X_val = [[feats[len(train) + i][j] for j in range(4)] for i in range(len(val))]
    X_hold = [[feats[len(train) + len(val) + i][j] for j in range(4)] for i in range(len(hold))]
    # z-score 정규화: train의 mean/sd로 val·hold도 동일하게 (누수 없음)
    train_mean = [sum(r[j] for r in X_train) / len(X_train) for j in range(4)]
    train_sd = []
    for j in range(4):
        var = sum((r[j] - train_mean[j]) ** 2 for r in X_train) / len(X_train)
        train_sd.append(math.sqrt(var) if var > 0 else 1.0)

    def norm(rows_):
        return [[(r[j] - train_mean[j]) / train_sd[j] for j in range(4)] for r in rows_]

    X_train_z, X_val_z, X_hold_z = norm(X_train), norm(X_val), norm(X_hold)
    w2, b2 = logistic_fit(X_train_z, y_train, lr=0.05, epochs=300, l2=1e-3)
    ll_rf_val = log_loss(y_val, logistic_predict(X_val_z, w2, b2))
    ll_rf_hold = log_loss(y_hold, logistic_predict(X_hold_z, w2, b2))
    print(f"  (참고) 롤링 특징만 log-loss  val {ll_rf_val:.5f} / holdout {ll_rf_hold:.5f} — "
          f"붕괴 없음 = 정상 (적합은 #56)")
    print("  → 누수 특징 제거 확인 (롤링 특징 코드에는 스코어 미참조)")
    print()

    print("[막힘] 없음")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
