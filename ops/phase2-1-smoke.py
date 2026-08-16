#!/usr/bin/env python3
"""Phase 2-1 화면 회귀 스모크 - 이름 정리 후 콘솔 에러 없이 주요 UI 요소가 뜨는지."""
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:3737/index.html"

def main():
    errors = []
    checks = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context()
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type in ("error",) else None)
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

        page.goto(URL, wait_until="networkidle", timeout=15000)
        page.wait_for_timeout(1500)  # 후속 스크립트 안정화

        # 1) 스크립트 16개 다 로드 됐는가
        script_srcs = page.eval_on_selector_all(
            'script[src^="js/"]', "els => els.map(e => e.getAttribute('src'))"
        )
        checks["script_src_count"] = len(script_srcs)
        checks["script_srcs"] = script_srcs

        # 2) NODE_TYPES(core-store)와 renderCanvas(canvas-render), undo(undo-run-engine),
        #    executeWorkflow(exec-status), toggleGroup(groups-export-ws) 전역 존재
        globals_present = page.evaluate("""() => ({
            NODE_TYPES: typeof NODE_TYPES !== 'undefined',
            renderCanvas: typeof renderCanvas === 'function',
            undo: typeof undo === 'function',
            executeWorkflow: typeof executeWorkflow === 'function',
            toggleGroup: typeof toggleGroup === 'function',
            MORE_ITEMS: typeof MORE_ITEMS !== 'undefined',
            loadTeamStatus: typeof loadTeamStatus === 'function',
        })""")
        checks["globals_present"] = globals_present

        # 3) 사이드바 · 캔버스 · 인스펙터 등 주요 DOM
        dom_present = page.evaluate("""() => ({
            sidebar: !!document.querySelector('#sidebar, .sidebar'),
            canvas_wrap: !!document.getElementById('canvas-wrap'),
            inspector_body: !!document.getElementById('inspector-body'),
        })""")
        checks["dom_present"] = dom_present

        # 4) 페이지 타이틀
        checks["title"] = page.title()

        browser.close()

    print("=== checks ===")
    for k, v in checks.items():
        print(f"{k}: {v}")
    print("\n=== console errors ===")
    if errors:
        for e in errors:
            print(e)
    else:
        print("없음")

    # 판정
    fatal = (
        errors
        or checks["script_src_count"] != 16
        or not all(globals_present.values())
        or not all(dom_present.values())
    )
    print("\n[결과]", "FAIL" if fatal else "PASS")
    sys.exit(1 if fatal else 0)

if __name__ == "__main__":
    main()
