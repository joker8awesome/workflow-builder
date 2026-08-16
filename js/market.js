async function loadSessions(wfId) {
  try {
    const url = wfId ? API_BASE + '/api/sessions?wf=' + encodeURIComponent(wfId) : API_BASE + '/api/sessions';
    const r = await fetch(url);
    const j = await r.json();
    return j.success ? (j.sessions || []) : [];
  } catch (e) { return []; }
}
async function loadMessages(sessionId) {
  try {
    const url = sessionId ? API_BASE + '/api/messages?session=' + encodeURIComponent(sessionId) : API_BASE + '/api/messages';
    const r = await fetch(url);
    const j = await r.json();
    return j.success ? (j.messages || []) : [];
  } catch (e) { return []; }
}
async function renderSessionPanel() {
  const body = document.getElementById('session-body');
  if (!body) return;
  const wf = currentWorkflow();
  const wfId = wf ? wf.id : null;
  const [sessions, messages] = await Promise.all([loadSessions(wfId), loadMessages()]);
  const color = { idle: 'var(--panel-text-faint)', running: '#d29922', done: 'var(--accent)', failed: '#ff5d5d', waiting: '#1f6feb' };
  body.innerHTML =
    '<div style="margin-bottom:10px"><strong>세션 (' + sessions.length + ')</strong></div>' +
    (sessions.length === 0 ? '<span style="color:var(--panel-text-faint)">세션 없음 — ▶ 실행으로 생성</span>' :
      sessions.map(s => '<div style="padding:8px;margin-bottom:6px;background:var(--dark-3);border-radius:8px;display:flex;justify-content:space-between;align-items:center">' +
        '<span><strong>' + escapeHtml(s.agent_id) + '</strong> <span style="color:var(--panel-text-faint);font-size:10px">' + escapeHtml(s.node_id) + '</span></span>' +
        '<span style="color:' + (color[s.status] || 'var(--panel-text)') + ';font-weight:600">' + s.status + '</span></div>').join('')) +
    '<div style="margin:14px 0 8px"><strong>메시지 (' + messages.length + ')</strong></div>' +
    (messages.length === 0 ? '<span style="color:var(--panel-text-faint)">메시지 없음</span>' :
      messages.slice(0, 20).map(m => {
        const badge = m.msg_type === 'report' ? 'var(--accent)' : m.msg_type === 'instruction' ? '#1f6feb' : '#d29922';
        return '<div style="padding:6px;margin-bottom:4px;background:var(--dark-3);border-radius:6px;font-size:11px">' +
          '<span style="color:' + badge + ';font-weight:700">' + m.msg_type + '</span> ' +
          '<span style="color:var(--panel-text-dim)">' + escapeHtml(m.from_agent) + ' → ' + escapeHtml(m.to_agent) + '</span>' +
          ' <span style="color:var(--panel-text-faint)">' + escapeHtml(JSON.stringify(m.payload || {}).slice(0, 60)) + '</span></div>';
      }).join(''));
}
function toggleSessionPanel() {
  const panel = document.getElementById('session-panel');
  if (togglePanel(panel)) renderSessionPanel();
}
// 세션 실행 — 파이썬 오케스트레이터 호출 (웹에서 직접 실행은 불가, 서버 exec로)
async function runAgentSessions() {
  const wf = currentWorkflow();
  if (!wf) { toast('워크플로우 없음'); return; }
  toast('오케스트레이터 실행 중...');
  try {
    const r = await fetch(API_BASE + '/api/exec', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: '/opt/data/projects/workflow-builder/.agentenv/bin/python /opt/data/projects/workflow-builder/agent_orchestrator.py --workflow ' + wf.id + ' --run', agent_id: 'orchestrator' }),
    });
    const j = await r.json();
    toast(j.success ? '✅ 오케스트레이터 실행 완료' : '❌ 실패: ' + (j.error || ''));
    renderSessionPanel();
  } catch (e) { toast('실행 오류: ' + e.message); }
}

// ═══ 템플릿 마켓 + 감사 모듈 ═══
