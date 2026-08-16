// ESC → 가장 위에 열린 패널 하나만 닫기 (document 위임 리스너 1개)
// 지시서 #32 배치 A — Kimi 워커 초안 + 할매봇 보정
// 보정: (1) z-index 동률 시 DOM 후순위 우선  (2) 명령 팔레트 열려 있으면 패널 안 닫음
(function () {
  var PANEL_IDS = [
    'trace-panel', 'agents-panel', 'agent-dash', 'session-panel', 'market-panel',
    'feed-panel', 'test-panel', 'gov-panel', 'edge-log-panel', 'credentialModal',
    'mcp-panel', 'team-panel', 'ai-panel', 'stats-panel', 'runlog-panel'
  ];

  function isOpen(el) {
    if (el.id === 'credentialModal') return el.hidden === false;
    return el.style.display === 'block';
  }

  function getZ(el) {
    var z = parseInt(window.getComputedStyle(el).zIndex, 10);
    return isNaN(z) ? 0 : z;
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;

    // 입력 필드에서는 그대로 둠 — 인라인 편집 취소(groups-export-ws.js:88)와 충돌 방지
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;

    // 명령 팔레트가 열려 있으면 패널은 건드리지 않는다 — 팔레트 자체 리스너(virtual-render-palette.js:37)가 닫는다
    var pal = document.getElementById('cmd-palette');
    if (pal && pal.style.display !== 'none') return;

    var top = null;
    var topZ = -Infinity;
    var topIdx = -1;
    for (var i = 0; i < PANEL_IDS.length; i++) {
      var el = document.getElementById(PANEL_IDS[i]);
      if (!el || !isOpen(el)) continue;
      var z = getZ(el);
      // z-index 크거나, 같으면 PANEL_IDS 순서상 뒤(=DOM 후순위, 시각적 위)
      if (z > topZ || (z === topZ && i > topIdx)) {
        topZ = z; top = el; topIdx = i;
      }
    }
    if (!top) return;

    if (top.id === 'credentialModal') top.hidden = true;
    else top.style.display = 'none';
  });
})();
