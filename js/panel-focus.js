// 패널 포커스 관리 — 지시서 #32 배치 B
// (1) 패널 열릴 때 안으로 포커스 이동
// (2) 패널 닫힐 때 열었던 버튼으로 포커스 복귀
//
// 구현 방식: MutationObserver로 style.display / hidden 변화를 감지.
// 패널마다 개별 토글 함수를 고치지 않고 한 곳에서 처리한다.
//
// 옵저버는 공통 조상 하나(document.body)에만 붙인다 — 패널 15개가 각각
// 하나씩 붙이던 것을 1개로 줄인다. 근거: credentialModal 은 <body> 직속,
// runlog-panel 은 #app 앞에 있어 이 15개를 정확히 감싸는 전용 컨테이너가
// index.html 에 없다. 모든 패널의 유일한 공통 조상은 document.body 다.
(function () {
  // PANEL_IDS 는 esc-panel-close.js(먼저 로드됨)가 정의·노출한다.
  // 여기서는 그 전역을 소비한다. 전역이 없을 때의 방어적 fallback 은
  // 목록 복사본이 아니라 빈 배열이다 — 15개를 두 곳에 중복하면 드리프트가
  // 생긴다. esc-panel-close.js 가 항상 먼저 로드되므로 fallback 은
  // 실제로는 쓰이지 않고, 만약 없더라도 조용히 no-op 이 되어 이후
  // 스크립트를 죽이지 않는다.
  var PANEL_IDS = window.__CC_PANEL_IDS || [];
  var PANEL_ID_SET = {};
  for (var k = 0; k < PANEL_IDS.length; k++) PANEL_ID_SET[PANEL_IDS[k]] = true;

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

  // 단일 MutationObserver — 공통 조상(document.body) 하나에만 붙는다.
  // style/hidden 변화를 subtree 전체에서 잡되, 변경된 target 이 우리
  // 패널 중 하나일 때만 처리한다(그 외에는 즉시 early-out). 패널 자신의
  // style/hidden 변화는 언제나 target 이 그 패널인 record 를 만들므로
  // 이 필터로 기존 per-panel 옵저버 의미를 그대로 유지한다. 캔버스
  // 드래그 등 다른 요소의 잦은 style 변경으로는 재검사가 돌지 않는다.
  var prevState = {};

  // 15개 전부 명시적으로 seed — undefined 와 비교해 헛발 close 가
  // 나지 않도록 한다(el 이 없으면 닫힘으로 간주).
  for (var i = 0; i < PANEL_IDS.length; i++) {
    var seedEl = document.getElementById(PANEL_IDS[i]);
    prevState[PANEL_IDS[i]] = seedEl ? isOpen(seedEl) : false;
  }

  function evaluate(id) {
    var panel = document.getElementById(id);
    if (!panel) return;
    var now = isOpen(panel);
    if (now === prevState[id]) return;
    prevState[id] = now;
    if (now) onPanelOpen(panel);
    else onPanelClose(panel);
  }

  var observer = new MutationObserver(function (records) {
    for (var r = 0; r < records.length; r++) {
      var t = records[r].target;
      // Element 이고, id 가 우리 패널 목록에 있을 때만 반응
      if (t && t.nodeType === 1 && PANEL_ID_SET[t.id]) evaluate(t.id);
    }
  });

  // 스크립트가 </body> 직전이라 body 는 이미 존재한다.
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'hidden']
  });
})();
