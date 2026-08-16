// 3. 가상화 렌더링 — 뷰포트 밖 노드 DOM 생략
let virtEnabled = true;
const VIRT_MARGIN = 200;
function isInViewport(n) {
  if (!virtEnabled) return true;
  const wrap = document.getElementById('canvas-wrap');
  const w = wrap.clientWidth / zoom, h = wrap.clientHeight / zoom;
  const vx = -panX / zoom, vy = -panY / zoom;
  return n.x + 160 > vx - VIRT_MARGIN && n.x < vx + w + VIRT_MARGIN &&
         n.y + 50 > vy - VIRT_MARGIN && n.y < vy + h + VIRT_MARGIN;
}
// renderCanvas에서 사용 (호출부에서 필터)

// 4. 렌더 rAF 디바운스
let rafPending = false;
function renderEdgesThrottled() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; renderEdges(); });
}

// 6. 명령 팔레트 — Ctrl+K
function initCommandPalette() {
  const pal = document.createElement('div');
  pal.id = 'cmd-palette';
  pal.style.cssText = 'display:none;position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:95;background:var(--dark-2);border:1px solid var(--dark-border);border-radius:14px;padding:12px;width:420px;box-shadow:0 6px 24px rgba(0,0,0,.3)';
  pal.innerHTML = '<input id="cmd-input" placeholder="명령 입력... (노드 추가/정렬/실행/내보내기)" style="width:100%;padding:10px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text);font-size:13px;outline:none">' +
    '<div id="cmd-results" style="margin-top:8px"></div>';
  document.body.appendChild(pal);
  const input = pal.querySelector('#cmd-input');
  const results = pal.querySelector('#cmd-results');
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (togglePanel(pal)) input.focus();
    }
    if (e.key === 'Escape') pal.style.display = 'none';
  });
  const CMDS = [
    ['실행', () => executeWorkflow()],
    ['정렬', () => autoAlign()],
    ['AI 생성', () => { document.getElementById('ai-panel').style.display = 'block'; }],
    ['노드 추가 (프로세스)', () => { if (selected.type === 'node') duplicateNode(selected.id); }],
    ['SVG 내보내기', () => exportPNG()],
    ['마크다운 내보내기', () => exportMarkdown()],
    ['통계', () => showStats()],
    ['트레이스', () => { document.getElementById('trace-panel').style.display = 'block'; renderTrace(); }],
    ['Undo', () => undo()],
    ['Redo', () => redo()],
  ];
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    results.innerHTML = '';
    CMDS.filter(([name]) => name.toLowerCase().includes(q)).forEach(([name, fn]) => {
      const b = document.createElement('button');
      b.textContent = name;
      b.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 12px;background:none;border:none;color:var(--panel-text);cursor:pointer;font-size:13px;border-radius:6px';
      b.addEventListener('mouseenter', () => b.style.background = 'var(--dark-3)');
      b.addEventListener('mouseleave', () => b.style.background = 'none');
      b.addEventListener('click', () => { fn(); pal.style.display = 'none'; });
      results.appendChild(b);
    });
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = results.querySelector('button');
      if (first) first.click();
    }
  });
}

// 5. 위험 순위 diff
function riskRankedDiff() {
  const wf = currentWorkflow();
  if (!wf) return [];
  const nodes = wf.nodes || [];
  return nodes.filter(n => n.blocked || n.status === 'failed' || (n.agentId && !getAgent(n.agentId))).map(n => ({
    id: n.id, label: n.label || n.type,
    risk: n.blocked ? 'high' : n.status === 'failed' ? 'high' : 'medium',
  }));
}
function showRiskDiff() {
  const risks = riskRankedDiff();
  if (risks.length === 0) { toast('위험 노드 없음'); return; }
  toastHTML('<div style="min-width:280px"><strong style="display:block;margin-bottom:8px;color:#ff5d5d">⚠️ 위험 순위</strong>' +
    risks.map(r => '<div style="padding:6px;margin-bottom:4px;background:var(--dark-3);border-radius:6px;font-size:12px;border-left:3px solid ' + (r.risk === 'high' ? '#ff5d5d' : '#d29922') + '">' +
      '<strong>' + escapeHtml(r.label) + '</strong> <span style="color:var(--panel-text-faint)">' + r.risk + '</span></div>').join('') +
    '</div>', 7000);
}
// 5. 워크플로우 diff — 두 버전 비교
function wfDiff(vA, vB) {
  const aNodes = (vA && vA.nodes) || [], bNodes = (vB && vB.nodes) || [];
  const aMap = new Map(aNodes.map(n => [n.id, n]));
  const bMap = new Map(bNodes.map(n => [n.id, n]));
  const added = [], removed = [], changed = [];
  bNodes.forEach(n => { if (!aMap.has(n.id)) added.push(n); });
  aNodes.forEach(n => { if (!bMap.has(n.id)) removed.push(n); });
  bNodes.forEach(n => {
    const a = aMap.get(n.id);
    if (a && (a.label !== n.label || a.type !== n.type || a.x !== n.x || a.y !== n.y)) changed.push({ old: a, next: n });
  });
  return { added, removed, changed };
}
function showWfDiff() {
  const wf = currentWorkflow();
  if (!wf) return;
  const key = LS_KEY + '_ver_' + wf.id;
  let versions = [];
  try { versions = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
  if (versions.length < 2) { toast('비교할 버전이 2개 이상 필요'); return; }
  const last = versions[versions.length - 1].data;
  const prev = versions[versions.length - 2].data;
  const prevWf = prev.workflows.find(w => w.id === wf.id);
  const lastWf = last.workflows.find(w => w.id === wf.id);
  if (!prevWf || !lastWf) { toast('버전 데이터 없음'); return; }
  const d = wfDiff(prevWf, lastWf);
  const lines = [];
  d.added.forEach(n => lines.push('<div style="color:var(--accent)">+ ' + escapeHtml(n.label) + '</div>'));
  d.removed.forEach(n => lines.push('<div style="color:#ff5d5d">- ' + escapeHtml(n.label) + '</div>'));
  d.changed.forEach(c => lines.push('<div style="color:#d29922">~ ' + escapeHtml(c.old.label) + ' → ' + escapeHtml(c.next.label) + '</div>'));
  if (lines.length === 0) lines.push('<span style="color:var(--panel-text-faint)">변경 없음</span>');
  toastHTML('<div style="min-width:260px"><strong style="display:block;margin-bottom:8px">버전 diff (v' + (versions.length-1) + ' → v' + versions.length + ')</strong>' + lines.join('') + '</div>', 6000);
}

// 7. 프레즌스 강화 — 활성 사용자 목록 표시
function initPresence() {
  if (!serverOnline) return;
  const badge = document.createElement('span');
  badge.id = 'presence';
  badge.textContent = '● 1명 접속';
  badge.style.cssText = 'font-size:11px;color:var(--accent);margin-left:8px';
  document.getElementById('topbar').appendChild(badge);
  // WS로 다른 사용자 핑 수신 시 카운트 (단순 표시)
  if (ws) {
    setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
    }, 5000);
  }
}

// ═══ 에이전트 협업 모듈 ═══
