"""지시서 #32 배치 A·B 브라우저 검증"""
import asyncio
from playwright.async_api import async_playwright

PANELS = [
    'trace-panel', 'agents-panel', 'agent-dash', 'session-panel', 'market-panel',
    'feed-panel', 'test-panel', 'gov-panel', 'edge-log-panel',
    'mcp-panel', 'team-panel', 'ai-panel', 'stats-panel', 'runlog-panel'
]

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto('http://localhost:3737/', wait_until='domcontentloaded')
        await page.wait_for_timeout(1500)

        print('== 1. role=dialog / aria-modal 카운트 ==')
        role = await page.evaluate('document.querySelectorAll(\'[role="dialog"]\').length')
        modal = await page.evaluate('document.querySelectorAll(\'[aria-modal="true"]\').length')
        labelledby = await page.evaluate('document.querySelectorAll(\'[aria-labelledby]\').length')
        print(f'  role=dialog: {role} (기대 15)')
        print(f'  aria-modal=true: {modal} (기대 15)')
        print(f'  aria-labelledby: {labelledby} (기대 15 이상)')

        print('\n== 2. Esc로 패널 닫기 (3개) ==')
        # agents-panel 열기
        await page.evaluate('document.getElementById("agents-panel").style.display = "block"')
        await page.wait_for_timeout(200)
        visible_before = await page.evaluate('document.getElementById("agents-panel").style.display')
        print(f'  agents-panel 열림: display={visible_before}')
        await page.keyboard.press('Escape')
        await page.wait_for_timeout(200)
        visible_after = await page.evaluate('document.getElementById("agents-panel").style.display')
        print(f'  Esc 후: display={visible_after} (기대 none)')
        assert visible_after == 'none', 'agents-panel Esc 실패'

        # trace-panel
        await page.evaluate('document.getElementById("trace-panel").style.display = "block"')
        await page.wait_for_timeout(200)
        await page.keyboard.press('Escape')
        await page.wait_for_timeout(200)
        v = await page.evaluate('document.getElementById("trace-panel").style.display')
        print(f'  trace-panel Esc 후: {v} (기대 none)')
        assert v == 'none'

        # gov-panel
        await page.evaluate('document.getElementById("gov-panel").style.display = "block"')
        await page.wait_for_timeout(200)
        await page.keyboard.press('Escape')
        await page.wait_for_timeout(200)
        v = await page.evaluate('document.getElementById("gov-panel").style.display')
        print(f'  gov-panel Esc 후: {v} (기대 none)')
        assert v == 'none'

        print('\n== 3. 포커스 이동·복귀 ==')
        # btn-agents로 agents-panel 열고 포커스가 안으로 이동하는지
        await page.click('#btn-agents')
        await page.wait_for_timeout(300)
        focused_id = await page.evaluate('document.activeElement && document.activeElement.id')
        panel_contains = await page.evaluate(
            'document.getElementById("agents-panel").contains(document.activeElement)'
        )
        print(f'  열기 후 포커스: id={focused_id}, 패널 안? {panel_contains}')

        # Esc로 닫고 포커스 복귀 확인
        await page.keyboard.press('Escape')
        await page.wait_for_timeout(300)
        focused_after = await page.evaluate('document.activeElement && document.activeElement.id')
        print(f'  Esc 후 포커스: id={focused_after} (기대 btn-agents)')

        await browser.close()
        print('\nPASS')

asyncio.run(main())
