#!/usr/bin/env bash
# queue-trigger.sh — cron 용 래퍼
#
# 왜 래퍼가 필요한가:
#   1) crontab 에 키를 직접 쓰면 `crontab -l` 로 노출된다. 별도 파일(600)에 둔다.
#   2) cron 은 환경변수가 거의 없다. PATH 조차 최소라 node 를 못 찾는 경우가 흔하다.
#
# 설치:
#   cp ops/.trigger-env.example ops/.trigger-env
#   vi ops/.trigger-env          # 키·명령 채우기
#   chmod 600 ops/.trigger-env
#   crontab -e
#     * * * * * /opt/data/projects/workflow-builder/ops/queue-trigger.sh
#
# 잠금은 이 스크립트에 두지 않는다 — queue-trigger.js 안에서 처리한다.
# flock 을 여기 걸면 막힌 회차가 "실행했다"로 기록되어 그 지시를 잃는다.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

ENV_FILE="$ROOT/ops/.trigger-env"
if [ ! -f "$ENV_FILE" ]; then
  echo "[trigger] $ENV_FILE 없음 — ops/.trigger-env.example 을 복사해 채울 것" >&2
  exit 2
fi

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

# cron 의 최소 PATH 보완 — node 를 못 찾는 사고가 흔하다
export PATH="${WF_NODE_DIR:-/usr/local/bin}:/usr/bin:/bin:$PATH"

exec node "$ROOT/ops/queue-trigger.js"
