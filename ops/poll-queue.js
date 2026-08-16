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
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.WF_MCP_URL || 'https://187.127.124.16.sslip.io/mcp';
const RUN = process.argv.includes('--run');
// 세션이 몇 분 걸리는데 폴링은 그보다 자주 돈다. 잠금이 없으면 같은 지시로
// 세션이 여러 개 뜬다. 오래된 잠금은 회수한다 — 죽은 프로세스가 남기면 영영 막힌다.
const LOCK = require('path').join(__dirname, '.poll-queue.lock');
const LOCK_STALE_MS = 20 * 60 * 1000;
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
    process.exitCode = 2;
    return;
  }

  // 세션이 도는 중에 다음 회차가 또 띄우면 같은 지시로 두 세션이 붙는다.
  // 잠긴 회차는 조용히 나간다 — 다음 회차에 다시 본다. 큐를 건드리지 않았으므로 잃는 것이 없다.
  try {
    fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' });
  } catch (e) {
    // 잠금에는 **띄운 세션의 pid** 가 들어 있다. 그 세션이 아직 살아 있으면 건너뛴다.
    // 파일 존재만 보면 세션이 5분 만에 끝나도 20분을 기다리게 되고,
    // 시간만 보면 30분 걸리는 세션 중간에 두 번째가 붙는다. 생사를 직접 본다.
    let pid = 0, age = Infinity;
    try { pid = Number(fs.readFileSync(LOCK, 'utf8').trim()) || 0; } catch (_) {}
    try { age = Date.now() - fs.statSync(LOCK).mtimeMs; } catch (_) {}
    let alive = false;
    if (pid) { try { process.kill(pid, 0); alive = true; } catch (_) { alive = false; } }
    if (alive) {
      log(`[${new Date().toISOString()}] 세션 ${pid} 진행 중 — 건너뜀`);
      process.exitCode = 1;
      return;
    }
    if (age < LOCK_STALE_MS && !pid) {
      log(`[${new Date().toISOString()}] 이전 회차가 진행 중 — 건너뜀`);
      process.exitCode = 1;
      return;
    }
    log(`잠금 회수 (pid ${pid || '?'} 없음, ${Math.round(age / 60000)}분 경과)`);
    try { fs.writeFileSync(LOCK, String(process.pid)); } catch (_) {}
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
    return finish(2);
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

  if (!tasks.length) return finish(1);

  // 보고(report)와 지시(command/instruction)는 다르게 다룬다.
  // 보고는 읽고 기록하면 끝이지만, 지시는 실제로 무언가를 해야 한다.
  // 둘을 같이 취급하면 보고를 받을 때마다 세션이 떠서 낭비가 된다.
  const reports = tasks.filter(t => t.type === 'report');
  const actionable = tasks.filter(t => t.type !== 'report');

  // --- 보고: 수신함에 적고 claim 한다 (세션 불필요) ---
  if (reports.length) {
    const inbox = path.join(ROOT, 'ops', 'inbox.md');
    const lines = [];
    // 본문은 agent_messages.payload 에 들어 있다.
    // list_pending 은 payload_ref 만 돌려주고, send_to_center.py 는 payload 를 쓰므로
    // MCP 만으로는 내용을 읽을 수 없다 — REST 로 한 번 받아 id→payload 로 맞춘다.
    const bodies = new Map();
    try {
      const rest = (process.env.WF_API_BASE || 'https://187.127.124.16.sslip.io') + '/api/messages';
      const rr = await fetch(rest, {
        headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(20000),
      });
      if (rr.ok) {
        const j = await rr.json();
        for (const m of (j.messages || j)) {
          if (m && m.payload != null) bodies.set('msg_' + m.id, m.payload);
        }
      }
    } catch (e) { log('본문 조회 실패: ' + e.message); }

    for (const t of reports) {
      let body = '';
      const raw = bodies.get(t.message_id);
      if (raw != null) {
        const obj = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch (e) { return raw; } })() : raw;
        body = typeof obj === 'object'
          ? Object.entries(obj).map(([k, v]) => `- ${k}: ${String(v).slice(0, 400)}`).join('\n')
          : String(obj).slice(0, 500);
      } else {
        body = '(본문을 찾지 못했다)';
      }
      lines.push(`\n## ${new Date().toISOString()} · ${t.message_id} · ${t.from_agent}\n` +
        `trace: ${t.trace_id || '-'}\n\n${body}\n`);
      // claim 하지 않으면 큐에 계속 남아 매번 다시 읽는다
      try { await callTool(key, 'agent.tasks.claim', { message_id: t.message_id }); }
      catch (e) { log(`claim 실패 ${t.message_id}: ${e.message}`); }
    }
    try {
      fs.appendFileSync(inbox, lines.join(''));
      log(`보고 ${reports.length}건 → ops/inbox.md`);
    } catch (e) { log('수신함 기록 실패: ' + e.message); }
  }

  if (!actionable.length) {
    log('처리할 지시는 없음 (보고만 수신)');
    return finish(0);
  }
  tasks = actionable;

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

    // 세션은 몇 분씩 걸린다. 이 폴러는 붙잡고 기다리지 않고 떼어 보낸다.
    //
    // 예전에는 execFile 로 예약만 하고 **바로 다음 줄에서 process.exit(0)** 을 불렀다.
    // 비동기라서 자식이 뜨기도 전에 부모가 죽었고, 세션은 한 번도 실행되지 않았다.
    // 파일로 리다이렉트된 로그도 버퍼째 버려져 "실행했다"는 줄조차 남지 않았다 —
    // 그래서 사용자가 텔레그램으로 보낸 지시가 15분마다 감지만 되고 방치됐다
    // (msg_287 이 두 회차 연속 대기 상태로 남았다).
    // 떼어 보내지 않고 **기다린다.**
    //
    // detached:true 를 먼저 시도했는데 Windows 에서는 안 됐다. shell:true 와 함께 쓰면
    // 실제 명령이 cmd.exe 의 손자가 되고, 부모가 끝나는 순간 함께 죽는다.
    // 실측했다 — spawn 이벤트는 뜨는데 세션 출력이 한 줄도 안 남았다.
    //
    // 기다리는 쪽이 오히려 낫다. 잠금 파일의 pid 가 살아 있는 이 프로세스를 가리키므로
    // 다음 회차가 생사를 정확히 판단한다. 폴링 간격보다 세션이 길어도 겹치지 않는다.
    const out = fs.openSync(path.join(ROOT, 'ops', 'session.log'), 'a');
    const child = spawn('claude', ['-p', prompt], {
      cwd: ROOT, shell: true, stdio: ['ignore', out, out], windowsHide: true,
    });
    child.on('error', e => {
      log('세션 기동 실패: ' + e.message);
      finish(2);
    });
    child.on('spawn', () => log(`세션 기동 (pid ${child.pid}) — ops/session.log 에 출력`));
    child.on('close', code => {
      log(`세션 종료 (코드 ${code})`);
      finish(code === 0 ? 0 : 2);
    });
    return;                   // 여기서 끝내지 않는다 — close 에서 정리한다
  }
  finish(0);
}

// exit 를 한 곳에서 처리한다.
// process.exit() 는 파일로 향하는 버퍼를 버리므로, 로그를 남긴 뒤 자연 종료시킨다.
function finish(code) {
  try { fs.unlinkSync(LOCK); } catch (e) {}
  process.exitCode = code;
}

main().catch(e => { console.error(e); finish(2); });
