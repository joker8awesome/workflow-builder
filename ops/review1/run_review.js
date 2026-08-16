#!/usr/bin/env node
// 지시서 #29 — 1차 배치 12개 코드리뷰
// 함수 하나당 워커 호출 1회, 결과를 ops/review1/results.json 에 저장

const fs = require('fs');
const path = require('path');

// 키를 여기에 적지 마라 — 이 파일은 공개 저장소에 올라간다.
const KEY = process.env.WF_HERMES_KEY || '';
if (!KEY) { console.error('WF_HERMES_KEY 가 설정돼 있지 않다. export 후 다시 실행해라.'); process.exit(2); }
const URL = 'http://127.0.0.1:3737/api/llm/worker';
const TRACE = 'fleet-review1-20260816';
const OUT = path.join(__dirname, 'results.json');

// 12개 함수 (파일, 이름, 코드, 맥락)
const TARGETS = [
  { file: 'js/core-store.js', name: 'syncToServer', ctx: '서버에 워크플로우를 올린다. 네트워크가 끊기면?', code: `let syncTimer = null;
function syncToServer() {
  if (!serverOnline) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      for (const wf of store.workflows) {
        await fetch(API_BASE + '/api/workflows/' + encodeURIComponent(wf.id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: wf.name, data: { nodes: wf.nodes, edges: wf.edges } }),
        });
      }
    } catch (e) { console.warn('server sync failed', e); queueOfflineSync(); }
  }, 800);
}` },
  { file: 'js/core-store.js', name: 'queueOfflineSync', ctx: '오프라인일 때 큐에 쌓는다. 큐가 유실되면?', code: `let offlineQueue = [];
function queueOfflineSync() {
  try { offlineQueue = JSON.parse(localStorage.getItem(LS_KEY + '_offline') || '[]'); } catch (e) { offlineQueue = []; }
  const wf = currentWorkflow();
  if (wf && !serverOnline) {
    offlineQueue.push({ wfId: wf.id, ts: Date.now() });
    localStorage.setItem(LS_KEY + '_offline', JSON.stringify(offlineQueue.slice(-50)));
  }
}` },
  { file: 'js/core-store.js', name: 'flushOfflineQueue', ctx: '온라인 복귀 시 큐를 비운다. 중간에 하나가 실패하면 나머지는?', code: `function flushOfflineQueue() {
  if (!serverOnline) return;
  try { offlineQueue = JSON.parse(localStorage.getItem(LS_KEY + '_offline') || '[]'); } catch (e) { offlineQueue = []; }
  if (offlineQueue.length > 0) {
    const wf = currentWorkflow();
    if (wf) syncToServer();
    localStorage.removeItem(LS_KEY + '_offline');
    console.log('오프라인 편집 ' + offlineQueue.length + '건 동기화');
    toast('오프라인 편집 ' + offlineQueue.length + '건 동기화됨');
  }
}` },
  { file: 'js/core-store.js', name: 'saveStore', ctx: 'localStorage 에 쓴다. 용량 초과나 예외가 나면?', code: `let saveTimer = null;
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
}` },
  { file: 'js/core-store.js', name: 'loadStore', ctx: 'localStorage 에서 읽는다. 값이 깨져 있으면?', code: `function loadStore() {
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
}` },
  { file: 'js/core-store.js', name: 'recordVersionDebounced', ctx: '버전을 지연 기록한다. 지연 중에 페이지를 닫으면?', code: `let verTimer = null;
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
}` },
  { file: 'js/undo-run-engine.js', name: 'snapshotState', ctx: '현재 상태를 복제한다. 얕은 복사면 어떻게 되나?', code: `function snapshotState() {
  return JSON.stringify({ workflows: store.workflows, activeWorkflowId: store.activeWorkflowId });
}` },
  { file: 'js/undo-run-engine.js', name: 'pushHistory', ctx: '히스토리에 쌓는다. 무한히 쌓이면?', code: `let undoStack = [], redoStack = [];
const MAX_HISTORY = 50;
function pushHistory() {
  undoStack.push(snapshotState());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
}` },
  { file: 'js/undo-run-engine.js', name: 'undo', ctx: '되돌린다. 히스토리가 비었을 때는?', code: `function undo() {
  if (undoStack.length === 0) { toast('되돌릴 작업 없음'); return; }
  redoStack.push(snapshotState());
  const prev = JSON.parse(undoStack.pop());
  store.workflows = prev.workflows; store.activeWorkflowId = prev.activeWorkflowId;
  afterHistory();
}` },
  { file: 'js/undo-run-engine.js', name: 'redo', ctx: '다시 한다. undo 후 새 편집을 하면 redo 스택은?', code: `function redo() {
  if (redoStack.length === 0) { toast('다시 실행할 작업 없음'); return; }
  undoStack.push(snapshotState());
  const next = JSON.parse(redoStack.pop());
  store.workflows = next.workflows; store.activeWorkflowId = next.activeWorkflowId;
  afterHistory();
}` },
  { file: 'js/undo-run-engine.js', name: 'afterHistory', ctx: '되돌린 뒤 후처리. 여기서 실패하면 상태가 어긋나나?', code: `function afterHistory() {
  const wf = currentWorkflow();
  if (wf) document.getElementById('wf-name').value = wf.name;
  renderAll(); saveStore(true);
}` },
  { file: 'js/undo-run-engine.js', name: 'deleteMulti', ctx: '여러 노드를 지운다. 스냅샷을 언제 찍나 — 지우기 전인가 후인가?', code: `let multiSelect = new Set();
function deleteMulti() {
  const wf = currentWorkflow();
  if (!wf || multiSelect.size === 0) return;
  pushHistory();
  const ids = new Set(multiSelect);
  wf.nodes = wf.nodes.filter(n => !ids.has(n.id));
  wf.edges = wf.edges.filter(e => !ids.has(e.from) && !ids.has(e.to));
  multiSelect.clear();
  saveStore(true); renderAll();
}` },
];

function buildPrompt(t) {
  return `아래는 ${t.file} 의 함수다.

${t.code}

맥락: ${t.ctx}

이 함수가 조용히 실패할 수 있는 지점을 한 문단으로 지적하라.
그런 지점이 없으면 "문제 없음"이라고만 답하라.

위 코드에 없는 함수·변수·파일은 언급하지 마라.
확실하지 않으면 "확실하지 않음"이라고 답하라. 추측하지 마라.`;
}

async function callWorker(t) {
  const prompt = buildPrompt(t);
  const started = Date.now();
  const r = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + KEY,
    },
    body: JSON.stringify({
      prompt,
      agent_id: 'ag_hermes',
      trace_id: TRACE,
      report_to: 'ag_hermes',
      system: '당신은 커멘드센터의 코드 리뷰 워커입니다. 주어진 함수 본문만 보고 조용히 실패할 수 있는 지점(silent failure)을 짚습니다. 없으면 "문제 없음"만, 확실하지 않으면 "확실하지 않음"만 답합니다. 추측·창작 금지. 코드에 없는 심볼 언급 금지.',
    }),
  });
  const j = await r.json().catch(() => ({}));
  const elapsed = Date.now() - started;
  return {
    file: t.file,
    name: t.name,
    ctx: t.ctx,
    prompt_chars: prompt.length,
    http_status: r.status,
    ok: !!j.success,
    result: j.result || null,
    error: j.success ? null : (j.error || 'unknown'),
    detail: j.detail || null,
    elapsed_ms: elapsed,
    // 800토큰 근접 여부: result 문자열이 잘렸을 가능성 힌트 (문장 종결 없이 끝나는 경우)
    likely_truncated: !!(j.result && j.result.length > 1400) && !/[.。!?]\s*$/.test((j.result || '').trim()),
  };
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  console.log(`총 ${TARGETS.length}개 함수 리뷰 시작 (rate: 4s 간격)`);
  const results = [];
  for (let i = 0; i < TARGETS.length; i++) {
    const t = TARGETS[i];
    process.stdout.write(`[${i+1}/${TARGETS.length}] ${t.file} :: ${t.name} ... `);
    try {
      const res = await callWorker(t);
      results.push(res);
      const status = res.ok ? 'OK' : `FAIL(${res.http_status})`;
      const preview = (res.result || res.error || '').slice(0, 60).replace(/\n/g, ' ');
      console.log(`${status} · ${res.elapsed_ms}ms · ${preview}`);
    } catch (e) {
      const err = { file: t.file, name: t.name, ok: false, error: e.message, exception: true };
      results.push(err);
      console.log(`EXCEPTION · ${e.message}`);
    }
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    if (i < TARGETS.length - 1) await sleep(4000);
  }
  console.log(`\n완료 → ${OUT}`);
  const okCount = results.filter(r => r.ok).length;
  const noneCount = results.filter(r => r.ok && /^문제\s*없음/.test((r.result || '').trim())).length;
  const notSure = results.filter(r => r.ok && /확실하지\s*않음/.test((r.result || '').trim())).length;
  const truncCount = results.filter(r => r.likely_truncated).length;
  console.log(`OK ${okCount}/${results.length} · "문제 없음" ${noneCount} · "확실하지 않음" ${notSure} · 절단 의심 ${truncCount}`);
})();
