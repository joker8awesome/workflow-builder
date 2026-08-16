#!/usr/bin/env python3
"""지시서 #33 — 네트워크 경계 12개 함수 코드 리뷰 (Kimi 워커, 13회 호출).

/api/llm/worker 를 Bearer(WF_HERMES_KEY)로 호출한다.
truncated:true 응답은 max_tokens=2500 으로 해당 함수만 재호출한다.
결과는 ops/review2/results.json 에 누적 저장한다.
"""
import json, os, subprocess, sys, time, urllib.request

ROOT = '/opt/data/projects/workflow-builder'
OUT = os.path.join(ROOT, 'ops', 'review2', 'results.json')
TRACE = 'review2-20260817'
KEY = 'wf_ak_ag_hermes_ookXdnYP1LABSNJTunK58IE4qtO9p-NI'
URL = 'http://localhost:3737/api/llm/worker'

PROMPT_TAIL = """
맥락: {q}

이 함수가 조용히 실패할 수 있는 지점을 한 문단으로 지적하라.
그런 지점이 없으면 "문제 없음"이라고만 답하라.

위 코드에 없는 함수·변수·파일은 언급하지 마라.
확실하지 않으면 "확실하지 않음"이라고 답하라. 추측하지 마라."""

TARGETS = [
    # (key, file, func_name, question)
    ('checkServer', 'core-store.js', 'checkServer', '서버 생사를 판단한다. 응답이 500이면 살아있다고 보나?'),
    ('loadFromServer', 'core-store.js', 'loadFromServer', '서버 데이터로 로컬을 덮는다. 응답이 비었거나 깨졌으면?'),
    ('loadTplFromServer', 'core-store.js', 'loadTplFromServer', '템플릿을 받는다. 실패하면 화면은 어떻게 되나?'),
    ('updateSyncStatus', 'core-store.js', 'updateSyncStatus', '동기화 상태를 표시한다. 실제 상태와 어긋날 수 있나?'),
    ('runNodeAction', 'exec-status.js', 'runNodeAction', '노드 액션을 실행한다. 실패를 어떻게 알리나?'),
    ('broadcastLocalChange', 'exec-status.js', 'broadcastLocalChange', '다른 탭에 변경을 알린다. 실패하면?'),
    ('patchWSHandler', 'exec-status.js', 'patchWSHandler', 'WebSocket 메시지를 처리한다. 잘못된 메시지가 오면?'),
    ('executeWorkflow_A', 'exec-status.js', 'executeWorkflow', '워크플로우를 실행한다. 중간 노드가 실패하면 나머지는? (앞부분: 실행 준비·노드 순회)'),
    ('executeWorkflow_B', 'exec-status.js', 'executeWorkflow', '워크플로우를 실행한다. 중간 노드가 실패하면 나머지는? (뒷부분: 결과 처리·상태 갱신)'),
    ('loadTests', 'tests-more-menu.js', 'loadTests', '테스트 목록을 받는다. 실패하면 빈 목록인가 오류인가?'),
    ('runRegressionGate', 'tests-more-menu.js', 'runRegressionGate', '회귀 게이트를 돌린다. 일부만 실패하면 판정은?'),
    ('sendAgentCommand', 'tests-more-menu.js', 'sendAgentCommand', '에이전트에 명령을 보낸다. 도달 확인을 하나?'),
    ('refreshMCPStatus', 'tests-more-menu.js', 'refreshMCPStatus', 'MCP 상태를 갱신한다. 응답을 검사하나?'),
]


def extract_body(fname, func, part=None):
    """awk로 함수 본문을 뽑는다. executeWorkflow만 앞/뒤로 나눈다."""
    path = os.path.join(ROOT, 'js', fname)
    prefix = 'async function ' if func in ('checkServer', 'loadFromServer', 'loadTplFromServer',
                                           'executeWorkflow', 'loadTests', 'runRegressionGate',
                                           'sendAgentCommand', 'refreshMCPStatus') else 'function '
    out = subprocess.run(['awk', f'/^{prefix}{func}/,/^}}/', path],
                         capture_output=True, text=True).stdout
    if part == 'A':
        return '\n'.join(out.splitlines()[:57])   # 실행 준비~노드 순회
    if part == 'B':
        return '\n'.join(out.splitlines()[57:])   # 결과 처리~상태 갱신
    return out


def call_worker(prompt, max_tokens):
    body = json.dumps({
        'prompt': prompt, 'agent_id': 'ag_deepseek', 'report_to': 'ag_hermes',
        'max_tokens': max_tokens, 'trace_id': TRACE,
    }).encode()
    req = urllib.request.Request(URL, data=body, method='POST', headers={
        'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY,
    })
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())


def main():
    results = {}
    if os.path.exists(OUT):
        results = json.load(open(OUT))
    stats = {'calls': 0, 'truncated': 0, 'retries': 0, 'errors': []}

    for key, fname, func, q in TARGETS:
        if key in results and results[key].get('final'):
            print(f'[skip] {key} — 이미 완료')
            continue
        part = {'executeWorkflow_A': 'A', 'executeWorkflow_B': 'B'}.get(key)
        code = extract_body(fname, func, part)
        prompt = f'아래는 js/{fname} 의 함수다.\n\n{code}\n' + PROMPT_TAIL.format(q=q)
        mt = 2500 if key.startswith('executeWorkflow') else 1500

        try:
            resp = call_worker(prompt, mt)
        except Exception as e:
            stats['errors'].append(f'{key}: {e}')
            print(f'[error] {key}: {e}')
            continue
        stats['calls'] += 1
        entry = {'answer': resp.get('result', ''), 'truncated': resp.get('truncated', False),
                 'model': resp.get('model', ''), 'max_tokens': mt, 'final': not resp.get('truncated', False)}

        # 잘렸으면 해당 함수만 2500으로 재호출
        if entry['truncated']:
            stats['truncated'] += 1
            print(f'[truncated] {key} — max_tokens 2500으로 재호출')
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
        ans_head = (entry['answer'] or '')[:80].replace('\n', ' ')
        print(f'[{key}] truncated={entry["truncated"]} | {ans_head}')
        time.sleep(1)  # rate limit 여유

    print('\n=== 요약 ===')
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    judged = sum(1 for v in results.values() if v.get('final'))
    print(f'판단 완료: {judged}/13')


if __name__ == '__main__':
    main()
