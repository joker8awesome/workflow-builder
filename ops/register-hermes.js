#!/usr/bin/env node
/**
 * register-hermes.js — 할매봇을 에이전트로 등록하고 키를 발급한다.
 *
 * 할매봇은 지금까지 에이전트 레지스트리에 없어서 agent.send_message 로 지시를
 * 보낼 주소가 없었다 (사용자가 손으로 지시서를 전달해 왔다).
 *
 * 사용법:
 *   WF_ADMIN_KEY=wf_ak_... node ops/register-hermes.js            # dry-run
 *   WF_ADMIN_KEY=wf_ak_... node ops/register-hermes.js --apply
 *
 * 환경 변수:
 *   WF_ADMIN_KEY  mcp:admin 스코프 키 (필수). 인자로 넘기지 말 것 — 셸 히스토리에 남는다
 *   WF_BASE       기본 https://187.127.124.16.sslip.io
 *   WF_OWNER      담당자 이름 (agents.owner 에 기록)
 */
const BASE = process.env.WF_BASE || 'https://187.127.124.16.sslip.io';
const ADMIN = process.env.WF_ADMIN_KEY || '';
const OWNER = process.env.WF_OWNER || '';
const APPLY = process.argv.includes('--apply');

const AGENT = {
  id: 'ag_hermes',
  name: '할매봇',
  person: '커멘드센터',
  role: 'VPS 배포·운영·검증',
  color: '#7c8db5',
  machine: { env: 'VPS', workspace: '/opt/data/agents/ag_hermes' },
};

// 배포·실행에 필요한 것만. mcp:admin 은 주지 않는다 —
// 그걸 주면 할매봇이 스스로 자격증명을 발급할 수 있게 된다.
const SCOPES = ['mcp:read', 'mcp:execute'];

async function main() {
  if (!ADMIN) {
    console.error('❌ WF_ADMIN_KEY 가 필요하다 (mcp:admin 스코프).');
    console.error('   예: WF_ADMIN_KEY=wf_ak_... node ops/register-hermes.js --apply');
    process.exit(1);
  }
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ADMIN };

  console.log(`대상: ${BASE}${APPLY ? '' : '   [DRY-RUN — 아무것도 쓰지 않음]'}`);
  console.log('\n[1] 에이전트 등록');
  console.log('   ' + JSON.stringify({ ...AGENT, owner: OWNER || '(미지정)' }, null, 2).replace(/\n/g, '\n   '));
  console.log('\n[2] 자격증명 발급');
  console.log('   scopes:', SCOPES.join(', '), '  (mcp:admin 제외 — 의도된 것)');

  if (!APPLY) {
    console.log('\nDRY-RUN 종료. 실제 적용하려면 --apply');
    return;
  }

  // 1) 등록 — owner 는 본문에 없으면 기존 값이 보존된다(COALESCE)
  const body = { ...AGENT };
  if (OWNER) body.owner = OWNER;
  let r = await fetch(`${BASE}/api/agents`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  if (!r.ok) {
    console.error(`❌ 등록 실패 ${r.status}: ${(await r.text()).slice(0, 200)}`);
    process.exit(1);
  }
  console.log('   → ✅ 등록됨');

  // 2) 키 발급 — 원문 키는 이 응답에만 나온다
  r = await fetch(`${BASE}/api/agents/ag_hermes/credentials`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ name: OWNER ? `hermes-vps (${OWNER})` : 'hermes-vps', scopes: SCOPES }),
  });
  if (!r.ok) {
    console.error(`❌ 발급 실패 ${r.status}: ${(await r.text()).slice(0, 300)}`);
    if (r.status === 401) console.error('   WF_ADMIN_KEY 가 올바르지 않거나 만료됨');
    if (r.status === 403) console.error('   이 키에 mcp:admin 이 없음');
    process.exit(1);
  }
  const cred = await r.json();
  console.log('   → ✅ 발급됨\n');
  console.log('━'.repeat(60));
  console.log('할매봇 키 (이 화면에서만 표시된다):\n');
  console.log('  ' + cred.key);
  console.log('\n━'.repeat(60));
  console.log('이 키를 VPS 환경변수로 두고, 저장소·로그·채팅에 남기지 말 것.');
  console.log('  export WF_HERMES_KEY="' + String(cred.key).slice(0, 22) + '..."');
}

main().catch(e => { console.error(e); process.exit(1); });
