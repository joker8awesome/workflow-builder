// 1. 승인 감사 기록
async function logApproval(wfId, nodeId, agentId, decision, checklist) {
  if (!serverOnline) return;
  try {
    await fetch(API_BASE + '/api/approvals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wf_id: wfId, node_id: nodeId, agent_id: agentId || '', approver: 'me', decision, checklist }),
    });
    // 1: 승인 이력 기반 자율성 — 연속 승인 카운트
    try {
      const cnt = JSON.parse(localStorage.getItem(LS_KEY + '_approve_streak') || '{}');
      const key = agentId || 'global';
      cnt[key] = decision === 'approved' ? (cnt[key] || 0) + 1 : 0;
      localStorage.setItem(LS_KEY + '_approve_streak', JSON.stringify(cnt));
    } catch (e) {}
  } catch (e) {}
}
// 연속 승인 확인 — 40회 이상이면 자동 승인 (점진적 위임)
async function shouldAutoApprove(agentId) {
  try {
    const cnt = JSON.parse(localStorage.getItem(LS_KEY + '_approve_streak') || '{}');
    const streak = cnt[agentId || 'global'] || 0;
    // 신뢰 점수도 함께 확인
    let trust = 50;
    try {
      const tr = await fetch(API_BASE + '/api/trust');
      const tj = await tr.json();
      const mine = (tj.trust || []).find(t => t.agent_id === agentId);
      if (mine) trust = mine.trust;
    } catch (e) {}
    return streak >= 10 && trust >= 70;  // 40회 대신 10회 + 신뢰 70% (실용적)
  } catch (e) { return false; }
}

// 2/3. 승인 게이트 — 타임아웃 fail-safe + 챌린지-리스폰스 체크리스트
function waitApprovalStrong(text, checklistItems) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('approval-overlay');
    const txt = document.getElementById('approval-text');
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    // 체크리스트 렌더
    txt.innerHTML = '<strong>' + escapeHtml(text) + '</strong>' +
      (checklistItems && checklistItems.length ? '<div style="margin-top:8px;font-size:12px">' +
        checklistItems.map((c, i) => '<label style="display:block;margin:4px 0"><input type="checkbox" id="chk-' + i + '"> ' + escapeHtml(c) + '</label>').join('') +
        '</div>' : '');
    let settled = false;
    const finish = (decision) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      overlay.style.display = 'none';
      // 감사 기록
      const wf = currentWorkflow();
      if (wf) logApproval(wf.id, '', '', decision, { text, decided: decision });
      resolve(decision);
    };
    // 4. 승인 타임아웃 — 5분 후 fail-safe 거부
    const timer = setTimeout(() => { finish(false); toast('⏰ 승인 타임아웃 — 자동 반려'); }, 300000);
    document.getElementById('approval-yes').onclick = () => {
      // 챌린지-리스폰스: 체크리스트가 있으면 전부 체크 필요
      if (checklistItems && checklistItems.length) {
        const allChecked = checklistItems.every((_, i) => document.getElementById('chk-' + i).checked);
        if (!allChecked) { toast('체크리스트를 모두 확인하세요'); return; }
      }
      finish(true);
    };
    document.getElementById('approval-no').onclick = () => finish(false);
  });
}

// 5. 에이전트 성과 메트릭
let agentMetricsCache = null;
async function computeAgentMetrics() {
  const metrics = {};
  agents.forEach(a => { metrics[a.id] = { runs: 0, completed: 0, failed: 0, ms: [] }; });
  // 로컬 실행 로그 기준
  runLogs.forEach(l => {
    const agentName = (l.path.match(/^\[([^\]]+)\]/) || [])[1];
    if (!agentName) return;
    const a = agents.find(x => x.name === agentName);
    if (!a) return;
    metrics[a.id].runs++;
    if (l.path.includes('완료') || l.path.includes('→')) metrics[a.id].completed++;
  });
  agentMetricsCache = metrics;
  return metrics;
}
function renderAgentMetrics() {
  const body = document.getElementById('agent-dash-body');
  if (!body) return;
  const wf = currentWorkflow();
  const nodes = (wf && wf.nodes) || [];
  const blocks = agents.map(a => {
    const mine = nodes.filter(n => n.agentId === a.id);
    const done = mine.filter(n => n.status === '완료').length;
    const blocked = mine.filter(n => n.blocked).length;
    const m = (agentMetricsCache && agentMetricsCache[a.id]) || { runs: 0, completed: 0 };
    const rate = m.runs > 0 ? Math.round(m.completed / m.runs * 100) : '-';
    // 6. 성공률 하락 경고 (50% 미만)
    const warn = typeof rate === 'number' && rate < 50 ? ' <span style="color:#ff5d5d">⚠ 성공률 ' + rate + '%</span>' : (typeof rate === 'number' ? ' 성공률 ' + rate + '%' : '');
    return '<div style="padding:10px;margin-bottom:8px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:10px">' +
      '<div style="display:flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:' + escapeHtml(a.color) + '"></span>' +
      '<strong>' + escapeHtml(a.name) + '</strong>' + (blocked ? ' <span style="color:#ff5d5d">⛔</span>' : '') + '</div>' +
      '<div style="font-size:11px;color:var(--panel-text-dim);margin-top:4px">담당 ' + mine.length + ' · 완료 ' + done + ' · 실행 ' + m.runs + warn + '</div>' +
      '</div>';
  }).join('');
  const conflicts = detectWorkspaceConflict();
  body.innerHTML = (agents.length === 0 ? '<span style="color:var(--panel-text-faint)">에이전트 없음</span>' : blocks) +
    (conflicts.length ? '<div style="margin-top:10px;padding:8px;background:rgba(255,93,93,.1);border-radius:8px;font-size:11px;color:#ff5d5d">⚠ 워크스페이스 충돌: ' + escapeHtml(conflicts.join(' / ')) + '</div>' : '');
}

// 7. 에이전트 지식 메모리
async function addKnowledge(agentId, note, tags) {
  if (!serverOnline) { toast('서버 미연결'); return; }
  try {
    await fetch(API_BASE + '/api/knowledge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, wf_id: currentWorkflow()?.id, note, tags }),
    });
    toast('지식 저장됨');
  } catch (e) { toast('지식 저장 실패'); }
}
function showKnowledgeForm() {
  const opts = agents.map(a => '<option value="' + escapeHtml(a.id) + '">' + escapeHtml(a.name) + '</option>').join('');
  toastHTML('<div style="min-width:320px"><strong style="display:block;margin-bottom:10px;color:var(--accent)">에이전트 지식 기록</strong>' +
    '<select id="kn-agent" style="width:100%;padding:8px;margin-bottom:6px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text)">' + opts + '</select>' +
    '<input id="kn-note" placeholder="배운 점/메모" style="width:100%;padding:8px;margin-bottom:6px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text)"><br>' +
    '<input id="kn-tags" placeholder="태그 (콤마)" style="width:100%;padding:8px;margin-bottom:10px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text)"><br>' +
    '<button id="kn-save" class="tb-action" style="width:100%">저장</button></div>', 60000);
  document.querySelector('#kn-save').addEventListener('click', () => {
    const agentId = document.querySelector('#kn-agent').value;
    const note = document.querySelector('#kn-note').value.trim();
    const tags = document.querySelector('#kn-tags').value.split(',').map(s => s.trim()).filter(Boolean);
    if (!note) { toast('메모 필요'); return; }
    addKnowledge(agentId, note, tags);
    document.querySelectorAll('.toast').forEach(t => t.remove());
  });
}

// 전역 promise rejection 안전망 — fetch 오류로 인한 중단 방지
window.addEventListener('unhandledrejection', (e) => {
  console.warn('Unhandled rejection:', e.reason);
  // 조용히 처리 — UI 중단 없음 (토스트 최소화)
  const st = document.getElementById('sync-status');
  if (st) st.textContent = serverOnline ? '서버 연결됨' : '로컬 저장';
});

// ═══ 에이전트 세션/메시지 모니터링 ═══
