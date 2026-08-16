// 패널 포커스 관리 — 지시서 #32 배치 B
// (1) 패널 열릴 때 안으로 포커스 이동
// (2) 패널 닫힐 때 열었던 버튼으로 포커스 복귀
//
// 구현 방식: MutationObserver로 style.display / hidden 변화를 감지.
// 패널마다 개별 토글 함수를 고치지 않고 한 곳에서 처리한다.
(function () {
  var PANEL_IDS = [
    'trace-panel', 'agents-panel', 'agent-dash', 'session-panel', 'market-panel',
    'feed-panel', 'test-panel', 'gov-panel', 'edge-log-panel', 'credentialModal',
    'mcp-panel', 'team-panel', 'ai-panel', 'stats-panel', 'runlog-panel'
  ];

  // 패널 id → 그 패널을 마지막으로 연 요소 (복귀 대상)
  var openers = {};

  function isOpen(el) {
    if (el.id === 'credentialModal') return el.hidden === false;
    return el.style.display === 'block';
  }

  function firstFocusable(panel) {
    return panel.querySelector(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea, a[href]'
    );
  }

  // 패널이 열리는 순간 포착 — 이 시점의 activeElement가 "연 버튼"이다
  function onPanelOpen(panel) {
    var opener = document.activeElement;
    // body에 포커스가 있으면 복귀 대상이 없다고 보고 저장하지 않는다
    if (opener && opener !== document.body && opener !== document.documentElement) {
      openers[panel.id] = opener;
    }
    var target = firstFocusable(panel);
    if (target) {
      // 렌더링이 끝난 뒤 포커스를 줘야 실제로 이동한다
      requestAnimationFrame(function () { target.focus(); });
    }
  }

  function onPanelClose(panel) {
    var opener = openers[panel.id];
    if (opener && document.contains(opener) && typeof opener.focus === 'function') {
      // 닫기 버튼에 포커스가 남아 있으면 연 버튼으로 복귀
      if (panel.contains(document.activeElement) || document.activeElement === document.body) {
        opener.focus();
      }
    }
    delete openers[panel.id];
  }

  // 각 패널에 MutationObserver 부착 — style/hidden 속성 변화 감지
  var observers = [];
  var prevState = {};

  function attach(panel) {
    prevState[panel.id] = isOpen(panel);
    var mo = new MutationObserver(function () {
      var now = isOpen(panel);
      var was = prevState[panel.id];
      if (now === was) return;
      prevState[panel.id] = now;
      if (now) onPanelOpen(panel);
      else onPanelClose(panel);
    });
    mo.observe(panel, { attributes: true, attributeFilter: ['style', 'hidden'] });
    observers.push(mo);
  }

  // DOM 로드 후 부착 — 스크립트가 </body> 직전이라 바로 실행 가능
  for (var i = 0; i < PANEL_IDS.length; i++) {
    var el = document.getElementById(PANEL_IDS[i]);
    if (el) attach(el);
  }
})();
