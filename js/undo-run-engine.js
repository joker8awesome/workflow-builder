// ── 2) Undo/Redo 스냅샷 스택 ──
let undoStack = [], redoStack = [];
const MAX_HISTORY = 50;
function snapshotState() {
  return JSON.stringify({ workflows: store.workflows, activeWorkflowId: store.activeWorkflowId });
}
function pushHistory() {
  undoStack.push(snapshotState());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
}
function undo() {
  if (undoStack.length === 0) { toast('되돌릴 작업 없음'); return; }
  redoStack.push(snapshotState());
  const prev = JSON.parse(undoStack.pop());
  store.workflows = prev.workflows; store.activeWorkflowId = prev.activeWorkflowId;
  afterHistory();
}
function redo() {
  if (redoStack.length === 0) { toast('다시 실행할 작업 없음'); return; }
  undoStack.push(snapshotState());
  const next = JSON.parse(redoStack.pop());
  store.workflows = next.workflows; store.activeWorkflowId = next.activeWorkflowId;
  afterHistory();
}
function afterHistory() {
  const wf = currentWorkflow();
  if (wf) document.getElementById('wf-name').value = wf.name;
  renderAll(); saveStore(true);
}

// ── 4) 노드 복제 ──
function duplicateNode(id) {
  const wf = currentWorkflow();
  if (!wf) return;
  const n = wf.nodes.find(x => x.id === id);
  if (!n) return;
  pushHistory();
  const copy = JSON.parse(JSON.stringify(n));
  copy.id = 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  copy.x += 24; copy.y += 24;
  wf.nodes.push(copy);
  selected = { type: 'node', id: copy.id };
  saveStore(); renderAll();
}

// ── 12) 다중 선택 ──
let multiSelect = new Set();
function toggleMulti(id) {
  if (multiSelect.has(id)) multiSelect.delete(id);
  else multiSelect.add(id);
  renderCanvas();
}
function clearMulti() { multiSelect.clear(); renderCanvas(); }
function deleteMulti() {
  const wf = currentWorkflow();
  if (!wf || multiSelect.size === 0) return;
  pushHistory();
  const ids = new Set(multiSelect);
  wf.nodes = wf.nodes.filter(n => !ids.has(n.id));
  wf.edges = wf.edges.filter(e => !ids.has(e.from) && !ids.has(e.to));
  multiSelect.clear();
  saveStore(true); renderAll();
}

// ── 6) 미니맵 + 줌/팬 ──
let zoom = 1, panX = 0, panY = 0;
const MINIMAP_W = 180, MINIMAP_H = 120;
function renderMinimap() {
  const mm = document.getElementById('minimap');
  const wf = currentWorkflow();
  if (!wf || wf.nodes.length === 0) { mm.style.display = 'none'; return; }
  mm.style.display = 'block';
  const xs = wf.nodes.map(n => n.x), ys = wf.nodes.map(n => n.y);
  const minX = Math.min(...xs) - 40, minY = Math.min(...ys) - 40;
  const maxX = Math.max(...xs) + 220, maxY = Math.max(...ys) + 80;
  const sx = MINIMAP_W / Math.max(maxX - minX, 1), sy = MINIMAP_H / Math.max(maxY - minY, 1);
  const s = Math.min(sx, sy);
  mm.innerHTML = '';
  wf.edges.forEach(e => {
    const from = wf.nodes.find(n => n.id === e.from), to = wf.nodes.find(n => n.id === e.to);
    if (!from || !to) return;
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', (from.x - minX) * s); l.setAttribute('y1', (from.y - minY) * s);
    l.setAttribute('x2', (to.x - minX) * s); l.setAttribute('y2', (to.y - minY) * s);
    l.setAttribute('stroke', '#00ff87'); l.setAttribute('stroke-width', '1');
    mm.appendChild(l);
  });
  wf.nodes.forEach(n => {
    const d = document.createElement('div');
    d.className = 'mm-node type-' + n.type;
    d.style.left = (n.x - minX) * s + 'px';
    d.style.top = (n.y - minY) * s + 'px';
    d.style.width = '8px'; d.style.height = '8px';
    mm.appendChild(d);
  });
}
function applyView() {
  const canvas = document.getElementById('canvas');
  canvas.style.transform = `scale(${zoom}) translate(${panX/zoom}px, ${panY/zoom}px)`;
  canvas.style.transformOrigin = '0 0';
  renderEdges(); renderMinimap();
}
document.getElementById('canvas-wrap').addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY < 0 ? 1.1 : 0.9;
  zoom = Math.max(0.3, Math.min(2.5, zoom * delta));
  applyView();
}, { passive: false });
// 팬: 중간 버튼 또는 빈 캔버스 드래그
let panning = null;
document.getElementById('canvas-wrap').addEventListener('mousedown', (e) => {
  if (e.button !== 1) return;
  e.preventDefault();
  panning = { x: e.clientX, y: e.clientY };
});
window.addEventListener('mousemove', (e) => {
  if (!panning) return;
  panX += e.clientX - panning.x; panY += e.clientY - panning.y;
  panning = { x: e.clientX, y: e.clientY };
  applyView();
});
window.addEventListener('mouseup', () => panning = null);

// ── 7) 자동 정렬 (위상 정렬 기반) ──
function autoAlign() {
  const wf = currentWorkflow();
  if (!wf || wf.nodes.length === 0) return;
  const indeg = {}; wf.nodes.forEach(n => indeg[n.id] = 0);
  wf.edges.forEach(e => { if (indeg[e.to] !== undefined) indeg[e.to]++; });
  const queue = wf.nodes.filter(n => (indeg[n.id] || 0) === 0);
  const order = [];
  while (queue.length) {
    const n = queue.shift(); order.push(n);
    wf.edges.forEach(e => {
      if (e.from === n.id && indeg[e.to] !== undefined) {
        indeg[e.to]--;
        if (indeg[e.to] === 0) queue.push(wf.nodes.find(x => x.id === e.to));
      }
    });
  }
  // 남은 노드(사이클)도 추가
  wf.nodes.forEach(n => { if (!order.includes(n)) order.push(n); });
  const COLS = 6, DX = 240, DY = 110;
  pushHistory();
  order.forEach((n, i) => {
    n.x = 60 + (i % COLS) * DX;
    n.y = 60 + Math.floor(i / COLS) * DY;
  });
  saveStore(); renderAll();
  toast('자동 정렬 완료 (' + order.length + '개 노드)');
}

// ── 1) 임시 엣지 미리보기 (고무줄) ──
let tempEdge = null;
function renderTempEdge() {
  let te = document.getElementById('temp-edge');
  if (!tempEdge) { if (te) te.remove(); return; }
  if (!te) {
    te = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    te.id = 'temp-edge';
    te.setAttribute('stroke', '#00ff87'); te.setAttribute('stroke-width', '2');
    te.setAttribute('stroke-dasharray', '6,4');
    te.setAttribute('marker-end', 'url(#arrow)');
    document.getElementById('edges').appendChild(te);
  }
  te.setAttribute('x1', tempEdge.x1); te.setAttribute('y1', tempEdge.y1);
  te.setAttribute('x2', tempEdge.x2); te.setAttribute('y2', tempEdge.y2);
}

// ── 5) 실행 미리보기 모드 ──
let runState = null;
function startRun() {
  const wf = currentWorkflow();
  if (!wf) return;
  const start = wf.nodes.find(n => n.type === 'start');
  if (!start) { toast('시작 노드가 없어 실행할 수 없습니다. start 노드를 추가한 뒤 다시 시도하세요'); return; }
  runState = { wfId: wf.id, currentId: start.id, visited: new Set() };
  renderRunPanel(); renderCanvas();
  document.getElementById('run-overlay').style.display = 'flex';
  toast('실행 미리보기 시작 — 시작 노드');
}
function runNext() {
  if (!runState) return;
  const wf = currentWorkflow();
  const cur = wf.nodes.find(n => n.id === runState.currentId);
  if (!cur) return;
  const outs = wf.edges.filter(e => e.from === cur.id).sort((a, b) => (a.label === 'Yes' ? -1 : 0) - (b.label === 'Yes' ? -1 : 0));
  if (outs.length === 0) { toast('종료 도달'); runState = null; renderRunPanel(); return; }
  const next = wf.nodes.find(n => n.id === outs[0].to);
  if (!next) return;
  runState.currentId = next.id; runState.visited.add(next.id);
  renderRunPanel(); renderCanvas();
  logRun(cur.label + ' → ' + next.label);
}
function runPrev() {
  // 단순 구현: 방문 순서 역추적은 복잡 — 이전 단계 표시용으로 visited 스택 사용
  if (!runState) return;
  const wf = currentWorkflow();
  const cur = wf.nodes.find(n => n.id === runState.currentId);
  if (!cur) return;
  const ins = wf.edges.filter(e => e.to === cur.id);
  if (ins.length === 0) { toast('시작 단계'); return; }
  const prev = wf.nodes.find(n => n.id === ins[0].from);
  if (!prev) return;
  runState.currentId = prev.id;
  renderRunPanel(); renderCanvas();
}
function renderRunPanel() {
  const el = document.getElementById('run-steps');
  if (!runState) { el.innerHTML = '<p style="color:var(--panel-text-dim)">실행 종료</p>'; return; }
  const wf = currentWorkflow();
  const cur = wf.nodes.find(n => n.id === runState.currentId);
  el.innerHTML = '<p style="color:var(--accent);font-weight:700">현재: ' + escapeHtml(cur ? cur.label : '?') + '</p>';
}

// ── 8) 미연결/사이클 경고 ──
function validateWorkflow() {
  const wf = currentWorkflow();
  if (!wf) return [];
  const warns = [];
  if (!wf.nodes.find(n => n.type === 'start')) warns.push('시작 노드 없음');
  if (!wf.nodes.find(n => n.type === 'end')) warns.push('종료 노드 없음');
  const connected = new Set();
  wf.edges.forEach(e => { connected.add(e.from); connected.add(e.to); });
  wf.nodes.forEach(n => { if (!connected.has(n.id)) warns.push('미연결 노드: ' + (n.label || n.id)); });
  // 사이클 탐지 (DFS)
  const visiting = new Set(), visited = new Set(); let hasCycle = false;
  function dfs(id) {
    if (visiting.has(id)) { hasCycle = true; return; }
    if (visited.has(id)) return;
    visiting.add(id);
    wf.edges.filter(e => e.from === id).forEach(e => dfs(e.to));
    visiting.delete(id); visited.add(id);
  }
  wf.nodes.forEach(n => { if (!visited.has(n.id)) dfs(n.id); });
  if (hasCycle) warns.push('사이클 감지 (무한 루프 위험)');
  return warns;
}
function showWarnings() {
  const warns = validateWorkflow();
  if (warns.length === 0) { toast('워크플로우 정상'); return; }
  warns.forEach(w => toast('⚠ ' + w));
}

// ── 13) 실행 엔진 (실제 단계 수행 시뮬레이션) ──
function runEngine() {
  const wf = currentWorkflow();
  if (!wf) return;
  const warns = validateWorkflow();
  if (warns.length > 0) { showWarnings(); return; }
  const start = wf.nodes.find(n => n.type === 'start');
  const path = [];
  const visit = (id) => {
    const n = wf.nodes.find(x => x.id === id);
    if (!n || path.includes(n)) return;
    path.push(n);
    const outs = wf.edges.filter(e => e.from === id);
    if (outs.length > 0) visit(outs[0].to);
  };
  if (start) visit(start.id);
  const summary = path.map(n => n.label).join(' → ');
  toast('실행 경로: ' + summary);
  logRun(summary);
}

// ── 3) 단축키 오버레이 ──
const SHORTCUTS = [
  ['Ctrl+Z', '실행 취소'], ['Ctrl+Shift+Z', '다시 실행'], ['Ctrl+D', '노드 복제'],
  ['Delete', '삭제'], ['?', '단축키 도움말'], ['Shift+클릭', '다중 선택'],
  ['휠', '줌'], ['중간버튼 드래그', '팬'], ['Enter(실행모드)', '다음 단계']
];
function showShortcutPanel() {
  const rows = SHORTCUTS.map(([k, v]) => '<div style="display:flex;justify-content:space-between;gap:16px;padding:6px 0;border-bottom:1px solid var(--panel-border)"><span style="color:var(--accent);font-weight:700">' + k + '</span><span style="color:var(--panel-text-dim)">' + v + '</span></div>').join('');
  toastHTML('<div style="min-width:260px"><strong style="display:block;margin-bottom:8px">단축키</strong>' + rows + '</div>', 6000);
}

// ── 토스트 ──
function toast(msg, ms = 2500) {
  toastHTML('<span>' + escapeHtml(msg) + '</span>', ms);
}
function toastHTML(html, ms = 2500) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = html;
  c.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

// === 키보드 삭제 ===
document.addEventListener('keydown', (e) => {
  // Undo / Redo
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  
    // 복사/붙여넣기
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) { copySelectedNodes(); }
    if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) { pasteNodes(); }
}
  // 복제
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    if (selected.type === 'node') duplicateNode(selected.id);
    return;
  }
  // 단축키 도움말
  if (e.key === '?') { e.preventDefault(); showShortcutPanel(); return; }
  // 삭제
  if ((e.key === 'Delete' || e.key === 'Backspace') && (selected.id || multiSelect.size > 0)) {
    e.preventDefault();
    if (multiSelect.size > 0) { deleteMulti(); return; }
    const wf = currentWorkflow();
    if (selected.type === 'node' || selected.type === 'edge') pushHistory();
    if (selected.type === 'node') {
      wf.nodes = wf.nodes.filter(n => n.id !== selected.id);
      wf.edges = wf.edges.filter(x => x.from !== selected.id && x.to !== selected.id);
    } else if (selected.type === 'edge') {
      wf.edges = wf.edges.filter(x => x.id !== selected.id);
    }
    selected = { type: null, id: null };
    saveStore(true); renderAll();
  }
});

// === 모바일 토글 ===
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// === 상단 워크플로우명 연동 ===
document.getElementById('wf-name').addEventListener('input', (e) => {
  const wf = currentWorkflow();
  if (wf) { wf.name = e.target.value; renderSidebar(); saveStore(); }
});

// === UX 버튼 이벤트 ===

document.getElementById('btn-align').addEventListener('click', autoAlign);
document.getElementById('btn-template').addEventListener('click', () => {
  loadExamples();
  const p = document.getElementById('template-panel');
  togglePanel(p);
});
document.getElementById('btn-share').addEventListener('click', shareWorkflow);
document.getElementById('btn-version').addEventListener('click', showVersions);
document.getElementById('run-next').addEventListener('click', runNext);
document.getElementById('run-prev').addEventListener('click', runPrev);
document.getElementById('run-close').addEventListener('click', () => {
  runState = null;
  document.getElementById('run-overlay').style.display = 'none';
  renderAll();
});

// 템플릿
document.querySelectorAll('.tpl-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tpl = btn.dataset.tpl;
    if (tpl === 'research' || tpl === 'review' || tpl === 'team') {
      loadTplFromServer(tpl === 'research' ? 'wf_tpl_research' : tpl === 'review' ? 'wf_tpl_review' : 'wf_tpl_team');
      return;
    }
    const wf = defaultWorkflow('템플릿: ' + (tpl === 'approval' ? '승인 프로세스' : tpl === 'content' ? '콘텐츠 제작' : '데이터 파이프라인'));
    if (tpl === 'approval') {
      wf.nodes = [
        { id: 'n_s', type: 'start', x: 60, y: 80, label: '요청 접수', desc: '', assignee: '', due: '', tags: [] },
        { id: 'n_a', type: 'process', x: 60, y: 220, label: '검토', desc: '', assignee: '', due: '', tags: [] },
        { id: 'n_d', type: 'decision', x: 60, y: 360, label: '승인?', desc: '', assignee: '', due: '', tags: [] },
        { id: 'n_y', type: 'process', x: 340, y: 320, label: '승인 처리', desc: '', assignee: '', due: '', tags: [] },
        { id: 'n_n', type: 'end', x: 340, y: 440, label: '반려', desc: '', assignee: '', due: '', tags: [] }
      ];
      wf.edges = [
        { id: 'e1', from: 'n_s', to: 'n_a', label: '' },
        { id: 'e2', from: 'n_a', to: 'n_d', label: '' },
        { id: 'e3', from: 'n_d', to: 'n_y', label: 'Yes' },
        { id: 'e4', from: 'n_d', to: 'n_n', label: 'No' }
      ];
    } else if (tpl === 'content') {
      wf.nodes = [
        { id: 'n_s', type: 'start', x: 60, y: 80, label: '브리프', desc: '', assignee: '', due: '', tags: [] },
        { id: 'n_r', type: 'process', x: 60, y: 220, label: '키워드 리서치', desc: '', assignee: '', due: '', tags: ['리서치'] },
        { id: 'n_w', type: 'process', x: 60, y: 360, label: '초안 작성', desc: '', assignee: '', due: '', tags: ['작성'] },
        { id: 'n_d', type: 'decision', x: 60, y: 500, label: '검수 통과?', desc: '', assignee: '', due: '', tags: [] },
        { id: 'n_p', type: 'process', x: 360, y: 460, label: '배포', desc: '', assignee: '', due: '', tags: ['배포'] },
        { id: 'n_e', type: 'end', x: 360, y: 580, label: '완료', desc: '', assignee: '', due: '', tags: [] }
      ];
      wf.edges = [
        { id: 'e1', from: 'n_s', to: 'n_r', label: '' },
        { id: 'e2', from: 'n_r', to: 'n_w', label: '' },
        { id: 'e3', from: 'n_w', to: 'n_d', label: '' },
        { id: 'e4', from: 'n_d', to: 'n_p', label: 'Yes' },
        { id: 'e5', from: 'n_d', to: 'n_w', label: 'No' },
        { id: 'e6', from: 'n_p', to: 'n_e', label: '' }
      ];
    } else {
      wf.nodes = [
        { id: 'n_s', type: 'start', x: 60, y: 80, label: '수집', desc: '', assignee: '', due: '', tags: ['수집'] },
        { id: 'n_c', type: 'process', x: 60, y: 220, label: '정규화', desc: '', assignee: '', due: '', tags: ['가공'] },
        { id: 'n_v', type: 'process', x: 60, y: 360, label: '검증', desc: '', assignee: '', due: '', tags: ['검증'] },
        { id: 'n_sv', type: 'process', x: 60, y: 500, label: '저장', desc: '', assignee: '', due: '', tags: ['DB'] },
        { id: 'n_e', type: 'end', x: 60, y: 640, label: '완료', desc: '', assignee: '', due: '', tags: [] }
      ];
      wf.edges = [
        { id: 'e1', from: 'n_s', to: 'n_c', label: '' },
        { id: 'e2', from: 'n_c', to: 'n_v', label: '' },
        { id: 'e3', from: 'n_v', to: 'n_sv', label: '' },
        { id: 'e4', from: 'n_sv', to: 'n_e', label: '' }
      ];
    }
    store.workflows.push(wf);
    store.activeWorkflowId = wf.id;
    document.getElementById('wf-name').value = wf.name;
    document.getElementById('template-panel').style.display = 'none';
    pushHistory();
    saveStore(true); renderAll();
    toast('템플릿 적용: ' + wf.name);
  });
});

// ── 9) 공유 링크 ──
async function shareWorkflow() {
  const wf = currentWorkflow();
  if (!wf) { toast('워크플로우 없음'); return; }
  if (!serverOnline) { toast('서버 미연결 — 공유 불가'); return; }
  try {
    await fetch(API_BASE + '/api/workflows/' + encodeURIComponent(wf.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: wf.name, data: { nodes: wf.nodes, edges: wf.edges } }),
    });
    const url = API_BASE + '/wf/' + encodeURIComponent(wf.id);
    navigator.clipboard?.writeText(url).catch(() => {});
    toastHTML('<span>공유 URL 복사됨<br><small style="color:var(--panel-text-dim)">' + escapeHtml(url) + '</small></span>', 4000);
  } catch (e) {
    toast('공유 실패: ' + e.message);
  }
}

// ── 10) 버전 히스토리 (로컬 스냅샷) ──
function showVersions() {
  const wf = currentWorkflow();
  if (!wf) { toast('워크플로우 없음'); return; }
  const key = LS_KEY + '_ver_' + wf.id;
  let versions = [];
  try { versions = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
  if (versions.length === 0) {
    // 현재 상태를 v1으로 저장
    versions = [{ t: new Date().toISOString(), data: JSON.parse(snapshotState()) }];
    localStorage.setItem(key, JSON.stringify(versions));
    toast('버전 v1 저장됨');
    return;
  }
  const rows = versions.map((v, i) => '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--panel-border)"><span>v' + (i+1) + ' · ' + new Date(v.t).toLocaleString() + '</span><button class="tb-action ver-restore" data-idx="' + i + '">복원</button></div>').join('');
  toastHTML('<div style="min-width:320px"><strong style="display:block;margin-bottom:8px">버전 이력 (' + versions.length + ')</strong>' + rows + '</div>', 6000);
  // 이벤트 위임 — 인라인 onclick 대신
  document.querySelectorAll('.toast .ver-restore').forEach(btn => {
    btn.addEventListener('click', () => restoreVersion(+btn.dataset.idx));
  });
}
function restoreVersion(idx) {
  const wf = currentWorkflow();
  if (!wf) return;
  const key = LS_KEY + '_ver_' + wf.id;
  const versions = JSON.parse(localStorage.getItem(key) || '[]');
  if (idx >= versions.length) return;
  const snap = versions[idx].data;
  pushHistory();
  const target = snap.workflows.find(w => w.id === wf.id);
  if (target) {
    wf.name = target.name; wf.nodes = target.nodes; wf.edges = target.edges;
  }
  saveStore(true); renderAll();
  const wf2 = currentWorkflow();
  if (wf2) document.getElementById('wf-name').value = wf2.name;
  toast('버전 v' + (idx+1) + ' 복원됨');
}

// ═══ 2차 고도화 모듈 (병렬 구현) ═══
