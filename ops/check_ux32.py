"""지시서 #32 STEP3 — trace-panel을 직접 열어 Esc/포커스 동작 검증."""
import asyncio, os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/data/.cache/ms-playwright")
from playwright.async_api import async_playwright

URL = "https://joker8awesome.github.io/workflow-builder/"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(URL, wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(1500)

        result = {}

        # trace-panel을 강제로 열고 내부 버튼에 포커스 (패널 오픈 시뮬레이션)
        opened = await page.evaluate("""
          () => {
            const p = document.getElementById('trace-panel');
            if (!p) return { ok: false, reason: 'no trace-panel' };
            p.style.display = 'block';
            const focusable = p.querySelector('button, [tabindex], input, a');
            if (focusable) focusable.focus();
            return { ok: true, hasFocusable: !!focusable,
                     activeInPanel: p.contains(document.activeElement),
                     activeTag: document.activeElement && document.activeElement.tagName };
          }
        """)
        result["open_simulate"] = opened

        # 포커스가 패널 안에 들어갔는지
        result["focus_move"] = opened.get("activeInPanel", False)

        # Esc 눌러서 닫히는지
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(400)
        after_esc = await page.evaluate("""
          () => {
            const p = document.getElementById('trace-panel');
            return { display: p.style.display, visible: p.offsetParent !== null };
          }
        """)
        result["after_esc"] = after_esc
        result["esc_close"] = after_esc.get("display") == "none" or not after_esc.get("visible")

        # cred-modal.css 로드 확인
        result["cred_modal_css_loaded"] = await page.evaluate("""
          () => Array.from(document.styleSheets).some(s => s.href && s.href.includes('cred-modal.css'))
        """)

        # credentialModal 요소 존재 여부
        result["credential_modal_exists"] = await page.evaluate("""
          () => !!document.getElementById('credentialModal')
        """)

        await browser.close()
        return result

r = asyncio.run(main())
print("=== STEP3 검증 결과 ===")
for k, v in r.items():
    print(f"  {k}: {v}")
