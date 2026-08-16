// 1. Agent Activity Feed — 실시간 + 필터
let feedEvents = [];
async function loadFeed() {
  try {
    const r = await fetch(API_BASE + '/api/events');
    const j = await r.json();
    feedEvents = j.success ? (j.events || []) : [];
  } catch (e) { feedEvents = []; }
}
function renderFeed() {
  const body = document.getElementById('feed-body');
  const filter = document.getElementById('feed-filter').value;
  const list = feedEvents.filter(e => !filter || e.action === filter);
  body.innerHTML = list.length === 0
    ? '<span style="color:var(--panel-text-faint)">활동 없음</span>'
    : list.slice(0, 30).map(e => {
        const color = e.action === 'fail' ? '#ff5d5d' : e.action === 'approve' ? '#d29922' : 'var(--accent)';
        return '<div style="padding:7px;margin-bottom:5px;background:var(--dark-3);border-radius:8px;font-size:11px;display:flex;justify-content:space-between">' +
          '<span><span style="color:' + color + ';font-weight:700">' + escapeHtml(e.action) + '</span> ' +
          '<span style="color:var(--panel-text-dim)">' + escapeHtml(e.resource) + '</span></span>' +
          '<span style="color:var(--panel-text-faint)">' + new Date(e.created_at).toLocaleTimeString() + '</span></div>';
      }).join('');
}
async function toggleFeed() {
  const panel = document.getElementById('feed-panel');
  if (togglePanel(panel)) { await loadFeed(); renderFeed(); }
}
// WS로 실시간 이벤트 수신 (기존 ws 메시지에 통합 — feed 갱신)

// 2. 신뢰도 표시 — LLM 판단 결과에 confidence
function renderConfidence(node) {
  if (!node || !node.confidence) return '';
  const c = node.confidence;
  const color = c >= 80 ? 'var(--accent)' : c >= 50 ? '#d29922' : '#ff5d5d';
  return '<span class="conf-badge" style="color:' + color + '" title="신뢰도">' + c + '%</span>';
}

// 3. 실패/블로커 텔레그램 알림 — 실행 실패 시 자동
async function notifyTelegramAlert(message) {
  try {
    await fetch(API_BASE + '/api/exec', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: 'echo "' + message.slice(0, 80).replace(/"/g, "'") + '"', agent_id: 'alert' }),
    }).catch(() => {});
    // 실제 텔레그램 전송은 telegram 노드/게이트웨이 연동 — 여기선 감사 기록
    await fetch(API_BASE + '/api/audit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: 'system', agent_id: '', resource: 'alert', action: 'fail', detail: message }),
    }).catch(() => {});
    feedEvents.unshift({ action: 'fail', resource: message.slice(0, 60), created_at: new Date().toISOString() });
  } catch (e) {}
}

// 4. 오류 복구 3부 메시지 — 무엇/왜/다음
function errorRecovery3(what, why, next) {
  toastHTML('<div style="min-width:280px;border-left:3px solid #ff5d5d;padding-left:10px">' +
    '<strong style="color:#ff5d5d">' + escapeHtml(what) + '</strong>' +
    '<div style="margin-top:6px;color:var(--panel-text-dim)">' + escapeHtml(why) + '</div>' +
    '<div style="margin-top:6px;color:var(--accent)">→ ' + escapeHtml(next) + '</div></div>', 7000);
}

// 6. 실시간 파이프라인 뷰 — 노드 상태 컬러 강화 (renderCanvas에 이미 exec-badge, status-badge)
// 6: 노드 레벨 상태 선제 통신
function setProactiveStatus(text) {
  const el = document.getElementById('rs-status');
  if (el && text) el.textContent = '🔄 ' + text;
}
function pipelineStatusBadge(n) {
  if (n.status === '완료' || n.status === 'done') return '<span class="pipe-badge done">●</span>';
  if (n.blocked) return '<span class="pipe-badge blocked" title="블로커">⛔</span>';
  if (n.status === '진행' || n.status === 'running') return '<span class="pipe-badge running">◐</span>';
  return '<span class="pipe-badge idle">○</span>';
}

// 8. Scope Boundary — Agent Card 권한 노출 (에이전트 패널에)
function scopeBoundaryHTML(agent) {
  const scopes = (agent.scopes || ['execute', 'report']);
  return '<div style="font-size:10px;color:var(--panel-text-faint);margin-top:4px">권한: ' +
    scopes.map(s => '<span style="background:var(--dark);border-radius:4px;padding:1px 6px;margin-right:4px">' + escapeHtml(s) + '</span>').join('') + '</div>';
}

// ═══ 테스트 스위트 + 회귀 게이트 모듈 ═══
