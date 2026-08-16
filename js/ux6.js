// 1. LLM 판단 노드 — decision + llm_prompt
async function llmDecide(prompt, ctx, model) {
  if (!serverOnline) return null;
  try {
    // 4: 장기 메모리 주입 — 관련 지식 컨텍스트에 추가
    let memoryCtx = '';
    try {
      const kr = await fetch(API_BASE + '/api/knowledge');
      const kj = await kr.json();
      if (kj.success && kj.knowledge && kj.knowledge.length) {
        memoryCtx = '\n[에이전트 지식] ' + kj.knowledge.slice(0, 3).map(k => k.note).join(' | ');
      }
    } catch (e) {}
    const enhancedPrompt = prompt + memoryCtx;
    // 5: semantic cache 확인 (같은 판단 재사용)
    const cacheKey = 'DECIDE:' + enhancedPrompt + ':' + (model || '');
    const ch = await fetch(API_BASE + '/api/cache/get', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: cacheKey, model: model || '' }),
    }).catch(() => null);
    if (ch && ch.ok) {
      const cj = await ch.json();
      if (cj.hit) return cj.response === 'true';
    }
    const r = await fetch(API_BASE + '/api/ai/decide', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: enhancedPrompt, context: ctx, model }),
    });
    const j = await r.json();
    if (j.success) {
      // 5: 캐시 저장
      fetch(API_BASE + '/api/cache/put', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: cacheKey, model: model || '', response: String(!!j.decision) }),
      }).catch(() => {});
      return !!j.decision;
    }
    return null;
  } catch (e) { return null; }
}

// 6. 노드 간 데이터 참조 — {{ node_3.output }}
function resolveRefs(str, ctx) {
  if (!str) return str;
  return String(str).replace(/\{\{\s*(node_[A-Za-z0-9_]+)(?:\.(output|label))?\s*\}\}/g, (m, id, prop) => {
    const v = ctx && ctx[id];
    if (v === undefined) return m;
    if (prop === 'label') return v.label || '';
    return v.output || v.value || '';
  });
}

// 3. 재시도/폴백 — runNodeAction에 retry/fallback 반영
async function runNodeWithRetry(node) {
  const retries = node.retry || 0;
  for (let i = 0; i <= retries; i++) {
    const result = await runNodeAction(node);
    if (result.ok !== false) return result;
    if (i < retries) { setExecStatus(node.id, 'running'); toast('🔄 재시도 ' + (i + 1) + '/' + retries); }
  }
  // 폴백: fallback_to 지정 시 대체 노드
  const wf = currentWorkflow();
  if (node.fallback_to && wf) {
    const fb = wf.nodes.find(n => n.id === node.fallback_to);
    if (fb) { toast('↩️ 폴백: ' + (fb.label || fb.id)); return await runNodeAction(fb); }
  }
  return { ok: false };
}

// 4. 실행 트레이스
let traceEntries = [];
function traceAdd(nodeId, label, status, ms) {
  traceEntries.unshift({ nodeId, label, status, ms });
  if (traceEntries.length > 50) traceEntries.pop();
  renderTrace();
}
function renderTrace() {
  const body = document.getElementById('trace-body');
  if (!body) return;
  body.innerHTML = traceEntries.length === 0
    ? '<span style="color:var(--panel-text-faint)">실행 이력 없음</span>'
    : traceEntries.map(t =>
      '<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid var(--dark-border)">' +
      '<span style="color:' + (t.status === 'completed' ? 'var(--accent)' : t.status === 'failed' ? '#ff5d5d' : '#d29922') + '">' +
      (t.status === 'completed' ? '✓' : t.status === 'failed' ? '✗' : '⏳') + '</span>' +
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(t.label) + '</span>' +
      '<span style="color:var(--panel-text-faint)">' + t.ms + 'ms</span></div>'
    ).join('');
}

// 5. 웹훅 트리거
async function registerWebhook(nodeId) {
  const wf = currentWorkflow();
  if (!wf || !serverOnline) { toast('서버 미연결'); return; }
  try {
    const r = await fetch(API_BASE + '/api/webhook/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wf_id: wf.id, node_id: nodeId || '' }),
    });
    const j = await r.json();
    if (j.success) {
      toastHTML('<span>웹훅 등록됨<br><small style="color:var(--panel-text-dim)">' + escapeHtml(API_BASE + j.webhook_url) + '</small></span>', 5000);
    }
  } catch (e) { toast('웹훅 실패'); }
}

// 승인 게이트 — 실행 중 사용자 확인 대기
function waitApproval(text) {
  return new Promise((resolve) => {
    document.getElementById('approval-overlay').style.display = 'flex';
    document.getElementById('approval-overlay').style.alignItems = 'center';
    document.getElementById('approval-text').textContent = text;
    window.__approveResolve = resolve;
  });
}
document.getElementById('approval-yes').addEventListener('click', () => {
  document.getElementById('approval-overlay').style.display = 'none';
  if (window.__approveResolve) window.__approveResolve(true);
});
document.getElementById('approval-no').addEventListener('click', () => {
  document.getElementById('approval-overlay').style.display = 'none';
  if (window.__approveResolve) window.__approveResolve(false);
});

// 트레이스 패널
// 트레이스 타임라인 — agent_spans를 타임라인으로
async function renderTraceTimeline() {
  const body = document.getElementById('trace-body');
  const filter = document.getElementById('trace-filter') ? document.getElementById('trace-filter').value : '';
  try {
    const r = await fetch(API_BASE + '/api/spans');
    const j = await r.json();
    const spans = j.success ? (j.spans || []) : [];
    const filtered = filter === 'fail' ? spans.filter(s => !(s.result && s.result.ok)) :
      filter === 'slow' ? spans.filter(s => s.duration_ms > 500) : spans;
    body.innerHTML = filtered.length === 0
      ? '<span style="color:var(--panel-text-faint)">스팬 없음</span>'
      : filtered.slice(0, 40).map(s => {
          const ok = s.result && s.result.ok;
          const color = ok ? 'var(--accent)' : '#ff5d5d';
          const slow = s.duration_ms > 500 ? ' ⚠' : '';
          return '<div style="padding:7px;margin-bottom:5px;background:var(--dark-3);border-radius:8px;font-size:11px;border-left:3px solid ' + color + '">' +
            '<div style="display:flex;justify-content:space-between"><strong>' + escapeHtml(s.operation || s.node_id) + '</strong>' +
            '<span style="color:var(--panel-text-faint)">' + s.duration_ms + 'ms' + slow + '</span></div>' +
            '<div style="color:var(--panel-text-dim);font-size:10px">' + escapeHtml(s.agent_id) + ' · ' + escapeHtml(s.trace_id || '') + '</div>' +
            (s.result && s.result.output ? '<div style="color:var(--panel-text-faint);font-size:10px;margin-top:2px">' + escapeHtml(String(s.result.output).slice(0, 80)) + '</div>' : '') +
            '</div>';
        }).join('');
  } catch (e) { body.innerHTML = panelErrorHtml('트레이스'); }
}

// 실행 퍼널/병목 차트
function renderFunnelChart() {
  const wf = currentWorkflow();
  const nodes = (wf && wf.nodes) || [];
  const body = document.getElementById('stats-body');
  if (!body || nodes.length === 0) return;
  const done = nodes.filter(n => n.status === '완료' || n.status === 'done').length;
  const running = nodes.filter(n => n.status === '진행' || n.status === 'running').length;
  const blocked = nodes.filter(n => n.blocked).length;
  const pending = nodes.length - done - running;
  const segments = [
    { label: '완료', val: done, color: '#00ff87' },
    { label: '진행', val: running, color: '#d29922' },
    { label: '차단', val: blocked, color: '#ff5d5d' },
    { label: '대기', val: Math.max(0, pending), color: '#8fa3b5' },
  ];
  const max = Math.max(1, ...segments.map(s => s.val));
  const bars = segments.map(s => {
    const w = Math.round(s.val / max * 100);
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
      '<span style="width:50px;font-size:10px;color:var(--panel-text-dim)">' + s.label + '</span>' +
      '<div style="flex:1;height:14px;background:var(--dark-3);border-radius:4px;overflow:hidden">' +
      '<div style="width:' + w + '%;height:100%;background:' + s.color + ';border-radius:4px"></div></div>' +
      '<span style="width:30px;font-size:10px;text-align:right">' + s.val + '</span></div>';
  }).join('');
  body.innerHTML += '<div style="margin-top:14px"><strong style="font-size:12px">실행 퍼널</strong>' + bars + '</div>';
}
async function renderCostLatency() {
  const body = document.getElementById('stats-body');
  if (!body) return;
  try {
    const r = await fetch(API_BASE + '/api/spans');
    const j = await r.json();
    const spans = j.success ? (j.spans || []) : [];
    if (spans.length === 0) return;
    const totalMs = spans.reduce((a, s) => a + (s.duration_ms || 0), 0);
    const avgMs = Math.round(totalMs / spans.length);
    const failCount = spans.filter(s => !(s.result && s.result.ok)).length;
    const estTokens = Math.round(totalMs * 0.5);
    const estCost = (estTokens / 1000) * 0.002;
    body.innerHTML += '<div style="margin-top:14px;font-size:11px;color:var(--panel-text-dim)">' +
      '<strong style="color:var(--panel-text)">비용/지연</strong><br>' +
      '평균 지연: ' + avgMs + 'ms · 총 ' + spans.length + ' 실행 · 실패 ' + failCount + '건<br>' +
      '추정 토큰: ' + estTokens + 'K · 추정 비용: $' + estCost.toFixed(4) + '</div>';
  } catch (e) {}
}

document.getElementById('btn-trace').addEventListener('click', () => {
  document.getElementById('trace-panel').style.display = 'block';
  renderTraceTimeline();
});
document.getElementById('trace-refresh').addEventListener('click', renderTraceTimeline);
document.getElementById('trace-filter').addEventListener('change', renderTraceTimeline);
document.getElementById('trace-close').addEventListener('click', () => {
  document.getElementById('trace-panel').style.display = 'none';
});

// ═══ 6차 고도화 모듈 (딥리서치 2차) ═══
