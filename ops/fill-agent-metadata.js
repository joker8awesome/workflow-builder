#!/usr/bin/env node
/**
 * fill-agent-metadata.js — 에이전트 capabilities/tools/trust_score 채우기
 *
 * agents.machine (JSONB) 안에 메타데이터를 "병합"한다.
 * POST /api/agents 는 전체 컬럼 upsert이므로 모든 필드를 되돌려 보내야
 * name/person/role/color 가 기본값으로 덮이지 않는다.
 *
 * 사용법:
 *   node ops/fill-agent-metadata.js            # dry-run (기본, 쓰지 않음)
 *   node ops/fill-agent-metadata.js --apply    # 실제 전송
 *
 * 환경 변수:
 *   WF_BASE   기본 https://187.127.124.16.sslip.io
 *   WF_TOKEN  WF_ACCESS_TOKEN 값 (서버에 설정돼 있을 때만 필요)
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.WF_BASE || 'https://187.127.124.16.sslip.io';
const TOKEN = process.env.WF_TOKEN || '';
const APPLY = process.argv.includes('--apply');

// 역할별 메타데이터. tools 중 figma/telegram/ci 등은 향후 워커 연동 예정 항목이다.
const META = {
  ag_orch:          { capabilities: ['orchestrate', 'delegate', 'converge'], tools: ['mcp', 'team'] },
  ag_researcher:    { capabilities: ['research', 'summarize', 'synthesize'], tools: ['web', 'search'] },
  ag_analyst:       { capabilities: ['analyze', 'pattern', 'insight'],       tools: ['db', 'python'] },
  ag_writer:        { capabilities: ['write', 'draft', 'report'],            tools: ['mcp', 'doc'] },
  ag_reviewer:      { capabilities: ['review', 'verify', 'feedback'],        tools: ['mcp', 'test'] },
  ag_collector:     { capabilities: ['crawl', 'scrape', 'collect'],          tools: ['web', 'api'] },
  ag_developer:     { capabilities: ['code', 'refactor', 'debug'],           tools: ['python', 'git'] },
  ag_tester:        { capabilities: ['test', 'regression', 'verify'],        tools: ['test', 'ci'] },
  ag_designer:      { capabilities: ['design', 'ui', 'ux', 'visualize'],     tools: ['figma', 'css'] },
  ag_security:      { capabilities: ['security', 'audit', 'pii'],            tools: ['scan', 'vault'] },
  ag_communicator:  { capabilities: ['report', 'notify', 'message'],         tools: ['telegram', 'api'] },
  ag_scheduler:     { capabilities: ['schedule', 'cron', 'deadline'],        tools: ['cron', 'task'] },
  ag_integrator:    { capabilities: ['integrate', 'api', 'mcp'],             tools: ['api', 'mcp'] },
  ag_archiver:      { capabilities: ['archive', 'version', 'knowledge'],     tools: ['db', 'git'] },
  ag_auditor:       { capabilities: ['audit', 'compliance', 'verify'],       tools: ['audit', 'db'] },
  // 팀 역할이 아닌 외부 커넥터 신원 — 팀 라우팅에 섞이지 않도록 최소 메타데이터만 부여
  ag_claude_desktop: { capabilities: ['connect'], tools: ['mcp'] },
};

// 아직 실제 연동이 없는 tools — 워커 연동 시 해제
const PLANNED_TOOLS = new Set(['figma', 'telegram', 'ci', 'scan', 'vault', 'cron', 'doc', 'team']);
const TRUST_DEFAULT = 50;

async function main() {
  const snapPath = path.join(__dirname, 'agents-before.json');
  if (!fs.existsSync(snapPath)) {
    console.error('❌ ops/agents-before.json 이 없다. 먼저 스냅샷을 받을 것:');
    console.error(`   curl -s -H "Authorization: Bearer <MCP_KEY>" ${BASE}/api/agents > ops/agents-before.json`);
    process.exit(1);
  }
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const agents = snap.agents || [];
  console.log(`스냅샷 ${agents.length}명 로드${APPLY ? '' : '  [DRY-RUN — 아무것도 전송하지 않음]'}\n`);

  const unmapped = agents.filter(a => !META[a.id]).map(a => a.id);
  if (unmapped.length) console.log(`⚠  매핑 없음 (건너뜀): ${unmapped.join(', ')}\n`);

  let ok = 0, fail = 0;
  for (const a of agents) {
    const meta = META[a.id];
    if (!meta) continue;

    const existing = (a.machine && typeof a.machine === 'object') ? a.machine : {};
    // 병합 — env/workspace 등 기존 키 보존
    const machine = {
      ...existing,
      capabilities: meta.capabilities,
      tools: meta.tools,
      trust_score: existing.trust_score ?? TRUST_DEFAULT,
    };
    // 전체 컬럼 upsert이므로 모든 필드를 그대로 되돌려 보낸다
    const body = {
      id: a.id,
      name: a.name,
      person: a.person,
      role: a.role,
      color: a.color,
      machine,
    };

    const kept = Object.keys(existing).join(',') || '(없음)';
    const planned = meta.tools.filter(t => PLANNED_TOOLS.has(t));
    console.log(`${a.id}`);
    console.log(`   보존 machine 키 : ${kept}`);
    console.log(`   capabilities    : ${meta.capabilities.join(', ')}`);
    console.log(`   tools           : ${meta.tools.join(', ')}${planned.length ? `   (연동예정: ${planned.join(', ')})` : ''}`);

    if (!APPLY) { console.log(''); continue; }

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
      const r = await fetch(`${BASE}/api/agents`, { method: 'POST', headers, body: JSON.stringify(body) });
      const txt = await r.text();
      if (r.ok) { console.log(`   → ✅ ${r.status}\n`); ok++; }
      else {
        console.log(`   → ❌ ${r.status} ${txt.slice(0, 200)}\n`); fail++;
        if (r.status === 401) {
          console.error('401 — WF_ACCESS_TOKEN 이 서버에 설정돼 있다. WF_TOKEN 환경변수로 전달할 것. 중단한다.');
          process.exit(1);
        }
      }
    } catch (e) { console.log(`   → ❌ ${e.message}\n`); fail++; }
  }

  if (APPLY) {
    console.log(`\n완료: 성공 ${ok} / 실패 ${fail}`);
    console.log('검증: curl -s .../api/agents > ops/agents-after.json 후 before와 diff');
    console.log('되돌리기: ops/agents-before.json 의 각 행을 그대로 POST하면 원복된다.');
  } else {
    console.log('DRY-RUN 종료. 실제 적용하려면 --apply 를 붙일 것.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
