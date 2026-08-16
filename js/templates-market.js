async function loadTemplates() {
  try {
    const r = await fetch(API_BASE + '/api/templates');
    const j = await r.json();
    return j.success ? (j.templates || []) : [];
  } catch (e) { return []; }
}
async function renderMarket() {
  const body = document.getElementById('market-body');
  const tpls = await loadTemplates();
  body.innerHTML = tpls.length === 0
    ? '<span style="color:var(--panel-text-faint)">게시된 템플릿 없음 — 현재 워크플로우를 게시해보세요</span>'
    : tpls.map(t => '<div style="padding:10px;margin-bottom:8px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:10px">' +
      '<div style="display:flex;justify-content:space-between"><strong>' + escapeHtml(t.name) + '</strong>' +
      '<span style="color:var(--panel-text-faint);font-size:10px">' + escapeHtml(t.category || '') + '</span></div>' +
      '<div style="font-size:11px;color:var(--panel-text-dim);margin:4px 0">' + escapeHtml(t.description || '') + '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
      '<span style="font-size:10px;color:var(--panel-text-faint)">⬇ ' + (t.installs || 0) + ' · ★ ' + (t.rating || 0) + '</span>' +
      '<button class="tb-action tpl-install" data-id="' + escapeHtml(t.id) + '" style="padding:3px 10px;font-size:11px">설치</button></div></div>').join('');
  body.querySelectorAll('.tpl-install').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      try {
        const r = await fetch(API_BASE + '/api/templates/' + id + '/install', { method: 'POST' });
        const j = await r.json();
        if (j.success && j.data) {
          store.workflows.push({ id: 'wf_' + Date.now().toString(36), name: '템플릿: ' + (j.data.name || id), nodes: j.data.nodes || [], edges: j.data.edges || [] });
          store.activeWorkflowId = store.workflows[store.workflows.length - 1].id;
          saveStore(); renderAll(); toast('템플릿 설치 완료');
          renderMarket();
        }
      } catch (e) { toast('설치 실패'); }
    });
  });
}
async function publishTemplate() {
  const wf = currentWorkflow();
  if (!wf) { toast('워크플로우 없음'); return; }
  toastHTML('<div style="min-width:320px"><strong style="display:block;margin-bottom:10px;color:var(--accent)">템플릿 게시</strong>' +
    '<input id="tpl-name" placeholder="템플릿 이름" value="' + escapeHtml(wf.name) + '" style="width:100%;padding:8px;margin-bottom:6px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text)"><br>' +
    '<input id="tpl-desc" placeholder="설명" style="width:100%;padding:8px;margin-bottom:6px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text)"><br>' +
    '<input id="tpl-cat" placeholder="카테고리 (예: 데이터)" style="width:100%;padding:8px;margin-bottom:10px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text)"><br>' +
    '<button id="tpl-save" class="tb-action" style="width:100%">게시</button></div>', 60000);
  document.querySelector('#tpl-save').addEventListener('click', async () => {
    const id = 'tpl_' + Date.now().toString(36);
    await fetch(API_BASE + '/api/templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id, name: document.querySelector('#tpl-name').value.trim() || wf.name,
        description: document.querySelector('#tpl-desc').value.trim(),
        category: document.querySelector('#tpl-cat').value.trim(),
        tags: [], data: { name: wf.name, nodes: wf.nodes, edges: wf.edges },
      }),
    }).catch(() => {});
    document.querySelectorAll('.toast').forEach(t => t.remove());
    toast('템플릿 게시됨');
    renderMarket();
  });
}
// 감사 로그 조회 (실행 시 기록은 서버에서)
async function logAudit(resource, action, detail) {
  try {
    await fetch(API_BASE + '/api/audit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: 'me', agent_id: '', resource, action, detail }),
    }).catch(() => {});
  } catch (e) {}
}

// ═══ 5차: Agent UX + 모니터링 모듈 ═══
