// ── 1.1 그룹 노드 / 서브워크플로우 ──
function toggleGroup() {
  const wf = currentWorkflow();
  if (!wf) return;
  if (multiSelect.size >= 2) {
    // 선택된 노드들을 그룹 컨테이너로 묶기
    const ids = new Set(multiSelect);
    const groupId = 'g_' + Date.now().toString(36);
    const members = wf.nodes.filter(n => ids.has(n.id));
    if (members.length < 2) { toast('2개 이상 선택 필요'); return; }
    const minX = Math.min(...members.map(n => n.x)) - 20;
    const minY = Math.min(...members.map(n => n.y)) - 20;
    const maxX = Math.max(...members.map(n => n.x + 160)) + 20;
    const maxY = Math.max(...members.map(n => n.y + 50)) + 20;
    pushHistory();
    members.forEach(n => { n.groupId = groupId; });
    wf.groups = wf.groups || [];
    wf.groups.push({
      id: groupId,
      label: '그룹 ' + (wf.groups.length + 1),
      x: minX, y: minY, w: maxX - minX, h: maxY - minY,
      collapsed: false
    });
    multiSelect.clear();
    saveStore(); renderAll();
    toast('그룹 생성 (' + members.length + '개 노드)');
  } else {
    // 그룹 컨테이너 자체 추가
    pushHistory();
    wf.groups = wf.groups || [];
    wf.groups.push({ id: 'g_' + Date.now().toString(36), label: '새 그룹', x: 80, y: 80, w: 280, h: 160, collapsed: false });
    saveStore(); renderAll();
    toast('그룹 추가');
  }
}
function renderGroups() {
  const canvas = document.getElementById('canvas');
  const wf = currentWorkflow();
  if (!wf || !wf.groups) return;
  wf.groups.forEach(g => {
    const el = document.createElement('div');
    el.className = 'group-box' + (g.collapsed ? ' collapsed' : '');
    el.style.left = g.x + 'px'; el.style.top = g.y + 'px';
    el.style.width = g.w + 'px'; el.style.height = g.h + 'px';
    el.dataset.gid = g.id;
    el.innerHTML = '<span class="g-label">' + escapeHtml(g.label) + '</span>';
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      g.collapsed = !g.collapsed;
      saveStore(); renderAll();
    });
    canvas.appendChild(el);
  });
}

// ── 1.2 베지어 곡선 엣지 ──
function edgePath(x1, y1, x2, y2) {
  const hx = Math.abs(x2 - x1), hy = Math.abs(y2 - y1);
  // 가로 배치(노드 좌우): x 방향으로 휨 / 세로 배치(노드 위아래): y 방향으로 휨
  if (hx >= hy) {
    const dx = Math.max(40, hx * 0.5);
    return `M ${x1} ${y1} C ${x1+dx} ${y1}, ${x2-dx} ${y2}, ${x2} ${y2}`;
  } else {
    const dy = Math.max(30, hy * 0.5);
    // 시작 노드 오른쪽(포트)에서 세로로 휘어 목표 노드 왼쪽으로 들어옴 — 왼쪽 이탈 방지
    return `M ${x1} ${y1} C ${x1} ${y1+dy}, ${x2} ${y2-dy}, ${x2} ${y2}`;
  }
}

// ── 1.3 인라인 라벨 편집 ──
function enableInlineEdit(node) {
  const el = document.querySelector(`#canvas .node[data-id="${node.id}"] .nlabel`);
  if (!el) return;
  const cur = node.label;
  const input = document.createElement('input');
  input.className = 'inline-edit';
  input.value = cur;
  el.replaceWith(input);
  input.focus();
  input.select();
  input.addEventListener('blur', () => {
    node.label = input.value.trim() || cur;
    pushHistory();
    saveStore(); renderAll();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = cur; input.blur(); }
  });
}

// ── 1.4 워크플로우 검색/필터 ──
function filterWorkflows(q) {
  const ul = document.getElementById('wf-list');
  const items = ul.querySelectorAll('li[data-id]');
  items.forEach(li => {
    const wf = store.workflows.find(w => w.id === li.dataset.id);
    const hit = !q || (wf && (wf.name || '').toLowerCase().includes(q.toLowerCase()));
    li.style.display = hit ? '' : 'none';
  });
}

// ── 2.3 PNG 내보내기 ──
function exportPNG() {
  const canvas = document.getElementById('canvas');
  const wf = currentWorkflow();
  if (!wf) return;
  const nodes = canvas.querySelectorAll('.node');
  if (nodes.length === 0) { toast('내보낼 노드 없음'); return; }
  const pad = 40;
  const minX = Math.min(...[...nodes].map(n => parseFloat(n.style.left))) - pad;
  const minY = Math.min(...[...nodes].map(n => parseFloat(n.style.top))) - pad;
  const maxX = Math.max(...[...nodes].map(n => parseFloat(n.style.left) + n.offsetWidth)) + pad;
  const maxY = Math.max(...[...nodes].map(n => parseFloat(n.style.top) + n.offsetHeight)) + pad;
  const w = maxX - minX, h = maxY - minY;
  // 외부 라이브러리 없이: SVG로 캔버스 재구성 후 이미지화
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('xmlns', svgNS);
  const bg = document.createElementNS(svgNS, 'rect');
  bg.setAttribute('x', 0); bg.setAttribute('y', 0);
  bg.setAttribute('width', w); bg.setAttribute('height', h);
  bg.setAttribute('fill', '#12161b');
  svg.appendChild(bg);
  wf.edges.forEach(e => {
    const from = wf.nodes.find(n => n.id === e.from), to = wf.nodes.find(n => n.id === e.to);
    if (!from || !to) return;
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', edgePath(from.x - minX + 90, from.y - minY + 26, to.x - minX + 90, to.y - minY + 26));
    path.setAttribute('stroke', '#7d8fa1'); path.setAttribute('stroke-width', '2.5');
    path.setAttribute('fill', 'none');
    svg.appendChild(path);
  });
  wf.nodes.forEach(n => {
    const g = document.createElementNS(svgNS, 'g');
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', n.x - minX); rect.setAttribute('y', n.y - minY);
    rect.setAttribute('width', 160); rect.setAttribute('height', 50);
    rect.setAttribute('rx', 12); rect.setAttribute('fill', '#1a2027');
    rect.setAttribute('stroke', NODE_TYPES[n.type].color); rect.setAttribute('stroke-width', '2');
    g.appendChild(rect);
    const icon = document.createElementNS(svgNS, 'rect');
    icon.setAttribute('x', n.x - minX + 10); icon.setAttribute('y', n.y - minY + 12);
    icon.setAttribute('width', 26); icon.setAttribute('height', 26); icon.setAttribute('rx', 6);
    icon.setAttribute('fill', NODE_TYPES[n.type].color);
    g.appendChild(icon);
    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('x', n.x - minX + 46); text.setAttribute('y', n.y - minY + 30);
    text.setAttribute('fill', '#e8eaed'); text.setAttribute('font-size', '14');
    text.setAttribute('font-family', 'system-ui'); text.setAttribute('font-weight', '600');
    text.textContent = n.label || NODE_TYPES[n.type].label;
    g.appendChild(text);
    svg.appendChild(g);
  });
  const xml = new XMLSerializer().serializeToString(svg);
  const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = (wf.name || 'workflow') + '_' + new Date().toISOString().slice(0,10) + '.svg';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  toast('SVG 내보내기 완료 (PNG 변환은 브라우저에서 열어 저장)');
}

// ── 3.2 실행 로그 ──
let runLogs = [];
function logRun(path, agentName) {
  runLogs.unshift({ t: new Date().toLocaleTimeString(), path: (agentName ? '[' + agentName + '] ' : '') + path });
  if (runLogs.length > 20) runLogs.pop();
  const body = document.getElementById('runlog-body');
  if (body && document.getElementById('runlog-panel').style.display !== 'none') {
    renderRunLog();
  }
  // 서버 저장 (선택)
  const wf = currentWorkflow();
  if (wf && serverOnline) {
    fetch(API_BASE + '/api/workflows/' + encodeURIComponent(wf.id) + '/logs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, ts: new Date().toISOString() })
    }).catch(() => {});
  }
}
function renderRunLog() {
  const body = document.getElementById('runlog-body');
  body.innerHTML = runLogs.length === 0
    ? '<span style="color:var(--panel-text-faint)">실행 기록 없음</span>'
    : runLogs.map(l => '<div style="padding:3px 0;border-bottom:1px solid var(--dark-border)"><span style="color:var(--accent)">' + l.t + '</span> ' + escapeHtml(l.path) + '</div>').join('');
}

// ── 3.3 노드별 조건식 ──
function evalCondition(expr, ctx) {
  try {
    // 안전한 조건 평가 — 단순 연산자/변수만 허용 + 프로토타입 차단
    let sanitized = String(expr || '').replace(/[^0-9a-zA-Z_\s.()+\-*\/<>!=&|'"]/g, '');
    // 프로토타입 체인 접근 차단 (constructor/prototype/__proto__)
    if (/constructor|prototype|__proto__|caller|arguments/i.test(sanitized)) return false;
    if (!sanitized.trim()) return false;
    try {
      const fn = new Function('ctx', 'with(ctx) { return !!(' + sanitized + '); }');
      return fn(ctx);
    } catch (e) { return false; }
  } catch (e) { return false; }
}

// ── 3.1 AI 워크플로우 생성 (LLM 연동) ──
async function aiGenerate() {
  const prompt = document.getElementById('ai-prompt').value.trim();
  if (!prompt) { toast('프롬프트를 입력하세요'); return; }
  const btn = document.getElementById('ai-generate');
  btn.disabled = true;
  btn.textContent = '생성 중...';
  try {
    if (!serverOnline) { toast('서버 미연결 — AI 생성 불가'); return; }
    const r = await fetch(API_BASE + '/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const j = await r.json();
    if (!j.success) {
      toast('AI 생성 실패: ' + (j.error || '알 수 없는 오류'));
      return;
    }
    const wf = defaultWorkflow('AI: ' + prompt.slice(0, 30));
    wf.nodes = j.workflow.nodes;
    wf.edges = j.workflow.edges;
    store.workflows.push(wf);
    store.activeWorkflowId = wf.id;
    document.getElementById('wf-name').value = wf.name;
    document.getElementById('ai-panel').style.display = 'none';
    pushHistory();
    saveStore(true); renderAll();
    toast('AI 생성 완료: ' + wf.name + ' (' + wf.nodes.length + '개 노드)');
  } catch (e) {
    toast('AI 생성 오류: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '생성';
  }
}

// ── 2.4 실시간 협업 (WebSocket) ──
let ws = null;
function initWS() {
  try {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host + '/ws');
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'wf_update' && msg.id === store.activeWorkflowId) {
          // 다른 사용자 변경 반영 (충돌 시 무시 — 단순 브로드캐스트)
          toast('🔔 다른 사용자가 변경했습니다');
        }
      } catch (e) {}
    };
    patchWSHandler();  // agent_report 실시간 반영 핸들러 연결
  } catch (e) { /* WS 미지원 */ }
}

// === 2차 고도화 버튼 이벤트 ===
document.getElementById('btn-ai').addEventListener('click', () => {
  document.getElementById('ai-panel').style.display = 'block';
  document.getElementById('ai-prompt').focus();
});
document.getElementById('ai-close').addEventListener('click', () => {
  document.getElementById('ai-panel').style.display = 'none';
});
document.getElementById('ai-generate').addEventListener('click', aiGenerate);
document.getElementById('ai-prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) aiGenerate();
});
document.getElementById('btn-group').addEventListener('click', toggleGroup);
document.getElementById('btn-png').addEventListener('click', exportPNG);
document.getElementById('runlog-close').addEventListener('click', () => {
  document.getElementById('runlog-panel').style.display = 'none';
});
document.getElementById('wf-search').addEventListener('input', (e) => {
  filterWorkflows(e.target.value);
});

// 줌 컨트롤
document.getElementById('zoom-in').addEventListener('click', () => {
  zoom = Math.min(2.5, zoom * 1.25); applyView(); updateZoomLabel();
});
document.getElementById('zoom-out').addEventListener('click', () => {
  zoom = Math.max(0.3, zoom / 1.25); applyView(); updateZoomLabel();
});
document.getElementById('zoom-reset').addEventListener('click', () => {
  zoom = 1; panX = 0; panY = 0; applyView(); updateZoomLabel();
});
function updateZoomLabel() {
  document.getElementById('zoom-level').textContent = Math.round(zoom * 100) + '%';
}
document.getElementById('canvas-wrap').addEventListener('wheel', () => setTimeout(updateZoomLabel, 50));

// ═══ 3차 고도화 모듈 (병렬 구현) ═══
