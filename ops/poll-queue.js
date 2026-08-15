#!/usr/bin/env node
/**
 * poll-queue.js — 나(ag_claude_desktop) 앞으로 온 지시가 있는지 확인한다.
 *
 * Claude Code 세션은 스스로 깨어나지 못한다. 할매봇이 agent.send_message 로
 * 지시를 남겨도, 내 세션이 떠 있지 않으면 아무도 읽지 않는다.
 * 이 스크립트를 스케줄러에 걸어 "큐에 뭔가 있으면 세션을 띄우는" 역할을 맡긴다.
 *
 * 사용법:
 *   node ops/poll-queue.js              # 확인만 (기본)
 *   node ops/poll-queue.js --run        # 대기 건이 있으면 claude 세션을 띄운다
 *   node ops/poll-queue.js --json       # 기계 판독용 출력
 *
 * 종료 코드:
 *   0  대기 건 있음
 *   1  대기 건 없음
 *   2  오류 (인증·네트워크)
 *
 * 키는 .mcp.json 에서 읽는다 (gitignore 대상). WF_MCP_KEY 로 덮어쓸 수 있다.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.WF_MCP_URL || 'https://187.127.124.16.sslip.io/mcp';
const RUN = process.argv.includes('--run');
const JSON_OUT = process.argv.includes('--json');

function readKey() {
  if (process.env.WF_MCP_KEY) return process.env.WF_MCP_KEY;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
    const h = cfg.mcpServers?.['workflow-builder']?.headers?.Authorization || '';
    return h.replace(/^Bearer\s+/, '');
  } catch (e) {
    return '';
  }
}

async function callTool(key, name, args) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'mcp_error');
  const txt = j.result?.content?.[0]?.text;
  return txt ? JSON.parse(txt) : {};
}

function log(...a) { if (!JSON_OUT) console.log(...a); }

async function main() {
  const key = readKey();
  if (!key) {
    console.error('❌ MCP 키를 찾을 수 없다. .mcp.json 또는 WF_MCP_KEY 를 확인할 것.');
    process.exit(2);
  }

  let tasks = [];
  try {
    // report 도 함께 본다. 할매봇이 send_to_center.py 로 보내는 보고가
    // msg_type='report' 라, 기본값(command/instruction)만 보면
    // 큐에 쌓이기만 하고 이쪽에서는 영영 보이지 않는다.
    const out = await callTool(key, 'agent.tasks.list_pending', {
      limit: 20,
      types: ['command', 'instruction', 'report'],
    });
    tasks = out.tasks || [];
  } catch (e) {
    console.error('❌ 큐 조회 실패:', e.message);
    process.exit(2);
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ count: tasks.length, tasks }, null, 2));
  } else if (!tasks.length) {
    log(`[${new Date().toISOString()}] 대기 건 없음`);
  } else {
    log(`[${new Date().toISOString()}] 대기 ${tasks.length}건`);
    for (const t of tasks) {
      log(`  ${t.message_id} | ${t.from_agent} → ${t.type} | trace=${t.trace_id || '-'} | ref=${t.payload_ref || '-'}`);
    }
  }

  if (!tasks.length) process.exit(1);

  if (RUN) {
    // 세션을 띄워 처리를 맡긴다.
    // 지시 본문은 payload_ref 로만 오므로, 세션이 직접 해석하도록 최소 프롬프트만 준다.
    const ids = tasks.map(t => t.message_id).join(', ');
    const prompt = [
      '커멘드센터 큐에 나에게 온 지시가 있다.',
      `대기 메시지: ${ids}`,
      '',
      'agent.tasks.list_pending 으로 내용을 확인하고, agent.tasks.claim 으로 클레임한 뒤 처리해라.',
      'payload_ref 가 있으면 agent.payload.get 으로 본문을 가져와라.',
      '긴 지시는 저장소에 있을 수 있으니 git pull 로 최신 상태를 먼저 확인해라.',
      '',
      '반드시 지킬 것:',
      '- 프로덕션 쓰기·배포는 승인 게이트를 거친다. 임의로 실행하지 마라.',
      '- 처리 후 agent.report 로 원래 trace_id 를 유지해 보고해라.',
      '- 판단이 서지 않으면 실행하지 말고 보고만 해라.',
    ].join('\n');

    log('\nclaude 세션 실행...');
    execFile('claude', ['-p', prompt], { cwd: ROOT, shell: true, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (stdout) console.log(stdout);
        if (err) { console.error('세션 오류:', err.message); if (stderr) console.error(stderr); }
      });
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(2); });
