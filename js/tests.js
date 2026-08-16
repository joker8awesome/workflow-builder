// ═══ 테스트 스위트 + 회귀 게이트 모듈 ═══
async function loadTests() {
  const wf = currentWorkflow();
  try {
    const url = wf ? API_BASE + '/api/tests?wf=' + encodeURIComponent(wf.id) : API_BASE + '/api/tests';
    const r = await fetch(url);
    const j = await r.json();
    return j.success ? (j.tests || []) : [];
  } catch (e) { return []; }
}
async function renderTests() {
  const body = document.getElementById('test-body');
  const tests = await loadTests();
  body.innerHTML = tests.length === 0
    ? '<span style="color:var(--panel-text-faint)">테스트 케이스 없음 — 추가해보세요</span>'
    : tests.map(t => {
        const st = t.last_status;
        const color = st === 'pass' ? 'var(--accent)' : st === 'fail' ? '#ff5d5d' : 'var(--panel-text-faint)';
        return '<div style="padding:9px;margin-bottom:6px;background:var(--dark-3);border-radius:8px;display:flex;justify-content:space-between;align-items:center">' +
          '<div><strong>' + escapeHtml(t.name) + '</strong><div style="font-size:10px;color:var(--panel-text-faint)">' + escapeHtml(t.wf_id) + '</div></div>' +
          '<div style="display:flex;align-items:center;gap:8px"><span style="color:' + color + ';font-weight:700">' + (st === 'pass' ? '✅' : st === 'fail' ? '❌' : '·') + ' ' + st + '</span>' +
          '<button class="tb-action test-del" data-id="' + t.id + '" style="padding:2px 6px;font-size:10px;color:#ff5d5d">✕</button></div></div>';
      }).join('');
  body.querySelectorAll('.test-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(API_BASE + '/api/tests/' + btn.dataset.id, { method: 'DELETE' }).catch(() => {});
      renderTests();
    });
  });
}
async function addTest() {
  const wf = currentWorkflow();
  if (!wf) { toast('워크플로우 없음'); return; }
  toastHTML('<div style="min-width:320px"><strong style="display:block;margin-bottom:10px;color:var(--accent)">테스트 케이스 추가</strong>' +
    '<input id="tt-name" placeholder="테스트 이름 (예: 정상 경로)" style="width:100%;padding:8px;margin-bottom:6px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text)"><br>' +
    '<input id="tt-input" placeholder="입력 (JSON, 예: {score:80})" style="width:100%;padding:8px;margin-bottom:6px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text)"><br>' +
    '<input id="tt-expected" placeholder="예상 (JSON, 예: {결과:완료})" style="width:100%;padding:8px;margin-bottom:10px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;color:var(--panel-text)"><br>' +
    '<button id="tt-save" class="tb-action" style="width:100%">저장</button></div>', 60000);
  document.querySelector('#tt-save').addEventListener('click', async () => {
    let input = {}, expected = {};
    try { input = JSON.parse(document.querySelector('#tt-input').value || '{}'); } catch (e) {}
    try { expected = JSON.parse(document.querySelector('#tt-expected').value || '{}'); } catch (e) {}
    await fetch(API_BASE + '/api/tests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wf_id: wf.id, name: document.querySelector('#tt-name').value.trim() || '테스트', input, expected }),
    }).catch(() => {});
    document.querySelectorAll('.toast').forEach(t => t.remove());
    toast('테스트 추가됨'); renderTests();
  });
}
// 회귀 게이트 — 테스트 실행 + 결과 기록 (검증은 오케스트레이터/실행과 연동)
async function runRegressionGate() {
  const wf = currentWorkflow();
  if (!wf) { toast('워크플로우 없음'); return; }
  const tests = await loadTests();
  if (tests.length === 0) { toast('등록된 테스트 케이스가 없습니다. 테스트를 추가한 뒤 다시 실행하세요'); return; }
  toast('회귀 게이트 실행 중...');
  let pass = 0;
  for (const t of tests) {
    // 간단 검증: 오케스트레이터 실행 후 성공 여부
    try {
      const r = await fetch(API_BASE + '/api/exec', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: '/opt/data/projects/workflow-builder/.agentenv/bin/python /opt/data/projects/workflow-builder/agent_orchestrator.py --workflow ' + wf.id + ' --run', agent_id: 'gate' }),
      });
      const j = await r.json();
      const ok = j.success;
      await fetch(API_BASE + '/api/tests/' + t.id + '/result', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: ok ? 'pass' : 'fail' }),
      }).catch(() => {});
      if (ok) pass++;
    } catch (e) {
      await fetch(API_BASE + '/api/tests/' + t.id + '/result', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'fail' }),
      }).catch(() => {});
    }
  }
  toast('회귀 게이트: ' + pass + '/' + tests.length + ' 통과');
  renderTests();
}
function toggleTestPanel() {
  const panel = document.getElementById('test-panel');
  if (togglePanel(panel)) renderTests();
}

// 4. 단축키 도움말 패널
function showShortcutPanel() {
  const cat = (title, rows) => '<div style="margin-bottom:10px"><div style="font-size:11px;color:var(--accent);font-weight:700;margin-bottom:4px">' + title + '</div>' +
    rows.map(([k, v]) => '<div style="display:flex;justify-content:space-between;gap:16px;padding:4px 0;font-size:12px"><span style="color:var(--panel-text-dim);white-space:nowrap">' + k + '</span><span>' + v + '</span></div>').join('') + '</div>';
  toastHTML('<div style="min-width:400px"><strong style="display:block;margin-bottom:10px;color:var(--accent)">⌨️ 단축키 도움말</strong>' +
    cat('✏️ 편집', [['Ctrl+Z / Ctrl+Shift+Z', '실행 취소 / 다시 실행'], ['Ctrl+D', '노드 복제'], ['Ctrl+C / Ctrl+V', '노드 복사 / 붙여넣기'], ['Delete', '선택 삭제']]) +
    cat('🖱️ 선택', [['Shift+클릭', '다중 선택'], ['드래그(빈 곳)', '영역 선택'], ['화살표', '노드 이동 (Shift=크게)']]) +
    cat('▶ 실행', [['Enter (실행모드)', '다음 단계'], ['중간버튼 드래그', '캔버스 이동'], ['스페이스+드래그', '캔버스 이동']]) +
    cat('🔍 보기', [['Ctrl+K', '명령 팔레트'], ['휠', '줌'], ['?', '단축키 도움말']]) +
    '</div>', 10000);
}

// 5. 온보딩 워크스루 — 첫 방문 시 안내
function onboardingTour() {
  try {
    if (localStorage.getItem(LS_KEY + '_onboarded')) return;
    setTimeout(() => {
      let ob = document.getElementById('onboard-card');
      if (!ob) {
        ob = document.createElement('div');
        ob.id = 'onboard-card';
        ob.style.cssText = 'position:fixed;top:64px;right:16px;z-index:110;background:var(--dark-2);border:1px solid var(--dark-border);border-radius:16px;padding:16px 20px;width:300px;box-shadow:0 10px 32px rgba(0,0,0,.4)';
        document.body.appendChild(ob);
      }
      ob.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<strong style="color:var(--accent);font-size:14px">👋 시작하기</strong>' +
        '<button id="onboard-x" class="tb-action" style="padding:2px 8px;font-size:11px">✕</button></div>' +
        '<div style="font-size:12px;color:var(--panel-text-dim);line-height:1.7">' +
        '1. <strong>우클릭</strong>으로 노드 추가<br>' +
        '2. 노드 <strong>가장자리</strong> 드래그로 연결<br>' +
        '3. <strong>Ctrl+K</strong> 명령 팔레트<br>' +
        '4. [팀] 탭에서 에이전트 등록<br>' +
        '5. [▶ 실행]으로 워크플로우 실행</div>' +
        '<button id="onboard-done" class="tb-action" style="width:100%;margin-top:10px">시작하기</button>';
      const obDone = document.getElementById('onboard-done');
      const obX = document.getElementById('onboard-x');
      const close = () => { localStorage.setItem(LS_KEY + '_onboarded', '1'); if (ob) ob.remove(); };
      if (obDone) obDone.addEventListener('click', close);
      if (obX) obX.addEventListener('click', close);
    }, 1500);
    // 첫 상호작용(클릭) 시 온보딩 카드 자동 제거 — 방해 방지
    const obAutoClose = () => {
      const card = document.getElementById('onboard-card');
      if (card) { localStorage.setItem(LS_KEY + '_onboarded', '1'); card.remove(); }
      document.removeEventListener('click', obAutoClose, true);
    };
    document.addEventListener('click', obAutoClose, true);
  } catch (e) {}
}

// 3. 시뮬레이션 모드 — 실행 없이 경로/비용/시간 추정
async function simulateWorkflow() {
  const wf = currentWorkflow();
  if (!wf) { toast('워크플로우 없음'); return; }
  const nodes = wf.nodes || [];
  const edges = wf.edges || [];
  const start = nodes.find(n => n.type === 'start');
  const path = [];
  let cur = start ? start.id : (nodes[0] ? nodes[0].id : null);
  const visited = new Set();
  let steps = 0, estMs = 0, llmCalls = 0;
  while (cur && steps < 50 && !visited.has(cur)) {
    visited.add(cur);
    const n = nodes.find(x => x.id === cur);
    if (!n) break;
    path.push(n.label || n.type);
    steps++;
    if (n.type === 'decision') { llmCalls++; estMs += 2000; }
    else if (n.type === 'approval') { estMs += 5000; }
    else if (n.type === 'reviewer') { estMs += 1500; }
    else if (n.type === 'process' && n.action) { estMs += 1000; }
    else { estMs += 300; }
    const next = edges.find(e => e.from === cur);
    cur = next ? next.to : null;
  }
  const estCost = (llmCalls * 0.003) + (estMs / 1000 * 0.0001);
  toastHTML('<div style="min-width:300px"><strong style="display:block;margin-bottom:10px;color:var(--accent)">🧪 시뮬레이션 결과</strong>' +
    '<div style="font-size:12px;color:var(--panel-text-dim)">경로: ' + escapeHtml(path.join(' → ')) + '</div>' +
    '<div style="font-size:12px;margin-top:8px">단계: ' + steps + ' · LLM 판단: ' + llmCalls + '회<br>' +
    '예상 시간: ' + Math.round(estMs / 1000) + 's · 예상 비용: $' + estCost.toFixed(4) + '</div>' +
    '<div style="font-size:11px;color:var(--panel-text-faint);margin-top:8px">읽기 전용 — 실제 실행 없음</div></div>', 10000);
}

// 8: 신뢰도 맵 — 노드별 신뢰 색상
function trustMapBadge(n) {
  const c = n.confidence;
  if (typeof c !== 'number') return '';
  const color = c >= 80 ? 'var(--accent)' : c >= 50 ? '#d29922' : '#ff5d5d';
  return '<span class="trust-map" style="position:absolute;top:-9px;right:10px;font-size:9px;font-weight:700;color:' + color + '">' + c + '%</span>';
}
// 5. 거버넌스 대시보드 — 에이전트별 신뢰/자율/위험
async function renderGovernance() {
  const body = document.getElementById('gov-body');
  if (!body) return;
  try {
    const r = await fetch(API_BASE + '/api/trust');
    const j = await r.json();
    const trust = j.success ? (j.trust || []) : [];
    const rows = trust.map(t => {
      const risk = t.trust >= 80 ? '낮음' : t.trust >= 60 ? '중간' : '높음';
      const color = t.trust >= 80 ? 'var(--accent)' : t.trust >= 60 ? '#d29922' : '#ff5d5d';
      const autonomy = t.trust >= 80 ? '자율' : t.trust >= 60 ? '감독' : '승인 필수';
      return '<div style="padding:8px;margin-bottom:6px;background:var(--dark-3);border-radius:8px;font-size:12px">' +
        '<div style="display:flex;justify-content:space-between"><strong>' + escapeHtml(t.agent_id) + '</strong>' +
        '<span style="color:' + color + '">신뢰 ' + t.trust + '%</span></div>' +
        '<div style="font-size:10px;color:var(--panel-text-dim)">실행 ' + t.runs + '회 · 위험 ' + risk + ' · 자율성: ' + autonomy + '</div></div>';
    }).join('');
    body.innerHTML = rows || '<span style="color:var(--panel-text-faint)">신뢰 데이터 없음</span>';
  } catch (e) { body.innerHTML = panelErrorHtml('신뢰도 데이터'); }
}

// 4: 인앱 피드백 + NPS
function openFeedback() {
  const ans = prompt('의견을 입력하세요 (버그/제안/아이디어):');
  if (ans && ans.trim()) {
    try {
      const fb = JSON.parse(localStorage.getItem(LS_KEY + '_feedback') || '[]');
      fb.push({ text: ans.trim(), ts: Date.now() });
      localStorage.setItem(LS_KEY + '_feedback', JSON.stringify(fb.slice(-50)));
    } catch (e) {}
    toast('💬 의견 감사합니다!');
  }
}
function askNPS() {
  try {
    if (localStorage.getItem(LS_KEY + '_nps')) return;
    setTimeout(() => {
      toastHTML('<div style="min-width:280px"><strong style="display:block;margin-bottom:8px;color:var(--accent)">만족도 조사</strong>' +
        '<div style="font-size:12px;color:var(--panel-text-dim);margin-bottom:10px">커멘드센터가 유용한가요?</div>' +
        '<div style="display:flex;gap:6px">' +
        '<button id="nps-yes" class="tb-action" style="flex:1">👍 좋아요</button>' +
        '<button id="nps-no" class="tb-action" style="flex:1">👎 아쉬워요</button>' +
        '</div></div>', 12000);
      const yes = document.getElementById('nps-yes');
      const no = document.getElementById('nps-no');
      if (yes) yes.addEventListener('click', () => { localStorage.setItem(LS_KEY + '_nps', '1'); document.querySelectorAll('.toast').forEach(t => t.remove()); });
      if (no) no.addEventListener('click', () => { localStorage.setItem(LS_KEY + '_nps', '0'); document.querySelectorAll('.toast').forEach(t => t.remove()); setTimeout(() => openFeedback(), 300); });
    }, 25000);
  } catch (e) {}
}
// 7: 사용 행동 추적
function trackAction(action) {
  try {
    const key = LS_KEY + '_actions';
    const a = JSON.parse(localStorage.getItem(key) || '{}');
    a[action] = (a[action] || 0) + 1;
    localStorage.setItem(key, JSON.stringify(a));
  } catch (e) {}
}

// 1: 더보기 드롭다운 메뉴 — 상단바 오버플로 해결
const MORE_ITEMS = [
  ['그룹', 'btn-group'], ['템플릿', 'btn-template'], ['버전', 'btn-version'],
  ['PNG', 'btn-png'], ['MD', 'btn-md'], ['🔒 잠금', 'btn-lock'], ['☆ 즐겨찾기', 'btn-fav'],
  ['가져오기', 'btn-import'], ['번들', 'btn-bundle'], ['트레이스', 'btn-trace'],
  ['diff', 'btn-diff'], ['위험', 'btn-risk'], ['대시보드', 'btn-agent-dash'],
  ['세션', 'btn-sessions'], ['마켓', 'btn-market'], ['활동', 'btn-feed'],
  ['테스트', 'btn-test'], ['시뮬레이션', 'btn-sim'], ['거버넌스', 'btn-gov'],
  ['정렬', 'btn-align'],
];
// 연결 기록 렌더
function renderEdgeLog() {
  const body = document.getElementById('edge-log-body');
  if (!body) return;
  try {
    const log = JSON.parse(localStorage.getItem(LS_KEY + '_edgelog') || '[]');
    body.innerHTML = log.length === 0
      ? '<span style="color:var(--panel-text-faint)">연결 기록 없음</span>'
      : [...log].reverse().slice(0, 40).map(l => {
          const icon = l.type === 'connect' ? '🔗' : '✂️';
          const color = l.type === 'connect' ? 'var(--accent)' : 'var(--red)';
          return '<div style="padding:6px 0;border-bottom:1px solid var(--panel-border);display:flex;justify-content:space-between;gap:8px">' +
            '<span style="color:' + color + '">' + icon + ' ' + escapeHtml(l.from) + ' → ' + escapeHtml(l.to) + (l.label ? ' <em style="opacity:.7">[' + escapeHtml(l.label) + ']</em>' : '') + '</span>' +
            '<span style="color:var(--panel-text-faint);font-size:10px;white-space:nowrap">' + l.ts.slice(5, 16).replace('T', ' ') + '</span></div>';
        }).join('');
  } catch (e) { body.innerHTML = '오류'; }
}

// 더보기 메뉴에 연결 기록 항목 추가
const MORE_EDGE_ITEMS = [['🔗 연결 기록', 'edge-log']];
const _origBuild = buildMoreMenu;
function buildMoreMenu() {
  const menu = document.getElementById('more-menu');
  if (!menu) return;
  menu.innerHTML = MORE_ITEMS.map(([label, id]) => {
    const btn = document.getElementById(id);
    if (!btn) return '';
    // 원본 버튼의 클릭 이벤트 복제 — 더보기 메뉴 항목 생성
    return '<button class="mm-item" data-target="' + id + '" style="display:block;width:100%;text-align:left;padding:8px 12px;background:transparent;border:none;border-radius:8px;color:var(--panel-text);font-size:13px;cursor:pointer">' + label + '</button>';
  }).join('');
  // 메뉴 항목 클릭 → 원본 버튼 트리거
  // 연결 기록 항목 추가
  // MCP 지시 항목
  const mcpItem = document.createElement('button');
  mcpItem.className = 'mm-item';
  mcpItem.textContent = '🤖 MCP 지시';
  mcpItem.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 12px;background:transparent;border:none;border-radius:8px;color:#ffffff;font-size:13px;cursor:pointer';
  mcpItem.addEventListener('click', () => {
    menu.style.display = 'none';
    toggleMcpPanel();
  });
  menu.appendChild(mcpItem);
  const edgeItem = document.createElement('button');
  edgeItem.className = 'mm-item';
  edgeItem.textContent = '🔗 연결 기록';
  edgeItem.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 12px;background:transparent;border:none;border-radius:8px;color:var(--panel-text);font-size:13px;cursor:pointer';
  edgeItem.addEventListener('click', () => {
    menu.style.display = 'none';
    const panel = document.getElementById('edge-log-panel');
    if (panel) { panel.style.display = 'block'; renderEdgeLog(); }
  });
  menu.appendChild(edgeItem);
  menu.querySelectorAll('.mm-item').forEach(item => {
    item.addEventListener('click', () => {
      const target = document.getElementById(item.dataset.target);
      if (target) target.click();
      menu.style.display = 'none';
    });
  });
}
const btnMore = document.getElementById('btn-more');
if (btnMore) btnMore.addEventListener('click', (e) => {
  e.stopPropagation();
  let menu = document.getElementById('more-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'more-menu';
    menu.style.cssText = 'position:absolute;top:46px;right:8px;z-index:90;background:var(--dark-2);border:1px solid var(--dark-border);border-radius:12px;padding:6px;min-width:180px;box-shadow:0 6px 24px rgba(0,0,0,.35);display:block';
    document.body.appendChild(menu);
  }
  try {
    buildMoreMenu();
  } catch (err) { console.warn('buildMoreMenu', err); }
  togglePanel(menu);
});
// 더보기 외부 클릭 시 메뉴 닫기 (안전)
document.addEventListener('click', (e) => {
  const menu = document.getElementById('more-menu');
  if (menu && menu.style.display === 'block' && !e.target.closest('#btn-more') && !e.target.closest('#more-menu')) {
    menu.style.display = 'none';
  }
}, true);
document.addEventListener('click', (e) => {
  const menu = document.getElementById('more-menu');
  const wrap = document.getElementById('more-wrap');
  if (menu && wrap && !wrap.contains(e.target)) menu.style.display = 'none';
});

// 1. 데이터 커넥터 노드 실행 — CSV/JSON/API/DB
async function runConnector(n) {
  const type = n.connector_type || 'csv';
  const config = n.connector_config || {};
  const r = await fetch(API_BASE + '/api/connector', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, config }),
  }).catch(() => null);
  if (r && r.ok) {
    const j = await r.json();
    if (j.success) {
      logRun('연결: ' + (n.label || type) + ' → ' + (j.meta.count !== undefined ? j.meta.count + '건' : '완료'));
      return j.data;
    }
    logRun('연결 오류: ' + j.error);
  } else {
    logRun('연결 실패 (서버 미연결)');
  }
  return null;
}

// 1b. 투표 노드 — 여러 에이전트 답변 다수결 (신뢰 가중)
async function runVoteNode(n, ctx) {
  // 투표 대상: 하위 노드(에이전트) 수 = fan-out 아웃엣지 수
  const wf = currentWorkflow();
  const outs = wf.edges.filter(e => e.from === n.id);
  const voters = outs.slice(0, 5);
  const votes = [];
  for (const edge of voters) {
    const target = wf.nodes.find(x => x.id === edge.to);
    if (!target) continue;
    // 에이전트별 가중치 (신뢰 점수)
    let weight = 1;
    try {
      const tr = await fetch(API_BASE + '/api/trust');
      const tj = await tr.json();
      const t = (tj.trust || []).find(x => x.agent_id === target.agentId);
      if (t) weight = Math.max(0.3, t.trust / 100);
    } catch (e) {}
    const answer = await llmDecide(n.vote_prompt || '이 제안을 승인해야 하는가?', ctx);
    votes.push({ agent: target.agentId || target.label || edge.to, answer, weight });
    logRun('🗳 ' + (target.label || target.id) + ': ' + (answer ? '찬성' : '반대') + ' (가중 ' + weight.toFixed(2) + ')');
  }
  const yesW = votes.filter(v => v.answer).reduce((a, v) => a + v.weight, 0);
  const noW = votes.reduce((a, v) => a + v.weight, 0) - yesW;
  const decision = yesW >= noW;
  logRun('🗳 투표 결과: ' + (decision ? '찬성 ' : '반대 ') + yesW.toFixed(1) + ':' + noW.toFixed(1));
  return decision;
}

// 2. 다중 모델 라우팅 — 노드 model 속성 + 서버 테이블
async function resolveModel(n) {
  if (n.model && n.model !== 'auto') return n.model;
  try {
    const r = await fetch(API_BASE + '/api/model-routes');
    const j = await r.json();
    const complexity = (n.llm_prompt || '').length > 80 ? 'smart' : 'cheap';
    const route = j.routes && j.routes[complexity];
    return route ? route.model : 'deepseek/deepseek-v4-flash-0731';
  } catch (e) { return 'deepseek/deepseek-v4-flash-0731'; }
}

// 3. 결과 피드백 루프 — 실행 결과를 지식으로 저장
async function feedbackLoop(wf, summary, status) {
  if (!serverOnline || !wf) return;
  try {
    await fetch(API_BASE + '/api/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wf_id: wf.id, summary: String(summary).slice(0, 200), status }),
    });
  } catch (e) {}
}

// 예시 워크플로우 설치 — 서버에서 3종 로드
async function installExample(id) {
  if (!serverOnline) { toast('서버 미연결 — 예시 설치 불가'); return; }
  try {
    const r = await fetch(API_BASE + '/api/examples/install', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const j = await r.json();
    if (j.success) {
      const wf = j.workflow;
      if (!store.workflows.find(w => w.id === wf.id)) {
        store.workflows.push({ id: wf.id, name: wf.name, nodes: wf.nodes.map(n => ({...n})), edges: wf.edges.map(e => ({...e})) });
      }
      store.activeWorkflowId = wf.id;
      saveStore(true); renderAll();
      toast('✅ 예시 설치됨: ' + wf.name);
    } else toast(j.error || '설치 실패');
  } catch (e) { toast('설치 실패'); }
}
async function loadExamples() {
  const wrap = document.getElementById('example-list');
  if (!wrap) return;
  try {
    const r = await fetch(API_BASE + '/api/examples');
    const j = await r.json();
    if (!j.success) return;
    wrap.innerHTML = j.examples.map(ex =>
      '<button style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px;font-size:11px;color:var(--panel-text);cursor:pointer" onclick="installExample(\'' + ex.id + '\')">' +
      '<span>' + escapeHtml(ex.name) + '</span>' +
      '<span style="color:var(--accent)">설치 →</span></button>'
    ).join('');
  } catch (e) {}
}

// === 라이브 에이전트 — 연결 상태 + 명령 보내기 ===
let onlineAgents = new Set();
async function refreshAgentStatus() {
  try {
    const r = await fetch(API_BASE + '/api/agents/status');
    const j = await r.json();
    if (j.success) {
      onlineAgents = new Set(j.online || []);
      renderAll();  // 배지 갱신
    }
  } catch (e) {}
}
setInterval(refreshAgentStatus, 5000);  // 5초 폴링
// 에이전트 연결 상태 배지 — 노드의 에이전트 배지 옆 초록/회색 점
function agentLiveBadge(agentId) {
  if (!agentId) return '';
  const on = onlineAgents.has(agentId);
  return '<span class="agent-live" title="' + (on ? '온라인 (WS 연결됨)' : '오프라인') + '" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + (on ? '#00ff87' : '#5a6470') + ';box-shadow:' + (on ? '0 0 6px #00ff87' : 'none') + ';margin-left:4px;vertical-align:middle"></span>';
}
// 에이전트에게 명령 보내기
async function sendAgentCommand(agentId, commandText) {
  if (!agentId) return;
  const traceId = 'trace_' + Date.now().toString(36);
  try {
    const r = await fetch(API_BASE + '/api/agent/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_agent: agentId, msg_type: 'command', from_agent: 'web', payload: { text: commandText }, trace_id: traceId })
    });
    const j = await r.json();
    if (j.success) {
      toast((j.pushed ? '📡 명령 전송됨 (온라인): ' : '💾 명령 대기열 저장 (오프라인): ') + agentId);
      return j;
    }
    toast(j.error || '전송 실패');
  } catch (e) { toast('전송 실패 (서버 필요)'); }
  return null;
}
// 명령 입력 프롬프트
function promptAgentCommand(agentId) {
  const text = prompt('[' + agentId + '] 보낼 명령:');
  if (text) sendAgentCommand(agentId, text);
}

// === MCP 지시 패널 ===
const MCP_AGENT = 'ag_connector';  // MCP 커넥터 (Claude 세션)
function mcpLog(msg) {
  const el = document.getElementById('mcp-log');
  if (!el) return;
  const t = new Date().toLocaleTimeString();
  el.innerHTML = '<div style="padding:4px 0;border-bottom:1px solid var(--panel-border);color:var(--panel-text-faint)">' + t + '</div><div style="padding:4px 0">' + escapeHtml(msg) + '</div>' + el.innerHTML;
}
function toggleMcpPanel() {
  const panel = document.getElementById('mcp-panel');
  if (!panel) return;
  if (togglePanel(panel)) refreshMCPStatus();
}
async function refreshMCPStatus() {
  const el = document.getElementById('mcp-status');
  if (!el) return;
  try {
    const r = await fetch(API_BASE + '/api/agents/status');
    const j = await r.json();
    const on = (j.online || []).includes(MCP_AGENT);
    el.innerHTML = on ? '<span style="color:var(--accent)">● 온라인</span>' : '<span style="color:var(--red)">○ 오프라인</span>';
  } catch (e) { el.innerHTML = '<span style="color:var(--red)">○ 오프라인</span>'; }
}
// === 에이전트 팀 대시보드 ===
async function loadTeamStatus() {
  const list = document.getElementById('team-list');
  if (!list) return;
  try {
    const r = await fetch(API_BASE + '/api/team/status');
    const j = await r.json();
    // 이전에는 여기서 그냥 return 해서 패널이 빈 채로 남았다 — 사용자는 이유를 알 수 없다
    if (!j.success) { list.innerHTML = panelErrorHtml('팀 현황'); return; }
    const team = j.team || [];
    list.innerHTML = team.map(t => {
      const active = (t.active_sessions || 0) > 0;
      const pend = t.pending_msgs || 0;
      return '<div style="display:flex;align-items:center;gap:8px;padding:7px 8px;margin-bottom:5px;background:var(--dark-3);border:1px solid var(--dark-border);border-radius:8px">' +
        '<span style="width:10px;height:10px;border-radius:50%;background:' + escapeHtml(t.color || '#888') + '"></span>' +
        '<strong style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(t.agent_name) + '</strong>' +
        (active ? '<span style="color:var(--accent);font-size:10px">● 활성</span>' : '<span style="color:var(--panel-text-faint);font-size:10px">○ 대기</span>') +
        '<span style="color:var(--panel-text-faint);font-size:10px">세션 ' + t.total_sessions + '</span>' +
        (pend > 0 ? '<span style="color:var(--yellow);font-size:10px">📨 ' + pend + '</span>' : '') +
        '</div>';
    }).join('');
    const title = document.getElementById('team-title');
    if (title) title.textContent = '🤝 에이전트 팀 (' + team.length + '명)';
  } catch (e) { list.innerHTML = panelErrorHtml('팀 현황'); }
}
async function bootstrapTeam() {
  // 15개 에이전트 세션 생성
  const ids = ['ag_orch','ag_researcher','ag_analyst','ag_writer','ag_reviewer','ag_collector','ag_developer','ag_tester','ag_designer','ag_security','ag_communicator','ag_scheduler','ag_integrator','ag_archiver','ag_auditor'];
  let ok = 0;
  for (const id of ids) {
    try {
      // 기존 세션 확인 후 없으면 생성 (멱등)
      const list = await fetch(API_BASE + '/api/sessions').then(r => r.json());
      const exists = (list.sessions || []).some(s => s.agent_id === id);
      if (exists) { ok++; continue; }
      const r = await fetch(API_BASE + '/api/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: id, status: 'idle' })
      });
      const j = await r.json();
      if (j.success) ok++;
    } catch (e) {}
  }
  toast('🚀 세션 부트스트랩: ' + ok + '/15');
  loadTeamStatus();
}
function toggleTeamPanel() {
  const panel = document.getElementById('team-panel');
  if (!panel) return;
  if (togglePanel(panel)) loadTeamStatus();
}
async function sendMcpCommand(text) {
  if (!text.trim()) return;
  mcpLog('📤 지시: ' + text);
  const traceId = 'mcp_' + Date.now().toString(36);
  try {
    const r = await fetch(API_BASE + '/api/agent/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_agent: MCP_AGENT, msg_type: 'command', from_agent: 'web', payload: { text }, trace_id: traceId })
    });
    const j = await r.json();
    if (j.success) {
      mcpLog('✅ 전송됨' + (j.pushed ? ' (온라인 즉시 전달)' : ' (대기열 — Claude가 확인 시 수신)'));
      toast('📡 MCP 지시 전송됨');
    } else mcpLog('❌ 실패: ' + (j.error || '오류'));
  } catch (e) { mcpLog('❌ 전송 오류: ' + e.message); }
}

// === 자격증명 모달 (Claude 세션 구현) ===

  let currentCredAgentId = null;

  function openCredentialModal(agentId) {
    currentCredAgentId = agentId;
    document.getElementById('credAgentId').textContent = agentId;
    document.getElementById('credForm').hidden = false;
    document.getElementById('credResult').hidden = true;
    document.getElementById('credName').value = 'claude-desktop';
    document.getElementById('credExpires').value = '';
    document.getElementById('scopeRead').checked = true;
    document.getElementById('scopeExecute').checked = true;
    // 관리자 키는 이 브라우저에만 보관 — 소스/서버에 저장하지 않는다
    try {
      document.getElementById('credAdminKey').value = localStorage.getItem('wf_admin_key') || '';
    } catch (e) {}
    document.getElementById('credentialModal').hidden = false;
  }

  function closeCredentialModal() {
    document.getElementById('credentialModal').hidden = true;
    // 화면에서 키 텍스트 제거
    document.getElementById('credKeyDisplay').value = '';
    document.getElementById('credConfigPreview').textContent = '';
    currentCredAgentId = null;
  }

  async function issueCredential() {
    const scopes = [];
    if (document.getElementById('scopeRead').checked) scopes.push('mcp:read');
    if (document.getElementById('scopeExecute').checked) scopes.push('mcp:execute');
    if (!scopes.length) { alert('최소 1개 스코프 선택 필요'); return; }

    const body = {
      name: document.getElementById('credName').value.trim() || 'default',
      scopes,
    };
    const days = parseInt(document.getElementById('credExpires').value, 10);
    if (days > 0) body.expires_in_days = days;

    // 자격증명 발급은 mcp:admin 을 요구한다 (이전에는 무인증으로 열려 있었다)
    const adminKey = (document.getElementById('credAdminKey').value || '').trim();
    if (!adminKey) { alert('관리자 키(mcp:admin)를 입력하세요.'); return; }

    try {
      const res = await fetch(`${API_BASE}/api/agents/${currentCredAgentId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401) { alert('관리자 키가 올바르지 않거나 만료되었습니다.'); return; }
        if (res.status === 403) { alert('이 키에는 mcp:admin 권한이 없습니다.\n필요: ' + (err.required || 'mcp:admin')); return; }
        alert('발급 실패: ' + (err.error || res.statusText));
        return;
      }
      // 성공한 키만 기억한다
      try { localStorage.setItem('wf_admin_key', adminKey); } catch (e) {}
      const data = await res.json();
      showIssuedKey(data.key);
    } catch (e) {
      alert('네트워크 오류: ' + e.message);
    }
  }

  function showIssuedKey(key) {
    document.getElementById('credForm').hidden = true;
    document.getElementById('credResult').hidden = false;
    document.getElementById('credKeyDisplay').value = key;

    const host = window.location.host;
    const proto = window.location.protocol;
    const mcpUrl = `${proto}//${host}/mcp`;
    const config = {
      mcpServers: {
        'workflow-builder': {
          url: mcpUrl,
          headers: { Authorization: `Bearer ${key}` },
        },
      },
    };
    document.getElementById('credConfigPreview').textContent = JSON.stringify(config, null, 2);
  }

  async function copyCredKey() {
    const key = document.getElementById('credKeyDisplay').value;
    await navigator.clipboard.writeText(key);
    // 간단한 피드백 - 필요시 토스트로 교체
    const btn = event.target;
    const orig = btn.textContent;
    btn.textContent = '복사됨 ✓';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }

  async function copyCredConfig() {
    const cfg = document.getElementById('credConfigPreview').textContent;
    await navigator.clipboard.writeText(cfg);
    event.target.textContent = '설정 복사됨 ✓';
    setTimeout(() => { event.target.textContent = '설정 전체 복사'; }, 1500);
  }

// === 초기화 ===
renderPalette();
setupCanvasDrop();
setupSpacePan();
bindWfFilter();
loadStore();
const wf0 = currentWorkflow();
if (wf0) document.getElementById('wf-name').value = wf0.name;
renderAll();
// 서버 연동 — 서버에 데이터가 있으면 로드, 없으면 로컬 유지
(async () => {
  const loaded = await loadFromServer();
  if (loaded) {
    const wf1 = currentWorkflow();
    if (wf1) document.getElementById('wf-name').value = wf1.name;
    renderAll();
    saveStore(true);
  }
  // 실시간 협업 (서버 사용 시)
  if (serverOnline) { initWS(); setTimeout(patchWSHandler, 500); }
  loadComments();
})();
initPWA();
attachArrowKeys();
initShareDemo();
initCommandPalette();
setTimeout(initPresence, 800);
document.getElementById('btn-diff').addEventListener('click', showWfDiff);
document.getElementById('btn-risk').addEventListener('click', showRiskDiff);
document.getElementById('btn-feedback').addEventListener('click', openFeedback);
document.getElementById('btn-mcp').addEventListener('click', () => { toggleMcpPanel(); });
document.getElementById('btn-team').addEventListener('click', () => { toggleTeamPanel(); });
document.getElementById('team-close').addEventListener('click', () => { document.getElementById('team-panel').style.display = 'none'; });
document.getElementById('team-refresh').addEventListener('click', loadTeamStatus);
document.getElementById('team-bootstrap').addEventListener('click', bootstrapTeam);
document.getElementById('btn-agents').addEventListener('click', () => { toggleAgentsPanel(); loadAgents(); });
document.getElementById('agents-close').addEventListener('click', () => {
  document.getElementById('agents-panel').style.display = 'none';
});
document.getElementById('agent-add').addEventListener('click', () => showAgentForm(null));
document.getElementById('btn-agent-dash').addEventListener('click', () => {
  document.getElementById('agent-dash').style.display = 'block';
  computeAgentMetrics().then(renderAgentMetrics);
});
document.getElementById('agent-dash-close').addEventListener('click', () => {
  document.getElementById('agent-dash').style.display = 'none';
});
document.getElementById('agent-knowledge-btn').addEventListener('click', showKnowledgeForm);
document.getElementById('btn-sessions').addEventListener('click', toggleSessionPanel);
document.getElementById('session-run').addEventListener('click', runAgentSessions);
document.getElementById('session-refresh').addEventListener('click', renderSessionPanel);
document.getElementById('session-close').addEventListener('click', () => {
  document.getElementById('session-panel').style.display = 'none';
});
document.getElementById('btn-market').addEventListener('click', () => {
  document.getElementById('market-panel').style.display = 'block';
  renderMarket();
});
document.getElementById('market-close').addEventListener('click', () => {
  document.getElementById('market-panel').style.display = 'none';
});
document.getElementById('tpl-publish').addEventListener('click', publishTemplate);
document.getElementById('btn-feed').addEventListener('click', toggleFeed);
document.getElementById('feed-close').addEventListener('click', () => {
  document.getElementById('feed-panel').style.display = 'none';
});
document.getElementById('feed-filter').addEventListener('change', renderFeed);
document.getElementById('btn-test').addEventListener('click', toggleTestPanel);
document.getElementById('test-close').addEventListener('click', () => {
  document.getElementById('test-panel').style.display = 'none';
});
document.getElementById('test-add').addEventListener('click', addTest);
document.getElementById('test-run-all').addEventListener('click', runRegressionGate);
document.getElementById('btn-sim').addEventListener('click', simulateWorkflow);
document.getElementById('btn-gov').addEventListener('click', () => {
  document.getElementById('gov-panel').style.display = 'block';
  renderGovernance();
});
// MCP 지시 패널 이벤트
document.getElementById('mcp-close').addEventListener('click', () => {
  document.getElementById('mcp-panel').style.display = 'none';
});
document.getElementById('mcp-send').addEventListener('click', () => {
  const input = document.getElementById('mcp-input');
  sendMcpCommand(input.value);
  input.value = '';
});
document.getElementById('mcp-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    const input = document.getElementById('mcp-input');
    sendMcpCommand(input.value);
    input.value = '';
  }
});
document.querySelectorAll('.mcp-quick').forEach(btn => {
  btn.addEventListener('click', () => sendMcpCommand(btn.dataset.cmd));
});
document.getElementById('edgelog-close').addEventListener('click', () => {
  document.getElementById('edge-log-panel').style.display = 'none';
});
document.getElementById('gov-close').addEventListener('click', () => {
  document.getElementById('gov-panel').style.display = 'none';
});
loadAgents();
setTimeout(() => { if (serverOnline) flushOfflineQueue(); }, 3000);
onboardingTour();
askNPS();
const br = document.getElementById('btn-run');
if (br) br.addEventListener('click', () => trackAction('run'));
trackAction('visit');
// 통계 패널에 차트 렌더
const origShowStats = showStats;
showStats = async function() {
  await origShowStats();
  setTimeout(() => renderRunChart('stats-body'), 300);
};
