// 마이그레이션 대비: 같은 도메인 하위 슬러그에서도 기존 사이트와
// localStorage 충돌 없이 독립 동작하도록 경로 기반 키 사용
const LS_KEY = 'wf_app_' + (location.pathname.split('/').filter(Boolean).join('_') || 'root');
// 백업 키 (JSON 파손 대비)
const LS_BACKUP_KEY = LS_KEY + '_backup';

// === 서버 연동 (옵션) ===
// 서버가 있으면(localhost:3737 등) 자동 사용, 없으면 localStorage만으로 동작
// API_BASE — 로컬 서버 우선, GitHub Pages/정적 호스팅에서는 상대 경로(서버 미연결 → localStorage 모드)
const API_BASE = (window.__WF_API__ || (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://localhost:3737' : ''));
let serverOnline = false;
let syncTimer = null;

async function checkServer() {
  try {
    const r = await fetch(API_BASE + '/api/workflows', { signal: AbortSignal.timeout(2500) });
    serverOnline = r.ok;
  } catch (e) { serverOnline = false; }
  updateSyncStatus();
  return serverOnline;
}

// 패널 열고 닫기 — 인라인 style 이 아니라 실제 표시 상태를 본다.
// 이전에는 el.style.display 만 비교해서, 인라인 값이 없는 요소(CSS 클래스나
// 스타일시트로 숨긴 경우)는 첫 클릭이 반대로 동작했다 — 열려 있는 걸 닫아버렸다.
// 지금은 모든 패널에 인라인 display:none 이 있어 드러나지 않았을 뿐이다.
// @returns {boolean} 이번 호출로 열렸으면 true
function togglePanel(el) {
  if (!el) return false;
  const willOpen = getComputedStyle(el).display === 'none';
  el.style.display = willOpen ? 'block' : 'none';
  return willOpen;
}

// 패널 오류 문구 — 원인을 알려준다.
// 지금까지는 전부 "로드 실패"라고만 떠서, 서버가 없는 정적 배포(GitHub Pages)에서
// 기능이 고장난 것처럼 보였다. 실제로는 서버가 필요한 기능일 뿐이다.
function panelErrorHtml(what) {
  const noServer = !API_BASE && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
  const msg = noServer
    ? (what || '이 기능') + '은(는) 서버가 필요합니다.<br><span style="font-size:11px">현재 정적 배포 — 로컬 저장 모드로 동작 중</span>'
    : wfAuthFailed
      ? '인증이 필요합니다. 우측 상단 상태 표시를 눌러 API 키를 입력하세요.'
      : (what || '데이터') + '을(를) 불러오지 못했습니다: 서버 응답 오류.<br><span style="font-size:11px">잠시 후 다시 시도하세요</span>';
  return '<span style="color:var(--panel-text-faint);line-height:1.6">' + msg + '</span>';
}

// === API 키 (팀 도구) ===
// 서버가 변경 API에 인증을 요구하기 시작하면 이 키가 없으면 401이 된다.
// 키는 이 브라우저의 localStorage 에만 둔다 — 소스나 저장소에 넣지 않는다.
const WF_KEY_LS = 'wf_api_key';
let wfAuthFailed = false;
function getWfKey() { try { return localStorage.getItem(WF_KEY_LS) || ''; } catch (e) { return ''; } }
function setWfKey(k) {
  try { k ? localStorage.setItem(WF_KEY_LS, k) : localStorage.removeItem(WF_KEY_LS); } catch (e) {}
  wfAuthFailed = false;
  updateSyncStatus();
}
function promptWfKey() {
  const cur = getWfKey();
  const v = prompt(
    'API 키 (wf_ak_...)\n\n' +
    '팀 도구 모드에서는 편집에 키가 필요합니다.\n' +
    '팀 → 에이전트 → 자격증명 발급 에서 받을 수 있습니다.\n' +
    '비워두고 확인하면 저장된 키를 지웁니다.',
    cur);
  if (v === null) return;            // 취소
  setWfKey(v.trim());
  if (getWfKey()) loadFromServer().catch(() => {});
}

// fetch 래퍼 — API 호출에만 Authorization 을 붙인다.
// 호출 지점이 60곳이 넘어 하나씩 고치면 반드시 빠뜨린다. 한 곳에서 처리한다.
(function installAuthFetch() {
  const orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/') === -1 && url.indexOf('/mcp') === -1) return orig(input, init);
    const key = getWfKey();
    const opts = Object.assign({}, init);
    const headers = new Headers((init && init.headers) || {});
    // 이미 Authorization 이 지정된 호출(자격증명 발급 등)은 건드리지 않는다
    if (key && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + key);
    opts.headers = headers;
    return orig(input, opts).then(r => {
      if (r.status === 401 || r.status === 403) {
        if (!wfAuthFailed) {
          wfAuthFailed = true;
          updateSyncStatus();
          console.warn('[auth] 인증 필요 —', r.status, url);
        }
      }
      return r;
    });
  };
})();

function updateSyncStatus() {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (wfAuthFailed) {
    el.textContent = '🔑 키 필요 (클릭)';
    el.style.background = '#9a6700';
    el.style.color = '#fff';
  } else if (serverOnline) {
    el.textContent = getWfKey() ? '서버 연결됨 🔑' : '서버 연결됨';
    el.style.background = '#1a7f37';
    el.style.color = '#fff';
  } else {
    el.textContent = '로컬 저장';
    el.style.background = '#444';
    el.style.color = '#fff';
  }
  el.style.cursor = 'pointer';
  el.title = '클릭하면 API 키를 입력/변경합니다';
  if (!el.dataset.keyBound) {
    el.dataset.keyBound = '1';
    el.addEventListener('click', promptWfKey);
  }
}

// 서버에서 전체 워크플로우 로드 (성공 시 store 대체)
async function loadFromServer() {
  if (!(await checkServer())) return false;
  try {
    const r = await fetch(API_BASE + '/api/workflows');
    const j = await r.json();
    if (!j.success) return false;
    const list = j.workflows || [];
    if (list.length === 0) return false;
    const loaded = [];
    for (const item of list) {
      const d = await (await fetch(API_BASE + '/api/workflows/' + item.id)).json();
      if (d.success && d.workflow) {
        const wf = d.workflow.data || {};
        if (Array.isArray(wf.nodes) && Array.isArray(wf.edges)) {
          loaded.push({ id: d.workflow.id, name: d.workflow.name, nodes: wf.nodes, edges: wf.edges });
        }
      }
    }
    // 부분 로드로 기존 로컬 데이터를 조용히 덮어쓰지 않는다 — 전부 유효할 때만 교체
    if (loaded.length > 0 && loaded.length === list.length) {
      store.workflows = loaded;
      store.activeWorkflowId = loaded[0].id;
      return true;
    }
    if (loaded.length > 0) {
      console.warn('server load partial:', loaded.length + '/' + list.length + ' 유효 — 로컬 데이터 유지');
    }
  } catch (e) { console.warn('server load failed', e); }
  return false;
}

// 서버에 전체 워크플로우 동기화 (디바운스)
// 오프라인 편집 큐 — 서버 미연결 시 변경 대기
let offlineQueue = [];
function queueOfflineSync() {
  try { offlineQueue = JSON.parse(localStorage.getItem(LS_KEY + '_offline') || '[]'); } catch (e) { offlineQueue = []; }
  const wf = currentWorkflow();
  if (wf && !serverOnline) {
    offlineQueue.push({ wfId: wf.id, ts: Date.now() });
    localStorage.setItem(LS_KEY + '_offline', JSON.stringify(offlineQueue.slice(-50)));
  }
}
function flushOfflineQueue() {
  if (!serverOnline) return;
  try { offlineQueue = JSON.parse(localStorage.getItem(LS_KEY + '_offline') || '[]'); } catch (e) { offlineQueue = []; }
  if (offlineQueue.length === 0) return;
  const count = offlineQueue.length;
  // 큐를 지우기 전에 실제 sync 성공 여부를 확인한다.
  // 이전엔 debounce syncToServer() 를 kick 하고 곧바로 removeItem 했다 —
  // sync 가 실패해도 큐가 사라져 오프라인 편집 유실이 났다. (#29 리뷰1 결함)
  syncToServerNow().then((ok) => {
    if (ok) {
      localStorage.removeItem(LS_KEY + '_offline');
      console.log('오프라인 편집 ' + count + '건 동기화');
      toast('오프라인 편집 ' + count + '건 동기화됨');
    } else {
      console.warn('오프라인 큐 flush 실패 — 큐 유지');
      toast('오프라인 편집 동기화 실패 — 다음 접속 시 재시도');
    }
  });
}
function syncToServer() {
  if (!serverOnline) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncToServerNow(); }, 800);
}
// 즉시 실행 + 결과 확인 버전. flushOfflineQueue 처럼 성공/실패를 알아야 하는 곳에서 쓴다.
// fetch 응답 상태를 확인하지 않으면 500·404 도 조용히 넘어간다 (#29 리뷰1 결함).
async function syncToServerNow() {
  if (!serverOnline) return false;
  try {
    for (const wf of store.workflows) {
      const r = await fetch(API_BASE + '/api/workflows/' + encodeURIComponent(wf.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: wf.name, data: { nodes: wf.nodes, edges: wf.edges } }),
      });
      if (!r.ok) {
        console.warn('server sync HTTP ' + r.status + ' for ' + wf.id);
        queueOfflineSync();
        return false;
      }
    }
    return true;
  } catch (e) {
    console.warn('server sync failed', e);
    queueOfflineSync();
    return false;
  }
}
let store = { workflows: [], activeWorkflowId: null };
let saveTimer = null;

function defaultWorkflow(name) {
  const id = 'wf_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  return {
    id, name,
    nodes: [
      { id: 'n_' + Date.now().toString(36) + 'a', type: 'start', x: 80, y: 100, label: '시작', desc: '', assignee: '', due: '', tags: [] },
      { id: 'n_' + Date.now().toString(36) + 'b', type: 'end', x: 80, y: 340, label: '종료', desc: '', assignee: '', due: '', tags: [] }
    ],
    edges: []
  };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      store = JSON.parse(raw);
      if (!Array.isArray(store.workflows)) store.workflows = [];
      if (store.workflows.length === 0) {
        const wf = defaultWorkflow('새 워크플로우');
        store.workflows.push(wf);
        store.activeWorkflowId = wf.id;
      }
      if (!store.workflows.find(w => w.id === store.activeWorkflowId)) {
        store.activeWorkflowId = store.workflows[0].id;
      }
    } else {
      const wf = defaultWorkflow('새 워크플로우');
      store.workflows = [wf];
      store.activeWorkflowId = wf.id;
    }
  } catch (e) {
    console.warn('load failed', e);
    // 백업에서 복구 시도
    try {
      const backup = localStorage.getItem(LS_BACKUP_KEY);
      if (backup) {
        store = JSON.parse(backup);
        if (!Array.isArray(store.workflows)) store.workflows = [];
      }
    } catch (e2) { console.warn('backup load failed', e2); }
    if (!store.workflows || store.workflows.length === 0) {
      const wf = defaultWorkflow('새 워크플로우');
      store = { workflows: [wf], activeWorkflowId: wf.id };
    }
  }
}

function saveStore(immediate) {
  clearTimeout(saveTimer);
  const write = () => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(store));
      milestoneCheck();
      localStorage.setItem(LS_BACKUP_KEY, JSON.stringify(store));
      const el = document.getElementById('save-status');
      if (el) { el.textContent = '저장됨'; setTimeout(() => el.textContent = '', 2000); }
    } catch (e) {
      const el = document.getElementById('save-status');
      if (el) el.textContent = '⚠ 저장 실패 (localStorage 불가)';
    }
  };
  if (immediate) { write(); }
  else saveTimer = setTimeout(write, 500);
  syncToServer();
  recordVersionDebounced();
  broadcastLocalChange();
}
let verTimer = null;
function recordVersionDebounced() {
  clearTimeout(verTimer);
  verTimer = setTimeout(() => {
    const wf = currentWorkflow();
    if (!wf) return;
    const key = LS_KEY + '_ver_' + wf.id;
    let versions = [];
    try { versions = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
    versions.push({ t: new Date().toISOString(), data: JSON.parse(snapshotState()) });
    if (versions.length > 20) versions = versions.slice(-20);
    localStorage.setItem(key, JSON.stringify(versions));
  }, 3000);
}

function currentWorkflow() {
  return store.workflows.find(w => w.id === store.activeWorkflowId) || null;
}

// === Sidebar ===
// 워크플로우 상태 파생 (노드 상태 기반)
function wfStatus(wf) {
  const nodes = wf.nodes || [];
  if (!nodes.length) return '대기';
  if (nodes.some(n => n.status === '블로커')) return '블로커';
  if (nodes.every(n => n.type === 'start' || n.type === 'end' || n.status === '완료')) return '완료';
  if (nodes.some(n => n.status === '진행' || n.status === '검토')) return '진행';
  return '대기';
}
let wfFilter = '전체';
function bindWfFilter() {
  const wrap = document.getElementById('wf-filter');
  if (!wrap || wrap.dataset.bound) return;
  wrap.dataset.bound = '1';
  wrap.innerHTML = ['전체', '진행', '완료', '블로커'].map(f =>
    '<button class="wf-filter-btn" data-f="' + f + '" style="flex:1;padding:4px 0;font-size:10px;border-radius:8px;background:var(--dark-3);border:1px solid var(--dark-border);color:var(--panel-text-faint);cursor:pointer">' + f + '</button>'
  ).join('');
  wrap.querySelectorAll('.wf-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      wfFilter = btn.dataset.f;
      wrap.querySelectorAll('.wf-filter-btn').forEach(b => {
        const on = b.dataset.f === wfFilter;
        b.style.background = on ? 'var(--accent)' : 'var(--dark-3)';
        b.style.color = on ? '#04100a' : 'var(--panel-text-faint)';
      });
      renderSidebar();
    });
  });
}
function renderSidebar() {
  const ul = document.getElementById('wf-list');
  ul.innerHTML = '';
  setTimeout(() => {
    const items = ul.querySelectorAll('li').length;
    let hint = document.getElementById('sidebar-hint');
    if (items === 0) {
      if (!hint) {
        hint = document.createElement('div');
        hint.id = 'sidebar-hint';
        hint.style.cssText = 'padding:14px;font-size:12px;color:var(--panel-text-faint);text-align:center';
        const sb = document.getElementById('sidebar');
        if (sb) sb.appendChild(hint);
      }
      hint.innerHTML = '워크플로우 없음<br><strong style="color:var(--accent)">+ 버튼</strong>으로 시작';
      hint.style.display = 'block';
    } else if (hint) hint.style.display = 'none';
  }, 100);
  store.workflows.filter(wf => wfFilter === '전체' || wfStatus(wf) === wfFilter).forEach(wf => {
    const li = document.createElement('li');
    li.title = wf.name + (wf.nodes ? ' (' + wf.nodes.length + ' 노드)' : '');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'wf-name';
    nameSpan.textContent = wf.name;
    li.appendChild(nameSpan);
    li.className = wf.id === store.activeWorkflowId ? 'active' : '';
    li.dataset.id = wf.id;
    li.addEventListener('click', () => {
      store.activeWorkflowId = wf.id;
      document.getElementById('wf-name').value = wf.name;
      renderAll(); saveStore();
    });
    const del = document.createElement('button');
    del.textContent = '×';
    del.className = 'wf-del';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('워크플로우를 삭제할까요?')) return;
      store.workflows = store.workflows.filter(w => w.id !== wf.id);
      if (store.activeWorkflowId === wf.id) {
        store.activeWorkflowId = store.workflows[0]?.id || null;
      }
      renderAll(); saveStore(true);
    });
    li.appendChild(del);
    ul.appendChild(li);
  });
}

document.getElementById('add-wf').addEventListener('click', () => {
  const wf = defaultWorkflow('새 워크플로우 ' + (store.workflows.length + 1));
  store.workflows.push(wf);
  store.activeWorkflowId = wf.id;
  document.getElementById('wf-name').value = wf.name;
  renderAll(); saveStore(true);
});

function renderAll() {
  renderSidebar();
  renderCanvas();
  renderInspector();
  renderMinimap();
  renderEmptyStates();
}

// 1: 빈 상태 온보딩
function renderEmptyStates() {
  const wf = currentWorkflow();
  const nodes = (wf && wf.nodes) || [];
  const canvas = document.getElementById('canvas-wrap');
  let guide = document.getElementById('empty-guide');
  if (nodes.length === 0) {
    if (!guide) {
      guide = document.createElement('div');
      guide.id = 'empty-guide';
      guide.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;z-index:5;pointer-events:none';
      canvas.appendChild(guide);
    }
    guide.innerHTML = '<div style="font-size:15px;color:var(--panel-text-dim);margin-bottom:12px">캔버스가 비어 있습니다</div>' +
      '<div style="font-size:13px;color:var(--panel-text-faint)">🖱️ <strong>우클릭</strong>으로 노드 추가 · 노드 <strong>가장자리</strong>에서 연결<br>' +
      '<strong>Ctrl+K</strong> 명령 팔레트 · [AI]로 자동 생성</div>';
    guide.style.display = 'block';
  } else if (guide) {
    guide.style.display = 'none';
  }
}

// 5: 단계별 성공 표시
function milestoneCheck() {
  try {
    const wf = currentWorkflow();
    if (!wf) return;
    const key = LS_KEY + '_milestones';
    const m = JSON.parse(localStorage.getItem(key) || '{}');
    const id = wf.id;
    if (!m[id]) m[id] = { node: false, edge: false, run: false };
    const cur = m[id];
    if ((wf.nodes || []).length > 0 && !cur.node) { cur.node = true; toast('🎉 첫 노드 추가 완료!'); }
    if ((wf.edges || []).length > 0 && !cur.edge) { cur.edge = true; toast('🎉 첫 연결 완료!'); }
    localStorage.setItem(key, JSON.stringify(m));
  } catch (e) {}
}

// === Canvas ===
const NODE_TYPES = {
  start:      { color: '#2ea043', icon: '▶', label: '시작', svg: '<svg width="14" height="14" viewBox="0 0 14 14" fill="#fff"><path d="M3 1l10 6-10 6z"/></svg>' },
  process:    { color: '#1f6feb', icon: '▢', label: '프로세스', svg: '<svg width="14" height="14" viewBox="0 0 14 14" fill="#fff"><rect x="2" y="2" width="10" height="10" rx="2"/></svg>' },
  decision:   { color: '#d29922', icon: '◇', label: '판단', svg: '<svg width="14" height="14" viewBox="0 0 14 14" fill="#fff"><path d="M7 1l6 6-6 6-6-6z"/></svg>' },
  approval:   { color: '#b45f06', icon: '⏸', label: '승인', svg: '<svg width="14" height="14" viewBox="0 0 14 14" fill="#fff"><rect x="2" y="2" width="3.5" height="10" rx="1"/><rect x="8.5" y="2" width="3.5" height="10" rx="1"/></svg>' },
  supervisor: { color: '#8957e5', icon: '§', label: '감독', svg: '<svg width="14" height="14" viewBox="0 0 14 14" fill="#fff"><path d="M7 1l6 3v6l-6 3-6-3V4z"/><circle cx="7" cy="7" r="2"/></svg>' },
  reviewer:   { color: '#0d9488', icon: '✓', label: '검토', svg: '<svg width="14" height="14" viewBox="0 0 14 14" fill="#fff"><path d="M1 7l4 4 8-9"/><path d="M1 7l4 4 8-9" stroke="#0d9488" stroke-width="2" fill="none"/></svg>' },
  connector:  { color: '#f78166', icon: '⇄', label: '연결', svg: '<svg width="14" height="14" viewBox="0 0 14 14" fill="#fff"><path d="M2 4l5-2 5 2-5 2z"/><path d="M2 7l5-2 5 2-5 2z"/><path d="M2 10l5-2 5 2-5 2z"/></svg>' },
  vote:       { color: '#e26dd4', icon: '🗳', label: '투표', svg: '<svg width="14" height="14" viewBox="0 0 14 14" fill="#fff"><path d="M2 2h10v10H2z"/><path d="M4 7l2 2 4-4" stroke="#e26dd4" stroke-width="2" fill="none"/></svg>' },
  end:        { color: '#d1242f', icon: '●', label: '종료', svg: '<svg width="14" height="14" viewBox="0 0 14 14" fill="#fff"><circle cx="7" cy="7" r="5"/></svg>' }
};
let selected = { type: null, id: null };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// 노드 순번 — 타입별 인덱스
let indexCounter = {};
function nIndex(n) {
  if (n.type === 'start' || n.type === 'end') return '';
  if (!indexCounter[n.type]) indexCounter[n.type] = 0;
  indexCounter[n.type]++;
  return indexCounter[n.type];
}
// 3: 노드 hover 툴팁 — 예상 비용/시간 + 타입 설명
function nodeTooltip(n) {
  const t = NODE_TYPES[n.type];
  const est = n.type === 'decision' ? '~2s · LLM 1회' : n.type === 'approval' ? '~5s · 승인 대기' :
    n.type === 'reviewer' ? '~1.5s · 검증' : n.action ? '~1s · 스크립트' : '~0.3s';
  return '<strong>' + (t ? t.label : n.type) + '</strong> — ' + (n.label || '') + '<br>' +
    '<span style="font-size:11px;color:var(--panel-text-dim)">예상: ' + est + '</span>';
}
// 툴팁 강제 제거 — DOM 재생성 시 잔상 방지
function removeNodeTooltip() {
  const tt = document.getElementById('node-tooltip');
  if (tt) tt.remove();
}
// 선택 노드 플로팅 액션 바
function renderFloatingBar() {
  const old = document.getElementById('floating-bar');
  if (old) old.remove();
  if (!selected || selected.type !== 'node') return;
  const wf = currentWorkflow();
  const n = wf.nodes.find(x => x.id === selected.id);
  if (!n) return;
  const el = document.getElementById('canvas').querySelector('[data-id="' + n.id + '"]');
  if (!el) return;
  const r = el.getBoundingClientRect();
  const bar = document.createElement('div');
  bar.id = 'floating-bar';
  bar.style.cssText = 'position:fixed;top:' + Math.max(8, r.top - 38) + 'px;left:' + r.left + 'px;z-index:95;display:flex;gap:4px;background:var(--dark-2);border:1px solid var(--dark-border);border-radius:10px;padding:4px;box-shadow:0 4px 16px rgba(0,0,0,.35)';
  const btns = [
    ['▶', '실행', () => { if (runState && runState.running) stopRun(); else startRun(); }],
    ['⧉', '복제', () => { duplicateNode(n.id); }],
    ['🗑', '삭제', () => { removeNode(n.id); }],
    ['🔗', '연결', () => { connectFrom = n.id; toast('연결할 대상 노드를 클릭하세요'); }],
    ['⬆', '상태', () => { cycleNodeStatus(n); }],
    ['📁', '접기', () => { n.collapsed = !n.collapsed; saveStore(); renderCanvas(); renderFloatingBar(); }]
  ];
  bar.innerHTML = btns.map(([icon, label, _]) =>
    '<button class="fb-btn" data-label="' + label + '" style="display:flex;flex-direction:column;align-items:center;gap:1px;padding:4px 8px;background:transparent;border:none;border-radius:8px;color:var(--panel-text);font-size:14px;cursor:pointer;min-width:40px">' + icon +
    '<span style="font-size:9px;color:var(--panel-text-faint)">' + label + '</span></button>').join('');
  document.body.appendChild(bar);
  bar.querySelectorAll('.fb-btn').forEach((b, i) => {
    b.addEventListener('click', (e) => { e.stopPropagation(); btns[i][2](); });
  });
}
function duplicateNode(id) {
  const wf = currentWorkflow();
  const n = wf.nodes.find(x => x.id === id);
  if (!n) return;
  const cp = JSON.parse(JSON.stringify(n));
  cp.id = 'n_' + Date.now().toString(36);
  cp.x += 40; cp.y += 40;
  wf.nodes.push(cp);
  pushHistory(); saveStore(); renderAll();
  selected = { type: 'node', id: cp.id };
  renderInspector();
  toast('⧉ 노드 복제');
}
function removeNode(id) {
  const wf = currentWorkflow();
  wf.nodes = wf.nodes.filter(x => x.id !== id);
  wf.edges = wf.edges.filter(e => e.from !== id && e.to !== id);
  pushHistory(); saveStore(); renderAll();
  selected = null;
  toast('🗑 노드 삭제');
}
// 서버 템플릿 로드 — DB wf_workflows에서 가져와 설치
async function loadTplFromServer(wfId) {
  try {
    const r = await fetch(API_BASE + '/api/workflows');
    if (!r.ok) { toast('템플릿 로드 실패 (서버 오류 ' + r.status + ')'); return; }
    const j = await r.json();
    const wf = (j.workflows || []).find(w => w.id === wfId);
    if (!wf) { toast('템플릿 로드 실패'); return; }
    const dr = await fetch(API_BASE + '/api/workflows/' + wfId);
    if (!dr.ok) { toast('템플릿 로드 실패 (서버 오류 ' + dr.status + ')'); return; }
    const detail = await dr.json();
    // 내용이 없는 응답을 성공으로 포장하지 않는다 — 빈 템플릿 설치 방지
    const raw = detail.workflow && detail.workflow.data;
    if (!raw) { toast('템플릿 로드 실패 (내용 없음)'); return; }
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(data.nodes) || data.nodes.length === 0) { toast('템플릿 로드 실패 (노드 없음)'); return; }
    const id = wfId + '_' + Date.now().toString(36);
    const copy = { id, name: wf.name, nodes: (data.nodes || []).map(n => ({ ...n })), edges: (data.edges || []).map(e => ({ ...e })) };
    store.workflows.push(copy);
    store.activeWorkflowId = id;
    saveStore(true); renderAll();
    toast('✅ 템플릿 설치: ' + wf.name);
  } catch (e) { toast('템플릿 로드 실패 (서버 필요)'); }
}
// 노드 팔레트 — 드래그 앤 드롭으로 노드 생성
const PALETTE_TYPES = [
  ['start', '시작'], ['process', '처리'], ['decision', '판단'], ['approval', '승인'],
  ['supervisor', '감독'], ['reviewer', '검토'], ['connector', '연결'], ['vote', '투표'], ['end', '종료']
];
function renderPalette() {
  const wrap = document.getElementById('palette-items');
  if (!wrap) return;
  wrap.innerHTML = PALETTE_TYPES.map(([t, label]) => {
    const conf = NODE_TYPES[t];
    return '<div class="palette-item" data-type="' + t + '" draggable="true" style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;cursor:grab;font-size:12px;color:var(--panel-text)">' +
      '<span style="width:10px;height:10px;border-radius:50%;background:' + (conf ? conf.color : '#888') + '"></span>' +
      '<span>' + label + '</span></div>';
  }).join('');
  wrap.querySelectorAll('.palette-item').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', el.dataset.type);
      el.style.opacity = '.5';
    });
    el.addEventListener('dragend', () => { el.style.opacity = '1'; });
  });
}
// 캔버스 드롭 — 팔레트에서 놓은 노드 생성
// 스페이스바 팬 — 스페이스 누른 채 드래그로 캔버스 이동
let panMode = false, panStart2 = null;
// 마퀴 선택 — 캔버스 빈 곳 드래그로 다중 선택
let marquee = null;
let marqueeActive = false;
function setupMarquee() {
  // 영역 지정(마퀴) 기능 제거됨 — 사용자 요청 (2026-08-15)
  return;
  const cw = document.getElementById('canvas-wrap');
  if (!cw || cw.dataset.mqReady) return;
  cw.dataset.mqReady = '1';
  cw.addEventListener('mousedown', (e) => {
    if (e.target.closest('.node') || e.target.closest('.nport') || e.target.closest('#edges')) return;
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
    marquee = { x: e.clientX, y: e.clientY };
    marqueeActive = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (!marquee) return;
    const dx = e.clientX - marquee.x, dy = e.clientY - marquee.y;
    if (!marqueeActive) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      marqueeActive = true;
    }
    const el = document.getElementById('marquee-box');
    const x = Math.min(marquee.x, e.clientX), y = Math.min(marquee.y, e.clientY);
    const w = Math.abs(dx), h = Math.abs(dy);
    if (!el) {
      const d = document.createElement('div');
      d.id = 'marquee-box';
      d.style.cssText = 'position:fixed;z-index:80;border:1px dashed var(--accent);background:rgba(0,255,135,.08);pointer-events:none';
      document.body.appendChild(d);
    }
    const box = document.getElementById('marquee-box');
    box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.width = w + 'px'; box.style.height = h + 'px';
  });
  window.addEventListener('mouseup', (e) => {
    const box = document.getElementById('marquee-box');
    if (!box || !marquee) return;
    const bx = parseFloat(box.style.left), by = parseFloat(box.style.top);
    const bw = parseFloat(box.style.width), bh = parseFloat(box.style.height);
    box.remove();
    if (!marqueeActive) { marquee = null; return; }
    if (bw < 8 || bh < 8) { marquee = null; return; }
    // 노드와 겹치는지 판정
    const wf = currentWorkflow();
    const canvas = document.getElementById('canvas');
    const cr = canvas.getBoundingClientRect();
    wf.nodes.forEach(n => {
      const nx = cr.left + n.x + panX, ny = cr.top + n.y + panY;
      if (nx >= bx && nx <= bx + bw && ny >= by && ny <= by + bh) {
        multiSelect.add(n.id);
      }
    });
    renderCanvas();
    marquee = null;
  });
}
// 노드 복사/붙여넣기 (Ctrl+C / Ctrl+V)
let clipboardNodes = [];
function copySelectedNodes() {
  const wf = currentWorkflow();
  if (!wf) return;
  const ids = multiSelect.size ? [...multiSelect] : (selected && selected.type === 'node' ? [selected.id] : []);
  if (!ids.length) return;
  clipboardNodes = ids.map(id => {
    const n = wf.nodes.find(x => x.id === id);
    return n ? JSON.parse(JSON.stringify(n)) : null;
  }).filter(Boolean);
  toast('⧉ 복사: ' + clipboardNodes.length + '개 노드');
}
function pasteNodes() {
  const wf = currentWorkflow();
  if (!wf || !clipboardNodes.length) return;
  const idMap = {};
  const newNodes = clipboardNodes.map(n => {
    const nid = 'n_' + Date.now().toString(36) + Math.floor(Math.random() * 100);
    idMap[n.id] = nid;
    return { ...JSON.parse(JSON.stringify(n)), id: nid, x: n.x + 60, y: n.y + 60, _result: undefined };
  });
  wf.nodes.push(...newNodes);
  // 내부 엣지 복사
  clipboardNodes.forEach(n => {
    wf.edges.filter(e => e.from === n.id).forEach(e => {
      if (idMap[e.to]) wf.edges.push({ id: 'e_' + Date.now().toString(36), from: idMap[e.from], to: idMap[e.to], label: e.label });
    });
  });
  multiSelect = new Set(newNodes.map(n => n.id));
  pushHistory(); saveStore(); renderAll();
  toast('📋 붙여넣기: ' + newNodes.length + '개 노드');
}
