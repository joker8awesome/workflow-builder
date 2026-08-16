#!/usr/bin/env python3
"""지시서 #39 — 쓰기 라우트 12개 함수의 '조용한 실패' 리뷰 (Kimi 워커).

#33(review2)과 같은 방식. 함수당 1회 호출, max_tokens 2500.
truncated:true → 해당 함수만 재호출(의무).
결과는 ops/review3/results.json 에 누적.

🔴 키는 환경변수 WF_HERMES_KEY 로만. 소스에 박지 마라.
"""
import json, os, subprocess, sys, time, urllib.request

ROOT = '/opt/data/projects/workflow-builder'
OUT = os.path.join(ROOT, 'ops', 'review3', 'results.json')
TRACE = 'review3-silent-write-20260817'
KEY = os.environ.get('WF_HERMES_KEY', '')
if not KEY:
    sys.exit('WF_HERMES_KEY 가 설정돼 있지 않다. export 후 다시 실행해라.')
URL = 'http://localhost:3737/api/llm/worker'

PROMPT_TEMPLATE = """아래는 js/{fname} 에 있는 함수 {func} 의 전문이다.

```js
{code}
```

추측하지 마라. 붙인 코드에 없는 것은 없다고 답해라.

질문: 이 함수에서 **조용히 실패할 수 있는 지점**은 어디인가?
그 지점이 실패했을 때 **사용자는 무엇을 잘못 믿게 되는가?**
코드 수정안이 아니라 **결과**를 말해라.

맥락: 이 함수는 {route} 를 호출한다. 실패하면 사용자는 {belief}"""

# (key, file, func, route, user_belief_on_failure)
TARGETS = [
    ('logApproval',       'approvals-metrics.js', 'logApproval',       'POST /api/approvals',            '승인했다고 믿는다'),
    ('shouldAutoApprove', 'approvals-metrics.js', 'shouldAutoApprove', 'GET /api/trust',                 '자동 승인이 왜 안 됐는지 모른다'),
    ('addKnowledge',      'approvals-metrics.js', 'addKnowledge',      'POST /api/knowledge',            '지식이 등록됐다고 믿는다'),
    ('notifyTelegramAlert','activity-feed.js',    'notifyTelegramAlert','POST /api/exec · /api/audit',   '알림이 갔다고 믿는다'),
    ('saveRunResult',     'script-exec-pwa.js',   'saveRunResult',     'POST …/results',                 '실행 결과가 남았다고 믿는다'),
    ('addComment',        'script-exec-pwa.js',   'addComment',        'POST …/comments',                '댓글이 달렸다고 믿는다'),
    ('publishTemplate',   'templates-market.js',  'publishTemplate',   'POST /api/templates',            '게시됐다고 믿는다'),
    ('logAudit',          'templates-market.js',  'logAudit',          'POST /api/audit',                '감사 기록이 남았다고 믿는다'),
    ('addTest',           'tests-more-menu.js',   'addTest',           'POST /api/tests',                '테스트가 등록됐다고 믿는다'),
    ('installExample',    'tests-more-menu.js',   'installExample',    'POST /api/examples/install',     '설치됐다고 믿는다'),
    ('registerWebhook',   'llm-trace.js',         'registerWebhook',   'POST /api/webhook/register',     '웹훅이 걸렸다고 믿는다'),
    ('shareWorkflow',     'undo-run-engine.js',   'shareWorkflow',     'PUT /api/workflows/:id',         '공유 링크를 받는다 — 내용은 안 올라갔는데'),
]


def extract_body(fname, func):
    """awk로 함수 본문을 뽑는다. async 여부는 파일에서 판단."""
    path = os.path.join(ROOT, 'js', fname)
    for prefix in ('async function ', 'function '):
        out = subprocess.run(['awk', f'/^{prefix}{func}/,/^}}/', path],
                             capture_output=True, text=True).stdout
        if out.strip():
            return out
    return ''


def call_worker(prompt, max_tokens):
    body = json.dumps({
        'prompt': prompt, 'agent_id': 'ag_deepseek', 'report_to': 'ag_hermes',
        'max_tokens': max_tokens, 'trace_id': TRACE,
    }).encode()
    req = urllib.request.Request(URL, data=body, method='POST', headers={
        'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY,
    })
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def main():
    results = {}
    if os.path.exists(OUT):
        results = json.load(open(OUT))
    stats = {'calls': 0, 'truncated': 0, 'retries': 0, 'errors': []}

    for key, fname, func, route, belief in TARGETS:
        if key in results and results[key].get('final'):
            print(f'[skip] {key} — 이미 완료')
            continue
        code = extract_body(fname, func)
        if not code.strip():
            stats['errors'].append(f'{key}: 함수 본문 추출 실패')
            print(f'[error] {key}: 본문 없음')
            continue
        prompt = PROMPT_TEMPLATE.format(fname=fname, func=func, code=code,
                                        route=route, belief=belief)

        try:
            resp = call_worker(prompt, 2500)
        except Exception as e:
            stats['errors'].append(f'{key}: {e}')
            print(f'[error] {key}: {e}')
            continue
        stats['calls'] += 1
        entry = {'answer': resp.get('result', ''), 'truncated': resp.get('truncated', False),
                 'model': resp.get('model', ''), 'max_tokens': 2500,
                 'final': not resp.get('truncated', False)}

        if entry['truncated']:
            stats['truncated'] += 1
            print(f'[truncated] {key} — 2500으로 재호출')
            time.sleep(2)
            try:
                resp2 = call_worker(prompt, 2500)
                stats['calls'] += 1
                stats['retries'] += 1
                entry = {'answer': resp2.get('result', ''), 'truncated': resp2.get('truncated', False),
                         'model': resp2.get('model', ''), 'max_tokens': 2500,
                         'final': not resp2.get('truncated', False)}
            except Exception as e:
                stats['errors'].append(f'{key} retry: {e}')

        results[key] = entry
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        json.dump(results, open(OUT, 'w'), ensure_ascii=False, indent=2)
        ans_head = (entry['answer'] or '')[:90].replace('\n', ' ')
        print(f'[{key}] truncated={entry["truncated"]} | {ans_head}')
        time.sleep(1)

    print('\n=== 요약 ===')
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    judged = sum(1 for v in results.values() if v.get('final'))
    print(f'판단 완료: {judged}/12')


if __name__ == '__main__':
    main()
