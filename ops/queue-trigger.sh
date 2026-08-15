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
# 심볼릭 링크로 걸지 말고 **전체 경로로 직접** 호출할 것.
# 링크 해석은 아래에서 처리하지만, 굳이 변수를 늘릴 이유가 없다.
# 시스템 cron 데몬이 없는 환경이면 다른 스케줄러(Hermes cron 등)로 같은 명령을 걸면 된다.
#
# 잠금은 이 스크립트에 두지 않는다 — queue-trigger.js 안에서 처리한다.
# flock 을 여기 걸면 막힌 회차가 "실행했다"로 기록되어 그 지시를 잃는다.

set -u

# 심볼릭 링크로 걸어도 저장소 루트를 정확히 찾아야 한다.
# dirname 만 쓰면 링크가 있는 위치를 기준으로 잡아 ROOT 가 어긋난다. (실제로 겪은 문제다)
SELF="${BASH_SOURCE[0]}"
while [ -L "$SELF" ]; do
  LINK="$(readlink "$SELF")"
  case "$LINK" in
    /*) SELF="$LINK" ;;
    *)  SELF="$(dirname "$SELF")/$LINK" ;;
  esac
done
ROOT="$(cd "$(dirname "$SELF")/.." && pwd)"
cd "$ROOT" || exit 2

# 저장소 루트가 맞는지 확인 — 아니면 조용히 엉뚱한 곳에서 돌게 된다
if [ ! -f "$ROOT/ops/queue-trigger.js" ]; then
  echo "[trigger] 저장소 루트를 찾지 못했다: $ROOT" >&2
  exit 2
fi

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
