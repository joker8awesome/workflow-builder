// 터치 좌표 헬퍼
function touchXY(e) {
  const t = e.touches[0] || e.changedTouches[0];
  return { x: t.clientX, y: t.clientY };
}

// ── 1. 노드 드래그 (터치) ──
function attachTouchDrag(el, node) {
  el.addEventListener('touchstart', (e) => {
    if (lockMode || node.locked) { toast('🔒 잠긴 노드'); return; }
    if (e.touches.length !== 1) return;
    e.preventDefault(); e.stopPropagation();
    selected = { type: 'node', id: node.id };
    const start = touchXY(e);
    const origX = node.x, origY = node.y;
    const group = new Set(multiSelect);
    if (!group.has(node.id)) group.add(node.id);
    const orig = {};
    group.forEach(id => {
      const n = currentWorkflow().nodes.find(x => x.id === id);
      if (n) orig[id] = { x: n.x, y: n.y };
    });
    let moved = false;
    function move(ev) {
      if (ev.touches.length !== 1) return;
      ev.preventDefault();
      const pt = touchXY(ev);
      const dx = pt.x - start.x, dy = pt.y - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
      group.forEach(id => {
        const n = currentWorkflow().nodes.find(x => x.id === id);
        if (n && orig[id]) {
          n.x = snapValue(orig[id].x + dx); n.y = snapValue(orig[id].y + dy);
          const el2 = document.querySelector(`#canvas .node[data-id="${id}"]`);
          if (el2) { el2.style.left = n.x + 'px'; el2.style.top = n.y + 'px'; }
        }
      });
      renderEdges();
    }
    function up(ev) {
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
    removeNodeTooltip();
      if (moved && (node.x !== origX || node.y !== origY)) pushHistory();
      saveStore();
    }
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', up);
  }, { passive: false });
}

// ── 2. 연결 핸들 (터치) ──
function attachTouchConnect(portEl, nodeId) {
  portEl.addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    const fromId = nodeId;
    function move(ev) {
      ev.preventDefault();
      const pt = touchXY(ev);
      const from = currentWorkflow().nodes.find(n => n.id === fromId);
      if (from) {
        const rect = document.getElementById('canvas-wrap').getBoundingClientRect();
        tempEdge = {
          x1: from.x + 90, y1: from.y + 26,
          x2: (pt.x - rect.left - panX) / zoom,
          y2: (pt.y - rect.top - panY) / zoom
        };
        renderTempEdge();
      }
    }
    function up(ev) {
      ev.preventDefault();
      const pt = touchXY(ev);
      const target = document.elementFromPoint(pt.x, pt.y)?.closest('.node');
      if (target && target.dataset.id !== fromId) {
        const wf = currentWorkflow();
        const existing = wf.edges.filter(e2 => e2.from === fromId);
        const isDecision = wf.nodes.find(n => n.id === fromId)?.type === 'decision';
        const label = isDecision ? (existing.length === 0 ? 'Yes' : 'No') : '';
        wf.edges.push({ id: 'e_' + Date.now().toString(36), from: fromId, to: target.dataset.id, label });
        pushHistory();
        saveStore(); renderAll();
      }
      tempEdge = null; renderTempEdge();
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
    }
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', up);
  }, { passive: false });
}

// ── 3. 캔버스 팬(한 손가락) + 핀치 줌 ──
let touchPinch = null;
document.getElementById('canvas-wrap').addEventListener('touchstart', (e) => {
  if (e.target.closest('.node')) return; // 노드 터치는 노드 핸들러가 처리
  if (e.touches.length === 2) {
    const t1 = touchXY({ touches: [e.touches[0]] });
    const t2 = touchXY({ touches: [e.touches[1]] });
    touchPinch = {
      dist: Math.hypot(t2.x - t1.x, t2.y - t1.y),
      zoom: zoom,
      panX, panY,
      cx: (t1.x + t2.x) / 2, cy: (t1.y + t2.y) / 2
    };
  } else if (e.touches.length === 1) {
    const pt = touchXY(e);
    panning = { x: pt.x, y: pt.y };
  }
}, { passive: true });

document.getElementById('canvas-wrap').addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (touchPinch && e.touches.length === 2) {
    const t1 = touchXY({ touches: [e.touches[0]] });
    const t2 = touchXY({ touches: [e.touches[1]] });
    const dist = Math.hypot(t2.x - t1.x, t2.y - t1.y);
    zoom = Math.max(0.3, Math.min(2.5, touchPinch.zoom * (dist / touchPinch.dist)));
    applyView();
  } else if (panning && e.touches.length === 1) {
    const pt = touchXY(e);
    panX += pt.x - panning.x; panY += pt.y - panning.y;
    panning = { x: pt.x, y: pt.y };
    applyView();
  }
}, { passive: false });

document.getElementById('canvas-wrap').addEventListener('touchend', (e) => {
  touchPinch = null;
  panning = null;
}, { passive: true });

// ── 4. 롱프레스 → 컨텍스트 메뉴 + 더블탭 → 인라인 편집 ──
function attachTouchGestures(el, node) {
  let pressTimer = null, lastTap = 0;
  el.addEventListener('touchstart', (e) => {
    // 더블탭 감지
    const now = Date.now();
    if (now - lastTap < 300) {
      lastTap = 0;
      e.preventDefault();
      enableInlineEdit(node);
      return;
    }
    lastTap = now;
    // 롱프레스 감지 (500ms)
    pressTimer = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      ctxMenu.style.display = 'block';
      ctxMenu.style.left = (rect.left + rect.width / 2) + 'px';
      ctxMenu.style.top = rect.top + 'px';
      ctxMenu.dataset.x = node.x; ctxMenu.dataset.y = node.y;
    }, 500);
  }, { passive: true });
  el.addEventListener('touchend', () => clearTimeout(pressTimer), { passive: true });
  el.addEventListener('touchcancel', () => clearTimeout(pressTimer), { passive: true });
}

// renderCanvas에서 노드 생성 후 터치 연결 (호출)
function attachNodeTouch(node) {
  const el = document.querySelector(`#canvas .node[data-id="${node.id}"]`);
  if (!el) return;
  attachTouchDrag(el, node);
  const port = el.querySelector('.nport');
  if (port) attachTouchConnect(port, node.id);
  attachTouchGestures(el, node);
}

// === 모바일 하단 바 이벤트 ===
document.getElementById('m-btn-run').addEventListener('click', () => {
  if (execState.running) { toast('이미 실행 중'); return; }
  executeWorkflow();
});
document.getElementById('m-btn-align').addEventListener('click', autoAlign);
document.getElementById('m-btn-ai').addEventListener('click', () => {
  document.getElementById('ai-panel').style.display = 'block';
  document.getElementById('ai-prompt').focus();
});
document.getElementById('m-btn-png').addEventListener('click', exportPNG);
document.getElementById('m-btn-md').addEventListener('click', exportMarkdown);
document.getElementById('m-btn-stats').addEventListener('click', showStats);
document.getElementById('m-btn-more').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('mobile-menu');
  togglePanel(menu);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#mobile-menu') && !e.target.closest('#m-btn-more')) {
    document.getElementById('mobile-menu').style.display = 'none';
  }
});
// 더보기 메뉴 항목
document.getElementById('mm-group').addEventListener('click', () => { toggleGroup(); document.getElementById('mobile-menu').style.display = 'none'; });
document.getElementById('mm-template').addEventListener('click', () => { document.getElementById('template-panel').style.display = 'block'; document.getElementById('sidebar').classList.add('open'); document.getElementById('mobile-menu').style.display = 'none'; });
document.getElementById('mm-share').addEventListener('click', () => { shareWorkflow(); document.getElementById('mobile-menu').style.display = 'none'; });
document.getElementById('mm-version').addEventListener('click', () => { showVersions(); document.getElementById('mobile-menu').style.display = 'none'; });
document.getElementById('mm-export').addEventListener('click', () => { document.getElementById('btn-export').click(); document.getElementById('mobile-menu').style.display = 'none'; });
document.getElementById('mm-import').addEventListener('click', () => { document.getElementById('btn-import').click(); document.getElementById('mobile-menu').style.display = 'none'; });
document.getElementById('mm-lock').addEventListener('click', () => { toggleLockMode(); document.getElementById('mobile-menu').style.display = 'none'; });
document.getElementById('mm-fav').addEventListener('click', () => { toggleFav(); document.getElementById('mobile-menu').style.display = 'none'; });
document.getElementById('mm-bundle').addEventListener('click', () => { exportBundle(); document.getElementById('mobile-menu').style.display = 'none'; });
document.getElementById('btn-bundle').addEventListener('click', () => exportBundle());

// ═══ 4차 고도화 모듈 ═══
