function setupSpacePan() {
  const cw = document.getElementById('canvas-wrap');
  if (!cw || cw.dataset.panReady) return;
  cw.dataset.panReady = '1';
  cw.addEventListener('mousedown', (e) => {
    if (e.code === 'Space' || e.which === 2 || e.button === 1) {
      e.preventDefault();
      panMode = true; panStart2 = { x: e.clientX, y: e.clientY, px: panX, py: panY };
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (!panMode || !panStart2) return;
    panX = panStart2.px + (e.clientX - panStart2.x);
    panY = panStart2.py + (e.clientY - panStart2.y);
    renderCanvas(); renderEdges();
  });
  window.addEventListener('mouseup', () => { panMode = false; panStart2 = null; });
}
function setupCanvasDrop() {
  const cw = document.getElementById('canvas-wrap');
  if (!cw || cw.dataset.dropReady) return;
  cw.dataset.dropReady = '1';
  cw.addEventListener('dragover', (e) => e.preventDefault());
  cw.addEventListener('drop', (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('text/plain');
    if (!type || !NODE_TYPES[type]) return;
    const rect = cw.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left - panX) / zoom - 90);
    const y = Math.round((e.clientY - rect.top - panY) / zoom - 26);
    addNodeAt(type, x, y);
  });
}
function addNodeAt(type, x, y) {
  const wf = currentWorkflow();
  if (!wf || !NODE_TYPES[type]) return;
  const id = 'n_' + Date.now().toString(36);
  wf.nodes.push({ id, type, x, y, label: NODE_TYPES[type].label, desc: '', assignee: '', due: '', tags: [], status: '대기' });
  pushHistory();
  saveStore(); renderAll();
  selected = { type: 'node', id };
  renderInspector();
  toast('➕ ' + NODE_TYPES[type].label + ' 노드 추가');
}
function renderCanvas() {
  indexCounter = {};  // 노드 순번 초기화
  removeNodeTooltip();  // 잔상 툴팁 제거
  const canvas = document.getElementById('canvas');
  canvas.innerHTML = '';
  renderEdges();
  const wf = currentWorkflow();
  if (!wf) return;
  wf.nodes.forEach(n => {
    if (!isInViewport(n)) return;  // 가상화: 뷰포트 밖 노드 생략
    const isSel = selected.type === 'node' && selected.id === n.id;
    const isMulti = multiSelect.has(n.id);
    const isRun = runState && runState.currentId === n.id;
    if (isRun) { setTimeout(() => { const el2 = document.querySelector('#canvas .node[data-id="' + n.id + '"]'); if (el2) { el2.style.boxShadow = '0 0 0 3px var(--accent)'; setTimeout(() => { el2.style.boxShadow = ''; }, 700); } }, 50); }
    const isVisited = runState && runState.visited && runState.visited.has(n.id);
    const el = document.createElement('div');
    el.className = 'node type-' + n.type
      + (isSel ? ' sel' : '')
      + (isMulti ? ' multi' : '')
      + (isRun ? ' run-current' : '')
      + (isVisited ? ' run-visited' : '');
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    el.dataset.id = n.id;
    if (n.agentId) el.dataset.agent = n.agentId;
    el.setAttribute('tabindex', '0');
    const agent = getAgent(n.agentId);
    const agentBadge = agent
      ? `<span class="agent-badge" style="background:${escapeHtml(agent.color)}">${escapeHtml(agent.name)}</span>`
      : `<span class="agent-badge unassigned" title="미할당">미할당</span>`;
    el.innerHTML = `<span class="nicon" style="background:${NODE_TYPES[n.type].color}">${NODE_TYPES[n.type].svg}</span>
      <span class="nlabel">${escapeHtml(n.label || NODE_TYPES[n.type].label)}</span>
      <span class="nindex">${nIndex(n)}</span>
      ${agentBadge}
      ${nodeStatusBadge(n)}
      ${renderConfidence(n)}
      ${pipelineStatusBadge(n)}
      ${agentHandoffInfo(n)}
      ${blockerBadge(n)}
      ${resultPreviewBadge(n)}
      ${n.collapsed ? '<span style="font-size:9px;color:var(--panel-text-faint)">접힘</span>' : ''}
      ${statusPill(n)}
      ${validationBadge(n, wf)}
      ${edgeStatusBadge(n, wf)}
      ${n.agentId ? agentLiveBadge(n.agentId) : ''}
      <span class="nport" data-port="out"></span>
      ${n.locked ? '<span class="lock-badge">🔒</span>' : ''}`;
    // 선택된 에이전트의 담당 노드 강조
    if (selectedAgent && n.agentId === selectedAgent) el.classList.add('agent-highlight');
    el.addEventListener('mouseenter', (e) => {
      removeNodeTooltip();  // 기존 툴팁 제거 후 새로 생성 (중복 방지)
      const tt = document.createElement('div');
      tt.id = 'node-tooltip';
      tt.style.cssText = 'position:fixed;z-index:120;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--panel-text);pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,.3);max-width:260px;white-space:normal';
      tt.innerHTML = nodeTooltip(n);
      document.body.appendChild(tt);
      const r = el.getBoundingClientRect();
      tt.style.left = Math.min(r.left + r.width + 8, window.innerWidth - 220) + 'px';
      tt.style.top = Math.max(8, r.top - 10) + 'px';
    });
    el.addEventListener('mouseleave', () => {
      const tt = document.getElementById('node-tooltip');
      if (tt) tt.remove();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selected = { type: 'node', id: n.id }; renderAll(); }
    });
    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('.nport')) return;  // 포트 드래그는 연결용 — 노드 이동 금지
      startDrag(e, n);
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('.node-status-pill')) { cycleNodeStatus(n); return; }
      if (e.shiftKey) { toggleMulti(n.id); }
      else if (multiSelect.size > 0) { clearMulti(); selectNode(n.id); }
      else { selectNode(n.id); }
    });
    el.addEventListener('dblclick', (e) => { e.stopPropagation(); enableInlineEdit(n); });
    canvas.appendChild(el);
  renderFloatingBar();
    attachNodeTouch(n);  // 터치 드래그/연결/제스처 연결
  });
  renderGroups();
}

function selectNode(id) {
  selected = { type: 'node', id };
  renderAll();
}

// 스냅 가이드 — 드래그 중 주변 노드와 정렬 안내선
const GUIDE_TOL = 8;
function clearSnapGuides() {
  document.querySelectorAll('.snap-guide').forEach(g => g.remove());
}
function renderSnapGuides(dragId) {
  clearSnapGuides();
  const wf = currentWorkflow();
  const n = wf.nodes.find(x => x.id === dragId);
  if (!n) return;
  const canvas = document.getElementById('canvas');
  const cr = canvas.getBoundingClientRect();
  const cx = cr.left + n.x + 90 + panX, cy = cr.top + n.y + 26 + panY;
  const guide = (x1, y1, x2, y2, horiz) => {
    const el = document.createElement('div');
    el.className = 'snap-guide';
    el.style.cssText = 'position:fixed;z-index:60;background:var(--accent);box-shadow:0 0 4px var(--accent);' +
      (horiz ? 'left:' + x1 + 'px;top:' + y1 + 'px;width:' + (x2 - x1) + 'px;height:1px' : 'top:' + y1 + 'px;left:' + x1 + 'px;height:' + (y2 - y1) + 'px;width:1px');
    document.body.appendChild(el);
  };
  wf.nodes.forEach(o => {
    if (o.id === dragId) return;
    const ox = cr.left + o.x + 90 + panX, oy = cr.top + o.y + 26 + panY;
    if (Math.abs(ox - cx) < GUIDE_TOL) guide(Math.min(ox, cx), Math.min(oy, cy), Math.max(ox, cx), Math.max(oy, cy), false);
    if (Math.abs(oy - cy) < GUIDE_TOL) guide(Math.min(ox, cx), Math.min(oy, cy), Math.max(ox, cx), Math.max(oy, cy), true);
  });
}
function startDrag(e, node) {
  e.preventDefault();
  removeNodeTooltip();  // 드래그 시작 시 툴팁 제거
  if (lockMode || node.locked) { toast('🔒 잠긴 노드'); return; }
  if (e.shiftKey) {
    toggleMulti(node.id);
    return;
  }
  selected = { type: 'node', id: node.id };
  // 3: 드래그 고스트
  const dragEl = e.target.closest('.node');
  if (dragEl) dragEl.classList.add('drag-ghost');
  const startX = e.clientX, startY = e.clientY;
  const origX = node.x, origY = node.y;
  // 다중 선택된 다른 노드들도 함께 이동
  const group = new Set(multiSelect);
  if (!group.has(node.id)) group.add(node.id);
  const orig = {};
  group.forEach(id => {
    const n = currentWorkflow().nodes.find(x => x.id === id);
    if (n) orig[id] = { x: n.x, y: n.y };
  });
  function move(ev) {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    group.forEach(id => {
      const n = currentWorkflow().nodes.find(x => x.id === id);
      if (n && orig[id]) {
        n.x = snapValue(orig[id].x + dx); n.y = snapValue(orig[id].y + dy);
        const el = document.querySelector(`#canvas .node[data-id="${id}"]`);
        if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
      }
    });
    renderEdgesThrottled();
    renderSnapGuides(node.id);
  }
  function up() {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    removeNodeTooltip();  // 드래그 종료 시 툴팁 제거
    clearSnapGuides();
    if (dragEl) dragEl.classList.remove('drag-ghost');
    if (node.x !== origX || node.y !== origY) pushHistory();
    saveStore();
    renderEdges();
    // 3: 착지 바운스
    if (dragEl) {
      dragEl.classList.add('drop-bounce');
      setTimeout(() => dragEl.classList.remove('drop-bounce'), 300);
    }
  }
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

// === EdgeLayer ===
// 연결 기록 — localStorage에 연결/해제 이벤트 저장
function logEdgeEvent(type, fromId, toId, label) {
  try {
    const key = LS_KEY + '_edgelog';
    const log = JSON.parse(localStorage.getItem(key) || '[]');
    const wf = currentWorkflow();
    const fromN = wf.nodes.find(n => n.id === fromId);
    const toN = wf.nodes.find(n => n.id === toId);
    log.push({ type, from: fromN ? fromN.label : fromId, to: toN ? toN.label : toId, label: label || '', ts: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(log.slice(-100)));
  } catch (e) {}
}
// 엣지 플래시 — 방금 연결된 선 강조
function flashEdge(edgeId) {
  const svg = document.getElementById('edges');
  const path = svg ? svg.querySelector('[data-id="' + edgeId + '"]') : null;
  if (!path) return;
  path.classList.add('edge-flash');
  setTimeout(() => path.classList.remove('edge-flash'), 1200);
}
// 노드 연결 상태 — 연결된 엣지 수 + 미연결 경고
function edgeStatusBadge(n, wf) {
  const inCnt = wf.edges.filter(e => e.to === n.id).length;
  const outCnt = wf.edges.filter(e => e.from === n.id).length;
  if (n.type === 'start' || n.type === 'end') return '';
  if (inCnt === 0 && outCnt === 0) return '<span class="edge-warn" title="미연결 노드">⚠ 미연결</span>';
  return '<span class="edge-ok" title="연결됨 (' + (inCnt + outCnt) + '개)">🔗 ' + (inCnt + outCnt) + '</span>';
}
function renderEdges() {
  const svg = document.getElementById('edges');
  // defs(marker)는 유지하고 line/text만 제거 — 화살표 보존
  const defs = svg.querySelector('defs');
  svg.innerHTML = '';
  if (defs) svg.appendChild(defs);
  const wf = currentWorkflow();
  if (!wf) return;
  // O(1) 노드 조회용 Map — 대규모 워크플로우 성능
  const nodeMap = new Map(wf.nodes.map(n => [n.id, n]));
  wf.edges.forEach(e => {
    const from = nodeMap.get(e.from);
    const to = nodeMap.get(e.to);
    if (!from || !to) { console.warn('orphan edge', e.id); return; }
    const x1 = from.x + 180, y1 = from.y + 26;
    const x2 = to.x, y2 = to.y + 26;  // 목표 노드 왼쪽 끝으로 (노드 관통 방지)
    const isActive = runState && (runState.currentId === e.from || runState.currentId === e.to);
    const isFlow = runState && runState.running && (runState.currentId === e.from);
    // 베지어 곡선 엣지
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', edgePath(x1, y1, x2, y2));
    path.setAttribute('stroke', isActive ? '#00ff87' : '#9fb3c8');
    path.setAttribute('stroke-width', isActive ? '3.5' : '3');
    if (isFlow) path.classList.add('edge-flow');
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', isActive ? 'url(#arrow)' : 'url(#arrow-dim)');
    path.dataset.id = e.id;
    path.style.cursor = 'pointer';
    path.addEventListener('click', (ev) => { ev.stopPropagation(); selected = { type: 'edge', id: e.id }; renderAll(); });
    svg.appendChild(path);
    if (e.label) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', (x1+x2)/2); t.setAttribute('y', (y1+y2)/2 - 6);
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '12');
      t.setAttribute('fill', isActive ? '#00ff87' : '#d29922');
      t.setAttribute('font-weight', 'bold');
      t.textContent = e.label;
      svg.appendChild(t);
    }
  });
  renderTempEdge();
  renderHandoffs();
}

// 연결 드래그: 노드의 out 핸들에서 시작
let connectFrom = null;
document.addEventListener('mousedown', (e) => {
  const port = e.target.closest('.nport');
  if (!port) return;
  e.preventDefault(); e.stopPropagation();
  const fromId = port.closest('.node').dataset.id;
  connectFrom = fromId;
  function up(ev) {
    const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.node');
    if (target && target.dataset.id !== fromId) {
      const wf = currentWorkflow();
      const existing = wf.edges.filter(e2 => e2.from === fromId);
      const isDecision = wf.nodes.find(n => n.id === fromId)?.type === 'decision';
      const label = isDecision ? (existing.length === 0 ? 'Yes' : 'No') : '';
      wf.edges.push({ id: 'e_' + Date.now().toString(36), from: fromId, to: target.dataset.id, label });
      pushHistory();
      saveStore(); renderAll();
      // 연결 성공 피드백 + 기록
      const fromN = wf.nodes.find(n => n.id === fromId);
      const toN = wf.nodes.find(n => n.id === target.dataset.id);
      toast('🔗 연결됨: ' + (fromN ? fromN.label : fromId) + ' → ' + (toN ? toN.label : target.dataset.id) + (label ? ' [' + label + ']' : ''));
      logEdgeEvent('connect', fromId, target.dataset.id, label);
      flashEdge(wf.edges[wf.edges.length - 1].id);
    }
    connectFrom = null;
    tempEdge = null; renderTempEdge();
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  }
  function move(ev) {
    // 고무줄 임시 엣지 — 캔버스 좌표계로 변환 (줌/팬 반영)
    const from = currentWorkflow().nodes.find(n => n.id === fromId);
    if (from) {
      const rect = document.getElementById('canvas-wrap').getBoundingClientRect();
      tempEdge = {
        x1: from.x + 180, y1: from.y + 26,
        x2: (ev.clientX - rect.left - panX) / zoom,
        y2: (ev.clientY - rect.top - panY) / zoom
      };
      renderTempEdge();
    }
  }
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

// === Inspector ===
function renderInspector() {
  const body = document.getElementById('inspector-body');
  body.innerHTML = '';
  const wf = currentWorkflow();
  if (!wf) { body.innerHTML = '<p>워크플로우 없음</p>'; return; }
  if (selected.type === 'node') {
    const n = wf.nodes.find(x => x.id === selected.id);
    if (!n) return;
    body.innerHTML = `
      <label>이름</label><input id="f-label" value="${escapeHtml(n.label)}">
      <label>설명</label><textarea id="f-desc">${escapeHtml(n.desc)}</textarea>
      <label>담당자</label><input id="f-assignee" value="${escapeHtml(n.assignee)}">
      ${n.agentId ? `<button id="cred-issue" class="tb-action" style="width:100%;margin-top:6px">🔑 자격증명 발급</button>
      <button id="cmd-send" class="tb-action" style="width:100%;margin-top:6px">📡 에이전트에게 명령 보내기</button>` : ''}
      <label>기한</label><input id="f-due" type="date" value="${escapeHtml(n.due)}">
      <label>태그 (콤마 구분)</label><input id="f-tags" value="${escapeHtml((n.tags||[]).join(', '))}">
      ${n.type === 'connector' ? `
      <label>커넥터 타입</label>
      <select id="f-conn-type" style="width:100%;padding:8px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text);font-size:13px">
        <option value="csv"${n.connector_type === 'csv' ? ' selected' : ''}>CSV</option>
        <option value="json"${n.connector_type === 'json' ? ' selected' : ''}>JSON</option>
        <option value="api"${n.connector_type === 'api' ? ' selected' : ''}>API URL</option>
        <option value="db"${n.connector_type === 'db' ? ' selected' : ''}>DB 쿼리</option>
      </select>
      <label>설정 (CSV/JSON 텍스트, API URL, 또는 SQL)</label>
      <textarea id="f-conn-config" rows="3" placeholder="데이터 또는 URL 또는 SELECT ..." style="width:100%;padding:8px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text);font-size:12px">${escapeHtml((n.connector_config && (n.connector_config.text || n.connector_config.url || n.connector_config.query)) || '')}</textarea>
      ` : ''}
      <details id="insp-advanced" style="margin-top:8px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;padding:8px">
        <summary style="font-size:12px;color:var(--accent);cursor:pointer">⚙️ 고급 설정</summary>
        <div style="margin-top:6px">
      <label>실행 액션 (스크립트/telegram/http)</label><input id="f-action" value="${escapeHtml(n.action || '')}" placeholder="예: echo hello 또는 telegram">
      ${n.type === 'decision' ? '<label>LLM 판단 프롬프트</label><textarea id="f-llm">' + escapeHtml(n.llm_prompt || '') + '</textarea><label>모델 라우팅</label><select id="f-model" style="width:100%;padding:8px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text);font-size:13px"><option value="">자동</option><option value="cheap"' + (n.model === 'cheap' ? ' selected' : '') + '>저비용</option><option value="smart"' + (n.model === 'smart' ? ' selected' : '') + '>고성능</option></select>' +
        '<label>자율성 스펙트럼</label><select id="f-auto" style="width:100%;padding:8px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text);font-size:13px">' +
        '<option value="auto"' + (n.autonomy === 'auto' || !n.autonomy ? ' selected' : '') + '>전체 자율</option>' +
        '<option value="supervised"' + (n.autonomy === 'supervised' ? ' selected' : '') + '>감독 자율</option>' +
        '<option value="approval"' + (n.autonomy === 'approval' ? ' selected' : '') + '>승인 필수</option></select>' : ''}
      ${n.type === 'decision' ? '<label>조건식 (LLM보다 우선)</label><input id="f-cond2" value="' + escapeHtml(n.condition || '') + '">' : ''}
      <label>재시도 횟수</label><input id="f-retry" type="number" min="0" max="5" value="${n.retry || 0}">
      <label>출력 길이 제한 (max_tokens)</label>
      <select id="f-maxtok" style="width:100%;padding:8px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text);font-size:13px">
        <option value="">자동 (기본)</option>
        <option value="50"' + (n.max_tokens == 50 ? ' selected' : '') + '>간결 (50)</option>
        <option value="200"' + (n.max_tokens == 200 ? ' selected' : '') + '>표준 (200)</option>
        <option value="800"' + (n.max_tokens == 800 ? ' selected' : '') + '>상세 (800)</option>
      </select>
      <label>폴백 노드 ID</label><input id="f-fallback" value="${escapeHtml(n.fallback_to || '')}" placeholder="n_xxxx">
      ${n.type === 'approval' ? '<label>승인 체크리스트 (콤마 구분)</label><input id="f-acl" value="' + escapeHtml((n.approval_checklist || []).join(', ')) + '" placeholder="의도, 출처, 영향, 롤백">' : ''}
      <label>작업 상태</label>
      <select id="f-status" style="width:100%;padding:8px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text);font-size:13px">
        ${WORK_STATUS.map(s => '<option' + (n.status === s ? ' selected' : '') + '>' + s + '</option>').join('')}
      </select>
      <label>인계 메시지 (다음 에이전트에게)</label><input id="f-handoff" value="${escapeHtml(n.handoff_msg || '')}" placeholder="다음 에이전트에게 전달할 내용">
      <label>블로커</label><input id="f-blocked" type="checkbox" ${n.blocked ? 'checked' : ''}>
      <label>노드 색상</label><input id="f-color" type="color" value="${n.color || NODE_TYPES[n.type].color}">
      <label>담당 에이전트</label>
      <select id="f-agent" style="width:100%;padding:8px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text);font-size:13px">
        <option value="">미할당</option>
        ${agents.map(a => '<option value="' + escapeHtml(a.id) + '"' + (n.agentId === a.id ? ' selected' : '') + '>' + escapeHtml(a.name) + '</option>').join('')}
      </select>
      <label>댓글</label><textarea id="f-comment" placeholder="댓글 입력..."></textarea>
      <button id="f-add-comment" style="margin-top:4px">댓글 추가</button>
      <div id="f-comment-list" style="font-size:11px;color:var(--panel-text-dim)"></div>
        </div>
      </details>
      <button id="f-del-node">노드 삭제</button>`;
    ['label','desc','assignee','due'].forEach(k => {
      document.getElementById('f-' + k).addEventListener('input', (e) => { n[k] = e.target.value; saveStore(); });
    });
    document.getElementById('f-tags').addEventListener('input', (e) => {
      n.tags = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
      saveStore();
    });
    document.getElementById('f-action').addEventListener('input', (e) => { n.action = e.target.value; saveStore(); });
    document.getElementById('f-agent').addEventListener('change', (e) => {
      n.agentId = e.target.value || undefined;
      saveStore(); renderCanvas(); renderAgents();
    });
    const fLlm = document.getElementById('f-llm');
    if (fLlm) fLlm.addEventListener('input', (e) => { n.llm_prompt = e.target.value; saveStore(); });
    const fModel = document.getElementById('f-model');
    if (fModel) fModel.addEventListener('change', (e) => { n.model = e.target.value; saveStore(); });
    const fAuto = document.getElementById('f-auto');
    if (fAuto) fAuto.addEventListener('change', (e) => { n.autonomy = e.target.value; saveStore(); });
    const fCond2 = document.getElementById('f-cond2');
    if (fCond2) fCond2.addEventListener('input', (e) => { n.condition = e.target.value; saveStore(); });
    document.getElementById('f-retry').addEventListener('input', (e) => { n.retry = Math.max(0, Math.min(5, +e.target.value || 0)); saveStore(); });
    // 상태 드롭다운 이벤트 (Inspector)
    const fStatus = document.getElementById('f-status');
    if (fStatus) fStatus.addEventListener('change', (e) => {
      n.status = e.target.value;
      saveStore(); renderCanvas();
    });
    const fConnType = document.getElementById('f-conn-type');
    if (fConnType) {
      fConnType.addEventListener('change', (e) => { n.connector_type = e.target.value; saveStore(); });
      const fConnCfg = document.getElementById('f-conn-config');
      if (fConnCfg) fConnCfg.addEventListener('change', (e) => {
        const v = e.target.value;
        if (n.connector_type === 'api') n.connector_config = { url: v };
        else n.connector_config = { ...(n.connector_config || {}), text: v };
        saveStore();
      });
    }
    // 자격증명 발급 버튼 — 한 번만 표시되는 토큰
    const credBtn = document.getElementById('cred-issue');
    if (credBtn) credBtn.addEventListener('click', () => {
      if (!selected || selected.type !== 'node') return;
      const wf = currentWorkflow();
      const n = wf.nodes.find(x => x.id === selected.id);
      const agentId = n && n.agentId;
      if (!agentId) { toast('먼저 담당 에이전트를 선택하세요'); return; }
      openCredentialModal(agentId);
    });
    const cmdBtn = document.getElementById('cmd-send');
    if (cmdBtn) cmdBtn.addEventListener('click', () => {
      const agentId = n.agentId;
      if (agentId) promptAgentCommand(agentId);
    });
    const fMax = document.getElementById('f-maxtok');
    if (fMax) fMax.addEventListener('change', (e) => { n.max_tokens = e.target.value ? +e.target.value : undefined; saveStore(); });
    document.getElementById('f-fallback').addEventListener('input', (e) => { n.fallback_to = e.target.value; saveStore(); });
    document.getElementById('f-status').addEventListener('change', (e) => { n.status = e.target.value; saveStore(); renderCanvas(); renderAgentDashboard(); });
    const fAcl = document.getElementById('f-acl');
    if (fAcl) fAcl.addEventListener('input', (e) => {
      n.approval_checklist = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
      saveStore();
    });
    document.getElementById('f-handoff').addEventListener('input', (e) => { n.handoff_msg = e.target.value; saveStore(); });
    document.getElementById('f-blocked').addEventListener('change', (e) => { n.blocked = e.target.checked; saveStore(); renderCanvas(); renderAgentDashboard(); });
    document.getElementById('f-color').addEventListener('input', (e) => { n.color = e.target.value; saveStore(); renderCanvas(); });
    document.getElementById('f-add-comment').addEventListener('click', () => {
      const txt = document.getElementById('f-comment').value.trim();
      if (txt) { addComment(n.id, txt); document.getElementById('f-comment').value = ''; }
    });
    // 기존 댓글 표시
    const cList = document.getElementById('f-comment-list');
    if (cList && window.__comments) {
      const mine = window.__comments.filter(c => c.node_id === n.id);
      cList.innerHTML = mine.length ? mine.map(c => '<div style="padding:4px 0;border-bottom:1px solid var(--dark-border)"><strong>' + escapeHtml(c.author) + '</strong>: ' + escapeHtml(c.text) + '</div>').join('') : '<span>댓글 없음</span>';
    }
    document.getElementById('f-del-node').addEventListener('click', () => {
      wf.nodes = wf.nodes.filter(x => x.id !== n.id);
      wf.edges = wf.edges.filter(x => x.from !== n.id && x.to !== n.id);
      selected = { type: null, id: null };
      saveStore(true); renderAll();
    });
  } else if (selected.type === 'edge') {
    const e = wf.edges.find(x => x.id === selected.id);
    if (!e) return;
    body.innerHTML = `<label>라벨 (분기)</label><input id="f-ec-label" value="${escapeHtml(e.label||'')}">
      <button id="f-del-edge">연결 삭제</button>`;
    document.getElementById('f-ec-label').addEventListener('input', (ev) => { e.label = ev.target.value; saveStore(); renderEdges(); });
    document.getElementById('f-del-edge').addEventListener('click', () => {
      wf.edges = wf.edges.filter(x => x.id !== e.id);
      selected = { type: null, id: null };
      saveStore(true); renderAll();
    });
  } else {
    body.innerHTML = `<label>워크플로우 이름</label><input id="f-wf-name" value="${escapeHtml(wf.name)}">
      <label>자동 실행 (자연어)</label>
      <div style="display:flex;gap:6px">
        <input id="f-sched-nl" placeholder="예: 매일 9시" value="" style="flex:1;padding:8px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text);font-size:12px">
        <button id="f-sched-parse" class="tb-action" style="padding:4px 10px;font-size:11px">변환</button>
      </div>
      <label>크론</label><input id="f-sched" value="${escapeHtml(wf.schedule || '')}" placeholder="예: 0 9 * * *">
      <button id="f-sched-save" class="tb-action" style="width:100%;margin-top:4px;font-size:11px;box-sizing:border-box">💾 스케줄 저장</button>`;
    const schedNl = document.getElementById('f-sched-nl');
    const schedParse = document.getElementById('f-sched-parse');
    const schedInput = document.getElementById('f-sched');
    if (schedNl && schedParse) {
      schedParse.addEventListener('click', async () => {
        const text = schedNl.value.trim();
        if (!text) { toast('자연어 입력 필요'); return; }
        const r = await fetch(API_BASE + '/api/schedule/parse', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
        }).catch(() => null);
        if (r && r.ok) {
          const j = await r.json();
          if (j.success) { schedInput.value = j.cron; toast('크론: ' + j.cron); }
          else toast(j.error || '변환 실패');
        }
      });
      const schedSave = document.getElementById('f-sched-save');
      schedSave.addEventListener('click', async () => {
        const cron = schedInput.value.trim();
        await fetch(API_BASE + '/api/workflows/' + wf.id + '/schedule', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cron, trigger_type: cron ? 'cron' : 'manual' }),
        }).catch(() => {});
        wf.schedule = cron; saveStore();
        toast(cron ? '스케줄 저장됨 (' + cron + ')' : '스케줄 해제');
      });
    }
    document.getElementById('f-wf-name').addEventListener('input', (e) => {
      wf.name = e.target.value;
      document.getElementById('wf-name').value = wf.name;
      renderSidebar(); saveStore();
    });
  }
}

// === 컨텍스트 메뉴 (노드 추가) ===
const ctxMenu = document.getElementById('ctx-menu');
const canvasEl = document.getElementById('canvas');
canvasEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (e.target.closest('.node')) return;
  ctxMenu.style.display = 'block';
  ctxMenu.style.left = e.clientX + 'px';
  ctxMenu.style.top = e.clientY + 'px';
  ctxMenu.dataset.x = e.offsetX;
  ctxMenu.dataset.y = e.offsetY;
});
document.addEventListener('click', () => ctxMenu.style.display = 'none');
Object.keys(NODE_TYPES).forEach(t => {
  const btn = document.createElement('button');
  btn.innerHTML = NODE_TYPES[t].svg + ' ' + NODE_TYPES[t].label;
  btn.style.cssText = 'display:flex;align-items:center;gap:8px';
  btn.addEventListener('click', () => {
    const wf = currentWorkflow();
    pushHistory();  // 추가 전 스냅샷
    wf.nodes.push({
      id: 'n_' + Date.now().toString(36), type: t,
      x: +ctxMenu.dataset.x - 80, y: +ctxMenu.dataset.y - 20,
      label: NODE_TYPES[t].label, desc: '', assignee: '', due: '', tags: []
    });
    ctxMenu.style.display = 'none';
    saveStore(); renderAll();
  });
  ctxMenu.appendChild(btn);
});

document.getElementById('canvas').addEventListener('click', () => {
  selected = { type: null, id: null };
  renderAll();
});

// === 내보내기 / 가져오기 ===
document.getElementById('btn-export').addEventListener('click', () => {
  const payload = { app: 'workflow-builder', version: 1, exported_at: new Date().toISOString(), data: store };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const wf = currentWorkflow();
  const fname = (wf && wf.name ? wf.name.replace(/[^\w가-힣]+/g, '_') : 'workflow') + '_' + new Date().toISOString().slice(0,10) + '.json';
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
});

document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('file-import').click();
});
document.getElementById('file-import').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      const imported = parsed && parsed.data && parsed.data.workflows ? parsed.data : parsed;
      if (!Array.isArray(imported.workflows) || imported.workflows.length === 0) {
        throw new Error('워크플로우 데이터 없음');
      }
      // ID 충돌 방지: 가져온 데이터의 ID를 새로 부여
      const idMap = {};
      imported.workflows.forEach(w => {
        const newWfId = 'wf_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
        idMap[w.id] = newWfId;
        w.id = newWfId;
        w.nodes.forEach(n => {
          const newN = 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
          idMap[n.id] = newN; n.id = newN;
        });
        w.edges.forEach(ed => {
          ed.id = 'e_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
          ed.from = idMap[ed.from] || ed.from;
          ed.to = idMap[ed.to] || ed.to;
        });
      });
      store.workflows = store.workflows.concat(imported.workflows);
      store.activeWorkflowId = imported.workflows[imported.workflows.length-1].id;
      saveStore(true); renderAll();
      const wfc = currentWorkflow();
      if (wfc) document.getElementById('wf-name').value = wfc.name;
      alert('가져오기 완료: ' + imported.workflows.length + '개 워크플로우 추가');
    } catch (err) {
      alert('가져오기 실패: ' + err.message);
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

// ═══ UX 고도화 모듈 (병렬 구현) ═══
