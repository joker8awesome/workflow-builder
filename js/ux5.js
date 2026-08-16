// 1. 실행 스크립트 연동 — 노드 action이 script면 서버에서 실제 실행
async function runNodeScript(node) {
  if (!node.action || !serverOnline) return { ok: true, simulated: true };
  try {
    const r = await fetch(API_BASE + '/api/exec', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: node.action }),
    });
    const j = await r.json();
    return j.success ? { ok: true, output: j.output } : { ok: false, error: j.error };
  } catch (e) { return { ok: false, error: e.message }; }
}

// 4. 실행 결과 저장 (서버)
function saveRunResult(wfId, nodeId, result) {
  if (!serverOnline) return;
  fetch(API_BASE + '/api/workflows/' + encodeURIComponent(wfId) + '/results', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_id: nodeId, result }),
  }).catch(() => {});
}

// 조건식 컨텍스트에 이전 실행 결과 주입
function buildExecCtx(wfId) {
  const ctx = { score: 85, count: 3, status: 'ok' };
  const stored = execState.results || {};
  Object.keys(stored).forEach(k => { ctx['node_' + k] = stored[k]; });
  return ctx;
}

// 8. 커서 공유 — WebSocket으로 커서 위치 브로드캐스트
let cursorTimer = null;
function broadcastCursor() {
  if (!ws || ws.readyState !== 1) return;
  const rect = document.getElementById('canvas-wrap').getBoundingClientRect();
  ws.send(JSON.stringify({ type: 'cursor', x: (lastMX - rect.left) / zoom, y: (lastMY - rect.top) / zoom }));
}
let lastMX = 0, lastMY = 0;
document.getElementById('canvas-wrap').addEventListener('mousemove', (e) => {
  lastMX = e.clientX; lastMY = e.clientY;
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(broadcastCursor, 150);
});
// 다른 사용자 커서 표시 (patchWSHandler에 통합 예정)

// 9. 노드 댓글
async function loadComments() {
  const wf = currentWorkflow();
  if (!wf || !serverOnline) return;
  try {
    const r = await fetch(API_BASE + '/api/workflows/' + encodeURIComponent(wf.id) + '/comments');
    const j = await r.json();
    if (j.success) window.__comments = j.comments || [];
  } catch (e) {}
}
async function addComment(nodeId, text) {
  const wf = currentWorkflow();
  if (!wf || !serverOnline) { toast('서버 미연결'); return; }
  try {
    await fetch(API_BASE + '/api/workflows/' + encodeURIComponent(wf.id) + '/comments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: nodeId, author: '나', text }),
    });
    toast('댓글 추가됨');
    loadComments();
  } catch (e) { toast('댓글 실패'); }
}

// 11. 키보드 전용 모드 — 화살표로 노드 이동
function keyboardMoveNode(id, dx, dy) {
  const wf = currentWorkflow();
  const n = wf && wf.nodes.find(x => x.id === id);
  if (!n) return;
  n.x = snapValue(n.x + dx); n.y = snapValue(n.y + dy);
  const el = document.querySelector(`#canvas .node[data-id="${id}"]`);
  if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
  renderEdges(); saveStore();
}
// 기존 keydown에 화살표 추가 (selected 노드 이동)
function attachArrowKeys() {
  document.addEventListener('keydown', (e) => {
    if (selected.type !== 'node') return;
    const step = e.shiftKey ? 100 : 20;
    if (e.key === 'ArrowLeft') { e.preventDefault(); keyboardMoveNode(selected.id, -step, 0); }
    if (e.key === 'ArrowRight') { e.preventDefault(); keyboardMoveNode(selected.id, step, 0); }
    if (e.key === 'ArrowUp') { e.preventDefault(); keyboardMoveNode(selected.id, 0, -step); }
    if (e.key === 'ArrowDown') { e.preventDefault(); keyboardMoveNode(selected.id, 0, step); }
  });
}

// 12. 노드 스타일 커스터마이즈
function setNodeColor(nodeId, color) {
  const wf = currentWorkflow();
  const n = wf && wf.nodes.find(x => x.id === nodeId);
  if (!n) return;
  n.color = color;
  saveStore(); renderAll();
}
function renderNodeColor(n, el) {
  const icon = el.querySelector('.nicon');
  if (icon && n.color) icon.style.background = n.color;
}

// 10. PWA 오프라인 — manifest + service worker 등록
function initPWA() {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  // manifest 동적 생성
  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify({
      name: '커멘드센터', short_name: '커멘드센터',
      start_url: '.', display: 'standalone', theme_color: '#0a0d10',
      background_color: '#0a0d10', icons: []
    }));
    document.head.appendChild(link);
  }
  // service worker (같은 디렉토리에 sw.js 있으면)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// 5. 워크플로우 번들 내보내기/가져오기
function exportBundle() {
  const payload = { app: 'workflow-builder', version: 2, exported_at: new Date().toISOString(), workflows: store.workflows };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'workflows_bundle_' + new Date().toISOString().slice(0,10) + '.json';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  toast('번들 내보내기 완료 (' + store.workflows.length + '개)');
}
function importBundle() {
  document.getElementById('file-import').dataset.mode = 'bundle';
  document.getElementById('file-import').click();
}

// 6. 대시보드 차트 — 실행 경로 트리 간단 SVG
function renderRunChart(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const counts = renderHeatmap();
  const entries = Object.entries(counts).slice(0, 8);
  if (entries.length === 0) { el.innerHTML = '<span style="color:var(--panel-text-faint)">실행 이력 없음</span>'; return; }
  const max = Math.max(...entries.map(e => e[1]), 1);
  el.innerHTML = '<div style="margin-top:8px">' + entries.map(([k, v]) =>
    '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:11px">' +
    '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--panel-text-dim)">' + escapeHtml(k) + '</span>' +
    '<div style="width:60px;height:8px;background:var(--dark-3);border-radius:4px"><div style="width:' + Math.round(v / max * 100) + '%;height:100%;background:var(--accent);border-radius:4px"></div></div>' +
    '<span style="color:var(--accent);font-weight:700">' + v + '</span></div>'
  ).join('') + '</div>';
}

// 7. 공유 뷰 실행 데모 (공유 페이지에서 URL 파라미터로 실행)
function initShareDemo() {
  const params = new URLSearchParams(location.search);
  if (params.get('demo') !== '1') return;
  const demoBtn = document.createElement('button');
  demoBtn.textContent = '▶ 데모 실행';
  demoBtn.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:99;background:#00ff87;color:#04100a;border:none;border-radius:10px;padding:12px 24px;font-size:14px;font-weight:700;cursor:pointer';
  document.body.appendChild(demoBtn);
  let idx = 0;
  const nodes = document.querySelectorAll('#canvas .node');
  demoBtn.addEventListener('click', () => {
    nodes.forEach(n => n.style.borderColor = '#232a33');
    if (idx < nodes.length) {
      nodes[idx].style.borderColor = '#00ff87';
      nodes[idx].style.boxShadow = '0 0 24px rgba(0,255,135,.35)';
      idx++;
      if (idx >= nodes.length) { idx = 0; demoBtn.textContent = '▶ 다시 실행'; }
    }
  });
}

// ═══ 5차 고도화 모듈 (딥리서치 반영) ═══
