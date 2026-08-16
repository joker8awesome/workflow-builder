// 4. 작업 상태 단계 — 노드에 status 표시
const WORK_STATUS = ['대기', '진행', '검토', '완료', '블로커'];
function nodeStatusBadge(n) {
  const s = n.status || '대기';
  const color = s === '완료' ? 'var(--accent)' : s === '진행' ? '#d29922' : s === '검토' ? '#1f6feb' : 'var(--panel-text-faint)';
  return '<span class="status-badge" style="color:' + color + '">' + s + '</span>';
}

// 5. 에이전트 간 메시지 — 노드에 handoff_msg
function agentHandoffInfo(n) {
  if (!n.handoff_msg) return '';
  return '<span class="handoff-msg" title="' + escapeHtml(n.handoff_msg) + '">✉ ' + escapeHtml(String(n.handoff_msg).slice(0, 14)) + (n.handoff_msg.length > 14 ? '…' : '') + '</span>';
}

// 7. 블로커 플래그
function blockerBadge(n) {
  return n.blocked ? '<span class="blocker-badge">⛔ 블로커</span>' : '';
}

// 6. 파일 충돌 감지 — 같은 워크스페이스 에이전트 찾기
function detectWorkspaceConflict() {
  const map = {};
  agents.forEach(a => {
    const ws = (a.machine || {}).workspace;
    if (ws) { if (!map[ws]) map[ws] = []; map[ws].push(a.name); }
  });
  const conflicts = Object.entries(map).filter(([ws, names]) => names.length > 1);
  return conflicts.map(([ws, names]) => ws + ': ' + names.join(', '));
}

// 1. 에이전트 핸드오프 — 엣지에 인계 표시
function renderHandoffs() {
  const wf = currentWorkflow();
  if (!wf || !wf.edges) return;
  // 엣지 라벨이 비어있고 양쪽 에이전트가 다르면 핸드오프 표시
  const svg = document.getElementById('edges');
  wf.edges.forEach(e => {
    const from = wf.nodes.find(n => n.id === e.from);
    const to = wf.nodes.find(n => n.id === e.to);
    if (!from || !to) return;
    const aFrom = getAgent(from.agentId);
    const aTo = getAgent(to.agentId);
    if (aFrom && aTo && aFrom.id !== aTo.id && !e.label) {
      // 엣지 중간에 핸드오프 아이콘 (SVG text)
      const x1 = from.x + 180, y1 = from.y + 26, x2 = to.x, y2 = to.y + 26;
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', (x1 + x2) / 2); t.setAttribute('y', (y1 + y2) / 2 + 10);
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '10');
      t.setAttribute('fill', '#9aa3ad');
      t.textContent = '↪ ' + aFrom.name.slice(0, 6) + '→' + aTo.name.slice(0, 6);
      svg.appendChild(t);
    }
  });
}

// 8. 에이전트 대시보드
function renderAgentDashboard() {
  const body = document.getElementById('agent-dash-body');
  const wf = currentWorkflow();
  const nodes = (wf && wf.nodes) || [];
  const rows = agents.map(a => {
    const mine = nodes.filter(n => n.agentId === a.id);
    const done = mine.filter(n => n.status === '완료').length;
    const blocked = mine.filter(n => n.blocked).length;
    const runs = runLogs.filter(l => l.path && l.path.includes(a.name)).length;
    return '<div style="padding:10px;margin-bottom:8px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:10px">' +
      '<div style="display:flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:' + escapeHtml(a.color) + '"></span>' +
      '<strong>' + escapeHtml(a.name) + '</strong>' + (blocked ? ' <span style="color:#ff5d5d">⛔</span>' : '') + '</div>' +
      '<div style="font-size:11px;color:var(--panel-text-dim);margin-top:4px">담당 ' + mine.length + ' · 완료 ' + done + ' · 실행 ' + runs + '</div>' +
      (blocked ? '<div style="font-size:11px;color:#ff5d5d">블로커 ' + blocked + '개</div>' : '') +
      '</div>';
  }).join('');
  const conflicts = detectWorkspaceConflict();
  body.innerHTML = (agents.length === 0 ? '<span style="color:var(--panel-text-faint)">에이전트 없음</span>' : rows) +
    (conflicts.length ? '<div style="margin-top:10px;padding:8px;background:rgba(255,93,93,.1);border-radius:8px;font-size:11px;color:#ff5d5d">⚠ 워크스페이스 충돌: ' + escapeHtml(conflicts.join(' / ')) + '</div>' : '');
}

// ═══ Strong HITL + 평가 + 지식 모듈 ═══
