#!/usr/bin/env node
/**
 * guarded-deploy.js — deploy 승인 게이트를 반드시 거치는 배포 래퍼 (지시서 #47).
 *
 * 에이전트 세션은 배포 목적의 raw `pm2 restart`/`git pull + restart` 를 직접 하지 않고
 * 이 래퍼를 통한다. 승인 pending 레코드를 만들고(텔레그램 알림 발송), approved 가
 * 확인되기 전에는 배포하지 않는다. rejected/타임아웃이면 배포 중단 + 정직 보고(#25).
 *
 * 사용법:
 *   node ops/guarded-deploy.js "무엇을 배포하는지 설명"
 *
 * 환경:
 *   WF_API_BASE   서버 base URL (기본 http://127.0.0.1:3737)
 *   WF_HERMES_KEY 승인 생성용 키 (기본 /opt/data/.hermes-key, mcp:execute)
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.WF_API_BASE || 'http://127.0.0.1:3737';
const KEY = process.env.WF_HERMES_KEY || (() => {
  try { return fs.readFileSync('/opt/data/.hermes-key', 'utf8').trim(); } catch (e) { return ''; }
})();
const POLL_MS = 5000;
const MAX_WAIT_MS = 10 * 60 * 1000;

function log(...a) { console.log('[guarded-deploy]', ...a); }

async function api(method, pathname, body) {
  const r = await fetch(BASE + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} (${method} ${pathname})`);
  return r.json();
}

function doDeploy() {
  log('git pull origin main --ff-only');
  execSync('git pull origin main --ff-only', { cwd: ROOT, stdio: 'inherit' });
  log('pm2 restart workflow-builder');
  execSync('npx pm2 restart workflow-builder', { cwd: ROOT, stdio: 'inherit' });
  log('✅ 배포 완료');
}

async function main() {
  const what = process.argv[2] || '(설명 없음)';
  const gate = require('../approval-gate');
  if (!gate.requiresApproval('deploy')) {
    log('deploy 는 승인 불필요(WF_APPROVAL_REQUIRED 에 deploy 없음) → 즉시 배포');
    doDeploy();
    return;
  }

  log(`deploy 승인 필요 → 승인 요청 생성: ${what}`);
  const created = await api('POST', '/api/approvals', {
    wf_id: 'ops', agent_id: 'ag_hermes', action: 'deploy',
    context: what, decision: 'pending',
  });
  log(`승인 요청 생성 id=${created.id} (텔레그램 알림 notified=${created.notified})`);

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const list = await api('GET', '/api/approvals');
    const rec = (list.approvals || []).find(a => a.id === created.id);
    if (!rec) continue;
    if (rec.decision === 'approved') { log('✅ 승인됨 → 배포 시작'); doDeploy(); return; }
    if (rec.decision === 'rejected') { log('❌ 거부됨 → 배포 중단 (배포 0건)'); process.exitCode = 3; return; }
    log(`대기 중... (decision=${rec.decision})`);
  }
  log('❌ 승인 대기 타임아웃(10분) → 배포 중단 (배포 0건)');
  process.exitCode = 3;
}

main().catch(e => { console.error('[guarded-deploy] ❌', e.message); process.exitCode = 2; });
