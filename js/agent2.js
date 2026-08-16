let agents = [];
let selectedAgent = null;

// 에이전트 로드 (서버 우선, 실패 시 로컬)
async function loadAgents() {
  try {
    const r = await fetch(API_BASE + '/api/agents');
    const j = await r.json();
    if (j.success) { agents = j.agents || []; saveAgentsLocal(); renderAgents(); return; }
  } catch (e) {}
  try { agents = JSON.parse(localStorage.getItem(LS_KEY + '_agents') || '[]'); } catch (e) { agents = []; }
  renderAgents();
}
function saveAgentsLocal() {
  try { localStorage.setItem(LS_KEY + '_agents', JSON.stringify(agents)); } catch (e) {}
}
function getAgent(id) { return agents.find(a => a.id === id) || null; }

// 에이전트 등록 폼
function showAgentForm(agent) {
  const a = agent || {};
  toastHTML('' +
    '<div style="min-width:360px"><strong style="display:block;margin-bottom:10px;color:var(--accent)">' + (agent ? '에이전트 수정' : '에이전트 등록') + '</strong>' +
    '<input id="ag-name" placeholder="이름" value="' + escapeHtml(a.name || '') + '" style="width:100%;padding:8px;margin-bottom:6px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text)"><br>' +
    '<input id="ag-person" placeholder="담당자" value="' + escapeHtml(a.person || '') + '" style="width:100%;padding:8px;margin-bottom:6px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text)"><br>' +
    '<input id="ag-role" placeholder="역할" value="' + escapeHtml(a.role || '') + '" style="width:100%;padding:8px;margin-bottom:6px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text)"><br>' +
    '<input id="ag-spec" placeholder="머신스펙 (예: 8vCPU/16GB/GPU1)" value="' + escapeHtml((a.machine || {}).spec || '') + '" style="width:100%;padding:8px;margin-bottom:6px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text)"><br>' +
    '<input id="ag-env" placeholder="구축환경 (예: Docker)" value="' + escapeHtml((a.machine || {}).env || '') + '" style="width:100%;padding:8px;margin-bottom:6px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text)"><br>' +
    '<input id="ag-ws" placeholder="워크스페이스 (예: /opt/data/...)" value="' + escapeHtml((a.machine || {}).workspace || '') + '" style="width:100%;padding:8px;margin-bottom:6px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text)"><br>' +
    '<input id="ag-sess" placeholder="세션별 역할" value="' + escapeHtml((a.machine || {}).session_role || '') + '" style="width:100%;padding:8px;margin-bottom:10px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text)"><br>' +
    '<input id="ag-color" type="color" value="' + (a.color || '#00ff87') + '" style="margin-bottom:10px"><br>' +
    '<div style="display:flex;gap:8px"><button id="ag-save" class="tb-action" style="flex:1">저장</button><button id="ag-cancel" class="tb-action">취소</button></div></div>', 60000);
  const saveBtn = document.querySelector('#ag-save');
  saveBtn.addEventListener('click', async () => {
    const data = {
      id: (agent && agent.id) || 'ag_' + Date.now().toString(36),
      name: document.querySelector('#ag-name').value.trim(),
      person: document.querySelector('#ag-person').value.trim(),
      role: document.querySelector('#ag-role').value.trim(),
      machine: {
        spec: document.querySelector('#ag-spec').value.trim(),
        env: document.querySelector('#ag-env').value.trim(),
        workspace: document.querySelector('#ag-ws').value.trim(),
        session_role: document.querySelector('#ag-sess').value.trim(),
      },
      color: document.querySelector('#ag-color').value,
    };
    if (!data.name) { toast('이름 필요'); return; }
    if (agent) {
      const idx = agents.findIndex(x => x.id === agent.id);
      if (idx >= 0) agents[idx] = { ...agents[idx], ...data };
    } else {
      agents.push(data);
    }
    saveAgentsLocal();
    if (serverOnline) {
      await fetch(API_BASE + '/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).catch(() => {});
    }
    renderAgents(); renderCanvas(); renderInspector();
    toast('에이전트 저장됨');
  });
  document.querySelector('#ag-cancel').addEventListener('click', () => { document.querySelectorAll('.toast').forEach(t => t.remove()); });
}

// 2: 자율성 레벨 게이지 — 연속 승인 기반
function autonomyLevel(agentId) {
  try {
    const cnt = JSON.parse(localStorage.getItem(LS_KEY + '_approve_streak') || '{}');
    const streak = cnt[agentId || 'global'] || 0;
    if (streak >= 10) return 3;
    if (streak >= 5) return 2;
    return 1;
  } catch (e) { return 1; }
}
function autonomyGaugeHTML(agentId) {
  const lv = autonomyLevel(agentId);
  return '<span style="font-size:10px;color:var(--panel-text-faint)">자율성 Lv' + lv + '/3</span> <span style="font-size:10px">' +
    (lv >= 1 ? '●' : '○') + (lv >= 2 ? '●' : '○') + (lv >= 3 ? '●' : '○') + '</span>';
}
// 에이전트 패널 렌더
// 에이전트 노드 배치 — 시작→종료 사이에 process 노드 삽입
function placeAgentNode(agentId) {
  const wf = currentWorkflow();
  if (!wf) return;
  const ag = getAgent(agentId);
  if (!ag) return;
  const id = 'n_' + Date.now().toString(36);
  // 시작 노드 찾기, 없으면 왼쪽 끝 노드 뒤에
  const start = wf.nodes.find(n => n.type === 'start');
  const end = wf.nodes.find(n => n.type === 'end');
  const baseX = start ? start.x : 80;
  const baseY = start ? start.y : 200;
  // 같은 y의 노드들 중 가장 오른쪽
  const sameRow = wf.nodes.filter(n => Math.abs(n.y - baseY) < 40);
  const maxX = sameRow.length ? Math.max(...sameRow.map(n => n.x)) : baseX;
  const node = {
    id, type: 'process', x: maxX + 220, y: baseY,
    label: ag.name, desc: ag.role || '', assignee: ag.person || '',
    due: '', tags: [], agentId, status: '대기', color: ag.color
  };
  wf.nodes.push(node);
  // 시작→종료 직접 엣지가 있으면 재연결: 시작→새노드→종료
  if (start && end) {
    const direct = wf.edges.find(e => e.from === start.id && e.to === end.id);
    if (direct) {
      direct.to = node.id;
      wf.edges.push({ id: 'e_' + Date.now().toString(36), from: node.id, to: end.id, label: '' });
    }
  }
  pushHistory();
  saveStore(); renderAll();
  selected = { type: 'node', id };
  renderInspector();
  toast('✅ 에이전트 배치: ' + ag.name);
}
function renderAgents() {
  const list = document.getElementById('agents-list');
  if (!list) return;
  const wf = currentWorkflow();
  const nodes = (wf && wf.nodes) || [];
  list.innerHTML = agents.length === 0
    ? '<span style="color:var(--panel-text-faint)">등록된 에이전트 없음</span>'
    : agents.map(a => {
      const mine = nodes.filter(n => n.agentId === a.id).length;
      const warn = mine >= 5 ? ' <span style="color:#ff5d5d">⚠ ' + mine + '개</span>' : ' (' + mine + ')';
      return '<div class="agent-item" data-id="' + a.id + '" style="padding:10px;margin-bottom:8px;background:var(--dark-3);border:1px solid ' + (selectedAgent === a.id ? 'var(--accent)' : 'var(--dark-border)') + ';border-radius:10px;cursor:pointer">' +
        '<div style="display:flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:' + escapeHtml(a.color) + '"></span>' +
        '<strong>' + escapeHtml(a.name) + '</strong><span style="color:var(--panel-text-faint);font-size:11px">' + escapeHtml(a.person || '') + '</span></div>' +
        '<div style="font-size:11px;color:var(--panel-text-dim);margin-top:4px">역할: ' + escapeHtml(a.role || '-') + ' · 담당 노드' + warn + '</div>' +
        '<div style="font-size:10px;color:var(--panel-text-faint);margin-top:2px">' + escapeHtml((a.machine || {}).spec || '') + ' · ' + escapeHtml((a.machine || {}).env || '') + ' · ' + escapeHtml((a.machine || {}).workspace || '') + '</div>' +
        '<div style="display:flex;gap:6px;margin-top:6px"><button class="tb-action ag-place" style="padding:3px 8px;font-size:11px;color:var(--accent);border-color:rgba(0,255,135,.3)">⬆ 배치</button>' +
        '<button class="tb-action ag-edit" style="padding:3px 8px;font-size:11px">수정</button>' +
        '<button class="tb-action ag-del" style="padding:3px 8px;font-size:11px;color:#ff5d5d">삭제</button></div></div>';
    }).join('');
  // 이벤트
  list.querySelectorAll('.agent-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.ag-edit') || e.target.closest('.ag-del') || e.target.closest('.ag-place')) return;
      selectedAgent = selectedAgent === el.dataset.id ? null : el.dataset.id;
      renderAgents(); renderCanvas();
    });
    el.querySelector('.ag-place').addEventListener('click', (e) => { e.stopPropagation(); placeAgentNode(el.dataset.id); });
    el.querySelector('.ag-edit').addEventListener('click', (e) => { e.stopPropagation(); showAgentForm(getAgent(el.dataset.id)); });
    el.querySelector('.ag-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('에이전트 삭제?')) return;
      agents = agents.filter(x => x.id !== el.dataset.id);
      saveAgentsLocal();
      if (serverOnline) await fetch(API_BASE + '/api/agents/' + el.dataset.id, { method: 'DELETE' }).catch(() => {});
      renderAgents(); renderCanvas();
    });
  });
}

// 에이전트 탭 토글
function toggleAgentsPanel() {
  const panel = document.getElementById('agents-panel');
  if (togglePanel(panel)) renderAgents();
}

// ═══ 에이전트 협업 고도화 모듈 ═══
