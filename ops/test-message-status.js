#!/usr/bin/env node
/**
 * agent_messages 상태 어휘 검증.
 *
 * 이 프로젝트에는 메시지 상태 어휘가 **두 벌** 있다:
 *
 *   큐(픽업) 경로 : pending → claimed → completed
 *     agent.tasks.list_pending / claim, send_to_center.py, 텔레그램 지시 적재
 *
 *   오케스트레이터 : sent → read
 *     agent_orchestrator.py 가 워크플로우 실행 중 주고받는 메시지
 *
 * 둘은 섞이지 않는다. 오케스트레이터가 보낸 메시지는 list_pending 에 잡히지 않는다.
 * 이건 의도된 분리이되, **모르면 사고가 난다** — 실제로 POST /api/messages 가
 * 'sent' 로 넣는 바람에 그 API 로 보낸 메시지는 아무도 받지 못했다.
 *
 * 실행: node ops/test-message-status.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const MCP = fs.readFileSync(path.join(ROOT, 'mcp-router.js'), 'utf8');

let fails = [];
function check(name, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (!cond && detail ? '\n         ' + detail : ''));
  if (!cond) fails.push(name);
}

console.log('1) 픽업 경로가 같은 값을 쓰는가');
check('list_pending 은 pending 을 조회',
  /msg_type = ANY\(\$3\) AND status = 'pending'/.test(MCP));
check('claim 은 pending → claimed',
  /SET status = 'claimed'[\s\S]{0,120}status = 'pending'/.test(MCP));

console.log('\n2) 메시지를 만드는 곳이 pending 으로 넣는가');
// 여기가 어긋나면 "보냈는데 아무도 못 받는" 상태가 된다
check('agent.send_message 가 pending',
  /INSERT INTO agent_messages[\s\S]{0,300}'pending'/.test(MCP),
  'MCP 로 보낸 지시가 픽업되지 않는다');
check('POST /api/messages 기본값이 pending',
  /\|\| 'command', from_agent, to_agent, session_id \|\| '', JSON\.stringify\(payload \|\| \{\}\), st\]/.test(SRV)
  && /includes\(status\)\s*\n?\s*\? status : 'pending'/.test(SRV),
  "이 API 가 'sent' 로 넣으면 list_pending 에 영영 안 보인다 (실제로 그랬다)");
check('텔레그램 지시 적재가 pending',
  /'instruction', \$1, 'ag_claude_desktop', \$2, 'pending'/.test(SRV),
  '사용자가 봇에 보낸 지시가 전달되지 않는다');
// 워커 결과도 같은 경로를 탄다. 여기가 'sent' 면 시킨 사람이 결과를 못 받는다.
check('LLM 워커 보고가 pending',
  /VALUES \('report', \$1, \$2, \$3, 'pending', \$4\)/.test(SRV),
  '워커 결과가 큐에서 아무에게도 보이지 않는다');
check('LLM 워커 보고 수신자가 고정돼 있지 않다',
  /report_to \|\| req\.agent_id/.test(SRV),
  "'ag_orch' 로 박혀 있으면 지시한 쪽과 받는 쪽이 달라진다");

console.log('\n2-1) LLM 워커가 실패를 성공으로 포장하지 않는가');
// 제공자가 404 를 줘도 그 오류 JSON 이 "결과"가 되고 success:true 로 나갔다.
// 모델명이 잘못 바뀐 뒤 모든 호출이 실패했는데 아무도 몰랐다 (2026-08-16).
check('실패 시 502 로 응답',
  /res\.status\(502\)\.json\(\{ success: false, error: 'llm_failed'/.test(SRV),
  '오류를 success:true 로 돌려주면 워커 결과를 믿는 쪽이 거짓을 받는다');
check('실패 보고는 ok:false 로 기록',
  /JSON\.stringify\(\{ ok: false, error: detail \}\)/.test(SRV),
  'ok:true 로 남으면 나중에 로그를 봐도 실패를 못 찾는다');
check('오류 본문을 결과로 승격하지 않는다',
  !/message\.content\) \|\| JSON\.stringify\(j\)/.test(SRV),
  '|| JSON.stringify(j) 가 있으면 제공자 오류가 그대로 결과가 된다');
// 잘린 답은 틀린 답보다 위험하다 — 앞부분이 그럴듯해서 완성된 결론으로 읽힌다.
check('절단을 응답에 알린다',
  /finish_reason === 'length'/.test(SRV) && /truncated, max_tokens: maxTokens/.test(SRV),
  '잘렸는지 모르면 받는 쪽이 미완성 답을 결론으로 쓴다');
check('절단 시 ok:false 로 기록',
  /ok: !truncated, truncated/.test(SRV),
  'ok:true 로 남으면 나중에 로그를 봐도 미완성인 줄 모른다');
// agents 테이블의 이름을 바꿔도 라우트가 부르는 모델은 안 바뀐다.
// 실제로 ag_deepseek 을 "Kimi 워커"로 고쳐놓고 라우트는 그대로였다.
check('어떤 모델이 답했는지 응답에 싣는다',
  /model: workerModel, truncated/.test(SRV),
  '에이전트 이름만 바꾸고 모델은 그대로여도 밖에서 알 수 없다');
check('실패 응답에도 모델명을 싣는다',
  /error: 'llm_failed', detail, model: workerModel/.test(SRV),
  '모델명이 틀려서 실패했는지 구분해야 한다 — 오늘 그것 때문에 하루를 썼다');

console.log('\n3) 오케스트레이터 어휘는 분리돼 있음을 확인 (의도된 것)');
const ORCH = fs.existsSync(path.join(ROOT, 'agent_orchestrator.py'))
  ? fs.readFileSync(path.join(ROOT, 'agent_orchestrator.py'), 'utf8') : '';
check('오케스트레이터는 sent/read 를 쓴다',
  /'sent'/.test(ORCH) && /status='read'/.test(ORCH),
  '어휘가 바뀌었다면 poll_inbox 와 함께 확인할 것');
console.log('         ⚠ 오케스트레이터가 보낸 메시지는 list_pending 에 잡히지 않는다.');
console.log('           픽업이 필요한 지시는 pending 으로 넣어야 한다.');

console.log('\n' + (fails.length
  ? `실패 ${fails.length}건: ${fails.join(', ')}`
  : '전부 통과'));
process.exit(fails.length ? 1 : 0);
