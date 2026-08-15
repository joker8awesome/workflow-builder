#!/usr/bin/env bash
# Hermes cron wrapper — 실제 queue-trigger.sh를 올바른 경로로 exec
exec /opt/data/projects/workflow-builder/ops/queue-trigger.sh "$@"
