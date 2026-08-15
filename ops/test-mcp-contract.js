#!/usr/bin/env node
/**
 * MCP 툴 계약 검사 — 스키마에 선언한 파라미터를 핸들러가 실제로 쓰는가.
 *
 * 이 프로젝트에서 반복해서 나온 실패 방식이 "선언은 있고 구현은 없음"이다.
 * agent.list 는 inputSchema 에 capability / online_only 를 버젓이 선언해 두고
 * 핸들러에서 args 를 꺼내지도 않았다. 스펙 문서·MCP 스키마·UI 는 그 기능이
 * 있다고 말하는데 코드에는 없었고, 아무도 몰랐다.
 *
 * 이 검사는 DB·네트워크 없이 소스만 읽는다. 그래서 CI 에 넣을 수 있다.
 * 라이브 동작 확인(필터가 결과를 실제로 바꾸는가)은 별도다.
 *
 * 실행: node ops/test-mcp-contract.js
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mcp-router.js'), 'utf8');

let fails = [];
function check(name, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (!cond && detail ? '\n         ' + detail : ''));
  if (!cond) fails.push(name);
}

/** 여는 중괄호 위치에서 시작해 짝이 맞는 닫는 위치를 찾는다 */
function matchBrace(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** properties: { a: {...}, b: {...} } 에서 최상위 키만 뽑는다 */
function topLevelKeys(objText) {
  const keys = [];
  let depth = 0;
  let i = 0;
  while (i < objText.length) {
    const c = objText[i];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (depth === 1) {
      const m = /^(\w+)\s*:/.exec(objText.slice(i));
      if (m) { keys.push(m[1]); i += m[0].length; continue; }
    }
    i++;
  }
  return keys;
}

// --- 1. 스키마에서 툴별 선언 파라미터 수집 ---
const toolsStart = SRC.indexOf('const TOOLS = [');
const toolsEnd = SRC.indexOf('\n];', toolsStart);
const toolsText = SRC.slice(toolsStart, toolsEnd);

const declared = {};   // { toolName: [param, ...] }
for (const line of toolsText.split('\n')) {
  const nm = /\{\s*name:\s*'([^']+)'/.exec(line);
  if (!nm) continue;
  const propIdx = line.indexOf('properties:');
  let params = [];
  if (propIdx !== -1) {
    const open = line.indexOf('{', propIdx);
    const close = matchBrace(line, open);
    if (close !== -1) params = topLevelKeys(line.slice(open, close + 1));
  }
  declared[nm[1]] = params;
}

// --- 2. 핸들러 본문 수집 ---
const handlers = {};   // { toolName: bodyText }
const caseRe = /case\s+'([^']+)':\s*\{/g;
let cm;
while ((cm = caseRe.exec(SRC)) !== null) {
  const open = SRC.indexOf('{', cm.index + cm[0].length - 1);
  const close = matchBrace(SRC, open);
  if (close !== -1) handlers[cm[1]] = SRC.slice(open, close + 1);
}

console.log(`툴 ${Object.keys(declared).length}개 · 핸들러 ${Object.keys(handlers).length}개 발견\n`);

// --- 3. 검사 ---
console.log('1) 선언된 파라미터를 핸들러가 참조하는가');
for (const [tool, params] of Object.entries(declared)) {
  const body = handlers[tool];
  if (body === undefined) {
    check(`${tool} — 핸들러 존재`, false, '스키마에 선언됐으나 case 블록이 없다');
    continue;
  }
  if (!params.length) {
    console.log(`  SKIP  ${tool} (선언된 파라미터 없음)`);
    continue;
  }
  const missing = params.filter(p => !new RegExp(`\\b${p}\\b`).test(body));
  check(`${tool} [${params.join(', ')}]`, missing.length === 0,
    `핸들러가 참조하지 않음: ${missing.join(', ')}\n         ` +
    `→ 호출자가 이 값을 넘겨도 무시된다. 구현하거나 스키마에서 뺄 것`);
}

console.log('\n2) 핸들러에 스코프가 지정돼 있는가');
const scopeBlock = SRC.slice(SRC.indexOf('const SCOPE_FOR_TOOL'), SRC.indexOf('};', SRC.indexOf('const SCOPE_FOR_TOOL')));
for (const tool of Object.keys(declared)) {
  check(`${tool} 스코프 선언`, scopeBlock.includes(`'${tool}'`),
    'SCOPE_FOR_TOOL 에 없으면 스코프 검사 없이 실행된다');
}

console.log('\n3) 스키마와 핸들러 목록이 일치하는가');
const onlyHandler = Object.keys(handlers).filter(t => !(t in declared));
check('스키마 없는 핸들러 없음', onlyHandler.length === 0,
  `케이스만 있고 tools/list 에 안 보이는 툴: ${onlyHandler.join(', ')}`);

console.log('\n' + (fails.length
  ? `실패 ${fails.length}건 — "선언은 있고 구현은 없음"이 남아 있다`
  : '전부 통과'));
process.exit(fails.length ? 1 : 0);
