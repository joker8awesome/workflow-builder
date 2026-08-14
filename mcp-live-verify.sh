#!/usr/bin/env bash
# mcp-live-verify.sh
#
# 사용자 실 환경에서 실행:
#   ./mcp-live-verify.sh <API_KEY>
#
# 자동으로:
#   1. Preflight (whoami)
#   2. 시드 명령 인서트 (trace_id 자동 생성)
#   3. DB 상태 watch 시작 (변화 감지 시 알림)
#   4. 사용자에게 "Claude Desktop 열고 <trace_id> 처리 요청" 안내
#   5. 완료 감지 후 자동 검증 SQL 실행 및 결과 출력
#
# 필요: curl, jq, psql (또는 PGURL 환경 변수)

set -euo pipefail

# ==================== 설정 ====================
MCP_URL="${MCP_URL:-http://localhost:3737}"
AGENT_ID="${AGENT_ID:-ag_claude_desktop}"
PGURL="${PGURL:-postgresql://localhost/odds}"
WATCH_INTERVAL_SEC=2
WATCH_TIMEOUT_SEC=300  # 5분

API_KEY="${1:-}"
if [ -z "$API_KEY" ]; then
  echo "사용법: $0 <API_KEY>"
  echo "  예: $0 wf_ak_ag_claude_desktop_XXXX..."
  exit 1
fi

# 색상
G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; B='\033[0;34m'; N='\033[0m'
ok()   { echo -e "${G}✓${N} $1"; }
fail() { echo -e "${R}✗${N} $1"; }
info() { echo -e "${B}▸${N} $1"; }
warn() { echo -e "${Y}⚠${N} $1"; }

# ==================== 1. Preflight ====================
info "1단계: Preflight — agent.whoami"

whoami_response=$(curl -sS -w "\n%{http_code}" -X POST "$MCP_URL/mcp" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Mcp-Method: tools/call" \
  -H "Mcp-Name: agent.whoami" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"agent.whoami","arguments":{}}}')

http_code=$(echo "$whoami_response" | tail -n1)
body=$(echo "$whoami_response" | sed '$d')

if [ "$http_code" != "200" ]; then
  fail "HTTP $http_code — 실패"
  echo "$body"
  exit 1
fi

whoami_agent=$(echo "$body" | jq -r '.result.structuredContent.agent_id // empty')
if [ "$whoami_agent" != "$AGENT_ID" ]; then
  fail "agent_id 불일치: expected='$AGENT_ID', got='$whoami_agent'"
  echo "$body" | jq
  exit 1
fi
ok "whoami → agent_id=$whoami_agent"

# ==================== 2. 시드 명령 인서트 ====================
info "2단계: 시드 명령 인서트"

TRACE_ID="trace_e2e_$(date +%s)"
info "trace_id: $TRACE_ID"

seed_result=$(psql "$PGURL" -tAc "
  INSERT INTO wf_results (wf_id, node_id, result)
  VALUES ('wf_sup_test', 'result_live', '{\"task\":\"AI 뉴스 3개 요약\",\"keywords\":[\"AI\",\"2026\"]}'::jsonb)
  RETURNING node_id;
")
RESULT_ID=$(echo "$seed_result" | head -1 | tr -d ' \t\r')
info "wf_results.node_id: $RESULT_ID (payload_ref=$RESULT_ID)"

psql "$PGURL" -c "
  INSERT INTO agent_messages (msg_type, from_agent, to_agent, payload_ref, trace_id, created_at, status)
  VALUES ('command', 'orchestrator', '$AGENT_ID', '$RESULT_ID', '$TRACE_ID', now(), 'pending');
" > /dev/null

ok "시드 완료. Claude Desktop이 이 명령을 볼 수 있는 상태."

# ==================== 3. 안내 및 감시 시작 ====================
echo
echo "════════════════════════════════════════════════════════════════════════"
echo "  ▶ 지금 Claude Desktop 에서 대화 시작:"
echo "  ▶"
echo "  ▶   1) \"펜딩 작업 확인해줘\""
echo "  ▶   2) \"그거 처리해줘\""
echo "  ▶"
echo "  ▶ 스크립트가 자동으로 DB 감시. 완료되면 결과 자동 출력."
echo "  ▶ 중단: Ctrl+C  |  타임아웃: ${WATCH_TIMEOUT_SEC}s"
echo "════════════════════════════════════════════════════════════════════════"
echo

# ==================== 4. 상태 감시 ====================
info "3단계: DB 감시 시작 ($WATCH_INTERVAL_SEC초 간격)"

start_ts=$(date +%s)
last_state=""

while true; do
  now=$(date +%s)
  elapsed=$((now - start_ts))

  if [ $elapsed -gt $WATCH_TIMEOUT_SEC ]; then
    warn "타임아웃 (${WATCH_TIMEOUT_SEC}s). Claude Desktop 연결 확인:"
    warn "  - claude_desktop_config.json 정상?"
    warn "  - Claude Desktop 완전 재시작?"
    warn "  - View → Developer → Open MCP Logs 확인"
    exit 2
  fi

  state=$(psql "$PGURL" -tAF'|' -c "
    SELECT
      COALESCE((SELECT status FROM agent_messages
                WHERE trace_id='$TRACE_ID' AND msg_type='command'), 'null'),
      (SELECT COUNT(*) FROM agent_messages
       WHERE trace_id='$TRACE_ID' AND msg_type='report')::int,
      COALESCE((SELECT status FROM agent_checkpoints
                WHERE data->>'trace_id'='$TRACE_ID' LIMIT 1), 'null');
  " | tr -d ' ')

  if [ "$state" != "$last_state" ]; then
    IFS='|' read -r cmd_status report_count checkpoint <<< "$state"
    printf "\r[%3ds] cmd_status=%-10s report_count=%s checkpoint=%-6s\n" \
      "$elapsed" "$cmd_status" "$report_count" "$checkpoint"
    last_state="$state"

    # 완료 감지
    if [ "$cmd_status" = "completed" ] && [ "$report_count" -ge "1" ]; then
      echo
      ok "완료 감지"
      break
    fi
    if [ "$cmd_status" = "failed" ]; then
      echo
      warn "Claude가 failed로 보고함. 하단 span에서 error 확인."
      break
    fi
  else
    printf "\r[%3ds] 대기 중..." "$elapsed"
  fi

  sleep $WATCH_INTERVAL_SEC
done

# ==================== 5. 최종 검증 ====================
echo
info "4단계: 최종 검증"

echo
echo "--- agent_messages ---"
psql "$PGURL" -c "
  SELECT msg_type, from_agent, to_agent, payload_ref, status,
         to_char(created_at, 'HH24:MI:SS.MS') AS ts
  FROM agent_messages
  WHERE trace_id = '$TRACE_ID'
  ORDER BY id;
"

echo "--- agent_spans ---"
psql "$PGURL" -c "
  SELECT agent_id, operation, duration_ms,
         result::text AS result
  FROM agent_spans
  WHERE trace_id = '$TRACE_ID';
"

echo "--- agent_checkpoints ---"
psql "$PGURL" -c "
  SELECT data->>'agent_id' AS agent_id, status, to_char(created_at, 'HH24:MI:SS.MS') AS created_at
  FROM agent_checkpoints
  WHERE data->>'trace_id' = '$TRACE_ID';
"

echo "--- audit_logs (이 세션) ---"
psql "$PGURL" -c "
  SELECT action, COUNT(*)::int AS n,
         MIN(to_char(created_at, 'HH24:MI:SS')) AS first,
         MAX(to_char(created_at, 'HH24:MI:SS')) AS last
  FROM audit_logs
  WHERE actor = '$AGENT_ID' AND timestamp >= to_timestamp($start_ts)
  GROUP BY action ORDER BY first;
"

echo "--- result payload (Claude가 실제로 저장한 것) ---"
psql "$PGURL" -c "
  SELECT id, payload
  FROM wf_results
  WHERE wf_id = 'wf_sup_test'
    AND created_at >= to_timestamp($start_ts)
  ORDER BY id DESC LIMIT 1;
"

# ==================== 6. 성공/실패 판정 ====================
echo
info "5단계: 판정"

verdict=$(psql "$PGURL" -tAc "
  SELECT
    CASE WHEN cmd_status='completed'
          AND report_count=1
          AND checkpoint='done'
          AND span_duration>=0
    THEN 'PASS' ELSE 'FAIL' END
  FROM (
    SELECT
      (SELECT status FROM agent_messages WHERE trace_id='$TRACE_ID' AND msg_type='command') AS cmd_status,
      (SELECT COUNT(*) FROM agent_messages WHERE trace_id='$TRACE_ID' AND msg_type='report')::int AS report_count,
      (SELECT status FROM agent_checkpoints WHERE data->>'trace_id'='$TRACE_ID' LIMIT 1) AS checkpoint,
      COALESCE((SELECT duration_ms FROM agent_spans WHERE trace_id='$TRACE_ID' LIMIT 1), 0) AS span_duration
  ) v;
" | tr -d ' ')

if [ "$verdict" = "PASS" ]; then
  ok "종단간 검증: PASS"
  echo
  echo "  ✓ 명령 → Claude 수신"
  echo "  ✓ payload.get → 데이터 로드"
  echo "  ✓ Claude 작업 수행 → report"
  echo "  ✓ command status = completed"
  echo "  ✓ checkpoint = done"
  echo "  ✓ span duration 기록"
  echo
  warn "다음 확인 필요 (스크립트로는 못 함):"
  echo "  - 웹 UI에 토스트/노드 하이라이트 뜨는지 (WS 브릿지)"
  echo "  - 새로고침 없이 반영되는지"
else
  fail "종단간 검증: FAIL"
  echo "  위 SQL 결과 확인 후 어느 단계에서 막혔는지 파악"
fi

# report 중복 체크 (관찰 4.2)
report_count=$(psql "$PGURL" -tAc "
  SELECT COUNT(*)::int FROM agent_messages
  WHERE trace_id='$TRACE_ID' AND msg_type='report'")
if [ "$report_count" -gt "1" ]; then
  echo
  warn "report 중복 감지 ($report_count건). 관찰 4.2 실전 발생 — 하드닝 필요."
fi
