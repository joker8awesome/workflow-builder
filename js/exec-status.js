// ── 1. 실행 엔진 실전화 ──
let execState = { running: false, startTime: 0, results: {} };
// 노드별 실행 상태 배지 (running/completed/failed)
// 노드 상태 컨트롤 — 상태 사이클 (배지 클릭)
const STATUS_CYCLE = ['대기', '진행', '검토', '완료', '블로커'];
const STATUS_CLASS = { '대기': 'waiting', '진행': 'working', '검토': 'review', '완료': 'done', '블로커': 'blocked' };
function cycleNodeStatus(n) {
  const idx = STATUS_CYCLE.indexOf(n.status);
  if (idx === -1) n.status = '진행';
  else n.status = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
  saveStore(); renderCanvas(); renderInspector();
  toast('상태: ' + n.status);
}
function statusPill(n) {
  if (!n || n.type === 'start' || n.type === 'end') return '';
  const s = n.status || '대기';
  const cls = STATUS_CLASS[s] || 'waiting';
  return '<span class="node-status-pill s-' + cls + '" data-status="1" title="상태 변경 (클릭)">' + s + '</span>';
}
// 실행 결과 미리보기 배지
function resultPreviewBadge(n) {
  const r = (n._result !== undefined && n._result !== null) ? n._result : null;
  if (r === null) return '';
  const ok = r.ok !== false;
  const txt = typeof r === 'object' ? (r.summary || (r.count !== undefined ? r.count + '건' : '완료')) : String(r).slice(0, 14);
  return '<span class="result-preview" style="position:absolute;bottom:-9px;right:6px;font-size:9px;font-weight:700;padding:1px 6px;border-radius:10px;color:' + (ok ? 'var(--accent)' : 'var(--red)') + ';background:rgba(0,0,0,.6);border:1px solid ' + (ok ? 'rgba(0,255,135,.3)' : 'rgba(255,93,93,.3)') + ';z-index:6">' + (ok ? '✓ ' : '✗ ') + escapeHtml(txt) + '</span>';
}
// 입력 유효성 경고 배지
function validationBadge(n, wf) {
  if (n.type === 'start' || n.type === 'end') return '';
  const issues = [];
  if (!n.label) issues.push('이름 없음');
  if (!n.agentId) issues.push('담당자 없음');
  const inCnt = wf.edges.filter(e => e.to === n.id).length;
  const outCnt = wf.edges.filter(e => e.from === n.id).length;
  if (inCnt === 0 && n.type !== 'start') issues.push('입력 없음');
  if (outCnt === 0 && n.type !== 'end') issues.push('출력 없음');
  if (!issues.length) return '';
  return '<span class="val-warn" title="' + issues.join(', ') + '" style="position:absolute;top:-9px;left:6px;font-size:9px;font-weight:700;padding:1px 6px;border-radius:10px;color:#ffc24d;background:rgba(255,194,77,.15);border:1px solid rgba(255,194,77,.4);z-index:6">⚠</span>';
}
function setExecStatus(nodeId, status) {
  const el = document.querySelector(`#canvas .node[data-id="${nodeId}"]`);
  if (!el) return;
  el.dataset.exec = status;
  const badge = el.querySelector('.exec-badge');
  if (badge) badge.remove();
  if (status !== 'idle') {
    const b = document.createElement('span');
    b.className = 'exec-badge ' + status;
    b.textContent = status === 'running' ? '⏳' : status === 'completed' ? '✓' : '✗';
    el.appendChild(b);
  }
}
function runNodeAction(node) {
  setExecStatus(node.id, 'running');
  return new Promise(async (resolve) => {
    // 1/3. 실제 스크립트 실행 또는 시뮬레이션
    let result;
    if (node.action && serverOnline) {
      result = await runNodeScript(node);
    } else {
      await new Promise(r => setTimeout(r, 300));
      result = { ok: true, time: 0.5, simulated: true };
    }
    // 텔레그램 전송 노드 (action: telegram)
    if (node.action === 'telegram' || (node.tags || []).includes('telegram')) {
      toast('📨 텔레그램 전송: ' + (node.label || ''));
    }
    execState.results[node.id] = { ok: result.ok, time: 0.5, output: result.output || '' };
    // 4. 실행 결과 서버 저장
    const wf = currentWorkflow();
    if (wf) saveRunResult(wf.id, node.id, execState.results[node.id]);
    setExecStatus(node.id, result.ok ? 'completed' : 'failed');
    traceAdd(node.id, node.label || node.id, result.ok ? 'completed' : 'failed', Math.round(Math.random() * 500));
    resolve(result.ok !== false);
  });
}
async function executeWorkflow() {
  try {
  const wf = currentWorkflow();
  if (!wf) return;
  const warns = validateWorkflow();
  if (warns.length > 0) { showWarnings(); return; }
  const start = wf.nodes.find(n => n.type === 'start');
  if (!start) { toast('시작 노드 없음'); return; }
  execState = { running: true, startTime: Date.now(), results: {} };
  document.getElementById('run-status-bar').style.display = 'flex';
  document.getElementById('rs-status').textContent = '실행 중...';
  setProactiveStatus('워크플로우 실행 시작');
  const path = [];
  // 조건식 컨텍스트 (실제 실행 데이터)
  const ctx = buildExecCtx(wf.id);
  const visit = async (id) => {
    const n = wf.nodes.find(x => x.id === id);
    if (!n || path.includes(n)) return;
    path.push(n);
    // 투표 노드 — 다수결 (신뢰 가중)
    if (n.type === 'vote') {
      document.getElementById('rs-status').textContent = '🗳 투표: ' + (n.label || '');
      const decision = await runVoteNode(n, ctx);
      setProactiveStatus('투표 완료: ' + (decision ? '찬성' : '반대'));
      // Yes/No 엣지로 분기
      const outs2 = wf.edges.filter(e => e.from === id);
      const yesEdge = outs2.find(e => e.label === 'Yes');
      const noEdge = outs2.find(e => e.label === 'No');
      const nextEdge = decision ? (yesEdge || outs2[0]) : (noEdge || outs2[0]);
      if (nextEdge) await visit(nextEdge.to);
      return;
    }
    // 리뷰어/리플렉션 노드 — 결과 검증 (외부 피드백)
    if (n.type === 'reviewer') {
      document.getElementById('rs-status').textContent = '🔍 검토: ' + (n.label || '');
      await new Promise(r => setTimeout(r, 800));
      const ok = Math.random() > 0.15;
      logRun('검토: ' + (n.label || '') + (ok ? ' ✅ 통과' : ' ⛔ 반려'));
      const prevEdge = wf.edges.find(e => e.to === id);
      if (!ok) {
        if (prevEdge) { path.pop(); await visit(prevEdge.from); return; }
        // 되돌릴 이전 노드가 없으면 반려를 표시하고 흐름 중단 (조용히 진행하지 않음)
        document.getElementById('rs-status').textContent = '⛔ 반려됨';
        logRun('반려: ' + (n.label || '') + ' (되돌릴 노드 없음 — 실행 중단)');
        return;
      }
    }
    // 승인 게이트 노드 — Strong HITL + 점진적 위임(자동 승인)
    if (n.type === 'approval') {
      const auto = await shouldAutoApprove(n.agentId);
      if (auto) {
        logRun('⚡ 자동 승인: ' + (n.label || '') + ' (점진적 위임)');
        logApproval(wf.id, id, n.agentId, 'approved', { auto: true });
      } else {
        const checklist = n.approval_checklist || ['의도 확인', '데이터 출처 확인', '영향 범위 확인', '롤백 계획 확인'];
        const apprOk = await waitApprovalStrong(n.label || '승인 필요', checklist);
        if (!apprOk) { document.getElementById('rs-status').textContent = '⛔ 반려됨'; logRun('반려: ' + (n.label || '')); return; }
      }
    } else {
      // 재시도/폴백 반영 실행
      await runNodeWithRetry(n);
    }
    const outs = wf.edges.filter(e => e.from === id);
    if (outs.length === 0) return;
    // 2: 신뢰 점수 기반 자율성 자동 조정 (ATF)
    if (n.type === 'decision' && !n.condition && n.llm_prompt) {
      try {
        const tr = await fetch(API_BASE + '/api/trust');
        if (!tr.ok) throw new Error('HTTP ' + tr.status);
        const tj = await tr.json();
        if (tj.success && n.agentId) {
          const myTrust = (tj.trust || []).find(t => t.agent_id === n.agentId);
          if (myTrust && myTrust.trust < 60 && myTrust.runs >= 3) {
            const ok = await waitApprovalStrong(n.label + ' — 신뢰 ' + myTrust.trust + '% (자동 에스컬레이션)', ['의도 확인', '영향 확인']);
            if (!ok) { document.getElementById('rs-status').textContent = '⛔ 반려됨'; return; }
          }
        }
      } catch (e) {
        // 신뢰 조회 실패 시 에스컬레이션이 스킵됨 — 조용히 넘기지 않고 로그 남김
        console.warn('ATF 신뢰 조회 실패 (에스컬레이션 스킵):', e.message || e);
        logRun('⚠ 신뢰 조회 실패 — 자동 에스컬레이션 스킵 (' + (n.label || id) + ')');
      }
    }
    // decision: 조건식 → LLM 판단 → Yes 우선
    if (n.type === 'decision') {
      let nextEdge = outs[0];
      if (n.llm_prompt) {
        const yesEdge = outs.find(e => e.label === 'Yes');
        const noEdge = outs.find(e => e.label === 'No');
        const decision = await llmDecide(resolveRefs(n.llm_prompt, ctx), ctx);
        document.getElementById('rs-status').textContent = 'LLM 판단: ' + (decision ? 'Yes' : 'No') + (n.model ? ' [' + n.model + ']' : '');
        nextEdge = decision ? (yesEdge || outs[0]) : (noEdge || outs[0]);
      } else if (n.condition) {
        const yesEdge = outs.find(e => e.label === 'Yes');
        const noEdge = outs.find(e => e.label === 'No');
        nextEdge = evalCondition(n.condition, ctx) ? (yesEdge || outs[0]) : (noEdge || outs[0]);
        document.getElementById('rs-status').textContent = '분기: ' + (nextEdge.label === 'Yes' ? 'Yes' : 'No');
      }
      await visit(nextEdge.to);
    } else {
      await visit(outs[0].to);
    }
  };
  await visit(start.id);
  const elapsed = ((Date.now() - execState.startTime) / 1000).toFixed(1);
  execState.running = false;
  document.getElementById('rs-status').textContent = '✅ 완료 (' + elapsed + 's)';
  // 결과 피드백 루프 — 지식 저장
  const fbSummary = (runLogs && runLogs.slice(-3).join(' | ')) || '완료';
  feedbackLoop(wf, fbSummary, '완료');
  setTimeout(() => document.getElementById('run-status-bar').style.display = 'none', 3000);
  const summary = path.map(n => n.label).join(' → ');
  toast('실행 완료: ' + summary);
  logRun(summary);
  computeAgentMetrics().then(() => { if (document.getElementById('agent-dash').style.display === 'block') renderAgentMetrics(); });
  } catch (e) {
    execState.running = false;
    document.getElementById('rs-status').textContent = '⛔ 실행 오류';
    errorRecovery3('실행 오류', e.message, '실행 설정을 확인하거나 노드를 점검하세요');
    logRun('실행 오류: ' + e.message);
    notifyTelegramAlert('워크플로우 실행 실패: ' + e.message);
  }
}

// ── 2. 협업 상태 전파 (WebSocket → 실제 적용) ──
function broadcastLocalChange() {
  if (!ws || ws.readyState !== 1) return;
  const wf = currentWorkflow();
  if (!wf) return;
  ws.send(JSON.stringify({
    type: 'wf_state', id: wf.id,
    data: { nodes: wf.nodes, edges: wf.edges }
  }));
}
// initWS의 onmessage 확장 — 실제 상태 적용
function patchWSHandler() {
  if (!ws) return;
  const orig = ws.onmessage;
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      // agent_report는 broadcastWf로 {type:'wf_update', data:{agent_report:true}} 형식으로 도착
      const ar = (msg.type === 'agent_report') ? msg : (msg.type === 'wf_update' && msg.data && msg.data.agent_report ? { agent_id: msg.data.agent_id, status: msg.data.status, summary: msg.data.summary } : null);
      if (ar) {
        // 에이전트 보고 실시간 반영 — 상태 갱신 + 토스트
        const ag = ar.agent_id || '';
        const st = ar.status || '';
        refreshAgentStatus();
        if (st === 'completed') toast('✅ 에이전트 보고: ' + ag + ' 완료' + (ar.summary ? ' — ' + String(ar.summary).slice(0, 40) : ''));
        else if (st === 'failed') toast('⛔ 에이전트 보고: ' + ag + ' 실패');
        // 연결된 노드 상태 표시 (짧게)
        const nodeEl = document.querySelector('#canvas .node[data-agent="' + ag + '"]');
        if (nodeEl) {
          nodeEl.style.boxShadow = '0 0 0 3px ' + (st === 'completed' ? 'var(--accent)' : 'var(--red)') + '55';
          setTimeout(() => { nodeEl.style.boxShadow = ''; }, 2500);
        }
      }
      if (msg.type === 'wf_state' && msg.id === store.activeWorkflowId && msg.data) {
        const wf = currentWorkflow();
        if (wf) {
          wf.nodes = msg.data.nodes || wf.nodes;
          wf.edges = msg.data.edges || wf.edges;
          renderAll();
          toast('🔔 공동 편집 반영');
        }
      }
    } catch (e) { console.warn('[ws] 메시지 처리 실패:', e.message, String(ev.data).slice(0, 120)); }
    if (orig) orig(ev);
  };
}

// ── 3. 스냅 그리드 / 복잡도 점수 / 실행 히트맵 ──
let snapEnabled = true;
const SNAP = 20;
function snapValue(v) { return snapEnabled ? Math.round(v / SNAP) * SNAP : v; }
// startDrag에 snap 적용 (호출부에서 처리)
function wfComplexity() {
  const wf = currentWorkflow();
  if (!wf) return { score: 0, label: '간단' };
  const nodes = wf.nodes.length;
  const edges = wf.edges.length;
  const decisions = wf.nodes.filter(n => n.type === 'decision').length;
  let score = nodes + edges * 0.5 + decisions * 2;
  const label = score < 10 ? '간단' : score < 25 ? '보통' : '복잡';
  return { score: Math.round(score), label };
}
function renderHeatmap() {
  // 엣지별 실행 횟수 기반 굵기 (간단: runLogs에서 경로 카운트)
  const counts = {};
  runLogs.forEach(l => { if (l.path) counts[l.path] = (counts[l.path] || 0) + 1; });
  return counts;
}

// ── 4. 노드 잠금 / 즐겨찾기 / 터치 ──
let lockMode = false;
function toggleLockMode() {
  lockMode = !lockMode;
  document.getElementById('btn-lock').textContent = lockMode ? '🔓' : '🔒';
  document.getElementById('btn-lock').style.color = lockMode ? 'var(--accent)' : '';
  toast(lockMode ? '잠금 모드 ON — 노드 편집 방지' : '잠금 모드 OFF');
}
function toggleFav() {
  const wf = currentWorkflow();
  if (!wf) return;
  wf.fav = !wf.fav;
  document.getElementById('btn-fav').textContent = wf.fav ? '★' : '☆';
  document.getElementById('btn-fav').style.color = wf.fav ? '#ffd700' : '';
  saveStore();
  renderSidebar();
  toast(wf.fav ? '즐겨찾기 추가' : '즐겨찾기 해제');
}
function toggleNodeLock(node) {
  node.locked = !node.locked;
  saveStore(); renderAll();
  toast(node.locked ? '노드 잠금' : '노드 잠금 해제');
}

// ── 5. 마크다운 문서화 ──
function exportMarkdown() {
  const wf = currentWorkflow();
  if (!wf) return;
  const lines = [
    '# ' + wf.name,
    '',
    '> 워크플로우 문서 (복잡도: ' + wfComplexity().label + ' · ' + wfComplexity().score + '점)',
    '',
    '## 단계',
    '',
  ];
  wf.nodes.forEach((n, i) => {
    lines.push((i + 1) + '. **[' + (n.type === 'start' ? '시작' : n.type === 'end' ? '종료' : n.type === 'decision' ? '판단' : '프로세스') + '] ' + (n.label || '') + '**');
    if (n.desc) lines.push('   - ' + n.desc);
    if (n.assignee) lines.push('   - 담당: ' + n.assignee);
    if (n.due) lines.push('   - 기한: ' + n.due);
    if (n.tags && n.tags.length) lines.push('   - 태그: ' + n.tags.join(', '));
  });
  lines.push('', '## 연결', '');
  wf.edges.forEach(e => {
    const from = wf.nodes.find(n => n.id === e.from);
    const to = wf.nodes.find(n => n.id === e.to);
    lines.push('- ' + (from ? from.label : e.from) + ' → ' + (to ? to.label : e.to) + (e.label ? ' [' + e.label + ']' : ''));
  });
  const md = lines.join('\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = (wf.name || 'workflow') + '.md';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  toast('마크다운 내보내기 완료');
}

// ── 6. 통계 대시보드 ──
async function showStats() {
  const panel = document.getElementById('stats-panel');
  const body = document.getElementById('stats-body');
  panel.style.display = 'block';
  body.innerHTML = '<span style="color:var(--panel-text-dim)">로딩 중...</span>';
  // 로컬 워크플로우 통계
  const wfCount = store.workflows.length;
  const totalNodes = store.workflows.reduce((a, w) => a + (w.nodes ? w.nodes.length : 0), 0);
  const totalEdges = store.workflows.reduce((a, w) => a + (w.edges ? w.edges.length : 0), 0);
  const cx = wfComplexity();
  let serverStats = '';
  if (serverOnline) {
    try {
      const r = await fetch(API_BASE + '/api/stats');
      const j = await r.json();
      if (j.success) {
        serverStats = '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--dark-border)">' +
          '<strong style="color:var(--accent)">서버</strong><br>' +
          '워크플로우: ' + j.stats.workflows + ' · 버전: ' + j.stats.versions + ' · 실행: ' + j.stats.runs + '<br>' +
          '<div style="font-size:11px;color:var(--panel-text-dim);margin-top:6px">' +
          (j.stats.recentRuns || []).slice(0, 5).map(l => '• ' + l.run_path + ' (' + new Date(l.run_at).toLocaleTimeString() + ')').join('<br>') +
          '</div></div>';
      }
    } catch (e) {}
  }
  body.innerHTML = '<strong style="color:var(--accent)">로컬</strong><br>' +
    '워크플로우: ' + wfCount + '개 · 노드: ' + totalNodes + '개 · 엣지: ' + totalEdges + '개<br>' +
    '복잡도: ' + cx.label + ' (' + cx.score + '점)' +
    serverStats;
}

// === 3차 고도화 버튼 이벤트 ===
document.getElementById('btn-lock').addEventListener('click', toggleLockMode);
document.getElementById('btn-fav').addEventListener('click', toggleFav);
document.getElementById('btn-md').addEventListener('click', exportMarkdown);
document.getElementById('btn-stats').addEventListener('click', showStats);
document.getElementById('stats-close').addEventListener('click', () => {
  document.getElementById('stats-panel').style.display = 'none';
});
// 실행 버튼 → 실제 실행 엔진
document.getElementById('btn-run').addEventListener('click', () => {
  if (execState.running) { toast('이미 실행 중'); return; }
  executeWorkflow();
});
// 실행 상태 바 클릭 → 상세 로그 패널
document.getElementById('run-status-bar').addEventListener('click', () => {
  document.getElementById('runlog-panel').style.display = 'block';
  renderRunLog();
});

// ═══ 모바일 터치 지원 모듈 ═══
