#!/usr/bin/env node
/**
 * 조용히 삼키는 예외 처리가 없는지 검사한다.
 *
 * 이 프로젝트에서 찾은 버그 여러 건이 전부 빈 catch 뒤에 숨어 있었다:
 *   - workflow.list 의 node_count 가 전부 0  (JSONB 이중 파싱 → SyntaxError 를 catch 가 삼킴)
 *   - credentials-api 의 감사 로그 timestamp 오류 (커밋 4a28891, "was silently failing")
 * 17곳을 고쳤지만, 중요한 건 18번째가 생기지 않게 하는 것이다.
 *
 * 실행: node ops/test-no-silent-catch.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = [
  'server.js', 'mcp-router.js', 'credentials-api.js',
  'auth-credential.js', 'notify.js', 'approval-gate.js', 'db-config.js',
];

// 삼키는 패턴들
const PATTERNS = [
  { re: /catch\s*\([^)]*\)\s*\{\s*\}/g,        desc: '빈 catch 블록' },
  { re: /catch\s*\{\s*\}/g,                     desc: '빈 catch (바인딩 없음)' },
  { re: /\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g, desc: '빈 .catch(() => {})' },
  { re: /\.catch\s*\(\s*\(\s*\)\s*=>\s*null\s*\)/g,    desc: '.catch(() => null)' },
];

let fails = [];
function check(name, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (!cond && detail ? '\n         ' + detail : ''));
  if (!cond) fails.push(name);
}

console.log('1) 소스에 조용히 삼키는 예외 처리가 없는가');
for (const f of TARGETS) {
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) { console.log(`  SKIP  ${f} (없음)`); continue; }
  const src = fs.readFileSync(abs, 'utf8');
  const lines = src.split('\n');
  const hits = [];
  for (const { re, desc } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const line = src.slice(0, m.index).split('\n').length;
      hits.push(`${f}:${line}  ${desc}  → ${lines[line - 1].trim().slice(0, 70)}`);
    }
  }
  check(f, hits.length === 0, hits.join('\n         '));
}

console.log('\n2) 가드 자체가 동작하는가 (탐지 로직 검증)');
const samples = [
  ['} catch (e) {}', true],
  ['} catch {}', true],
  ['p.catch(() => {});', true],
  ["} catch (e) { console.warn('x:', e.message); }", false],
  ['p.catch(e => console.warn(e));', false],
];
for (const [code, shouldHit] of samples) {
  const hit = PATTERNS.some(({ re }) => { re.lastIndex = 0; return re.test(code); });
  check(`${shouldHit ? '탐지해야' : '통과해야'}: ${code}`, hit === shouldHit);
}

console.log('\n' + (fails.length
  ? `실패 ${fails.length}건 — 예외를 삼키려면 최소한 console.warn 으로 흔적을 남길 것`
  : '전부 통과'));
process.exit(fails.length ? 1 : 0);
