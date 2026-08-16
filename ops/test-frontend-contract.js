#!/usr/bin/env node
/**
 * 프론트엔드 계약 검증 — index.html 과 js/*.js 가 서로 어긋나지 않는지 본다.
 *
 * 왜 필요한가:
 *   index.html 5,589줄에서 JS 약 4,500줄을 16개 파일로 분해했다. 그 뒤로
 *   프론트엔드 자동 검사는 0건이었다 — 백엔드·운영은 178건인데.
 *
 *   분해가 만드는 사고는 정해져 있다. id 가 어긋나는 것이다:
 *     document.getElementById('btn-group').addEventListener(...)
 *   널 가드가 없으므로 id 하나가 사라지면 그 줄에서 예외가 나고
 *   **이후 스크립트가 통째로 멈춘다.** 화면 절반이 죽는데 콘솔을 안 보면 모른다.
 *
 * 파일 이름에 의존하지 않는다. 이름이 바뀌어도 그대로 돈다.
 * DB·네트워크 없이 돈다 — 다른 스위트와 같은 규칙이다.
 *
 * 실행: node ops/test-frontend-contract.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const JS_DIR = path.join(ROOT, 'js');
const CSS_DIR = path.join(ROOT, 'css');

let fails = [];
function check(name, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (!cond && detail ? '\n         ' + detail : ''));
  if (!cond) fails.push(name);
}

const jsFiles = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
const jsSrc = new Map(jsFiles.map(f => [f, fs.readFileSync(path.join(JS_DIR, f), 'utf8')]));

// ── 1) id 계약 ──────────────────────────────────────────────
// 여기가 이 스위트의 핵심이다. 나머지는 곁가지다.
console.log('1) js 가 찾는 id 가 index.html 에 있는가');

const htmlIds = new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

// js 가 만들어 넣는 요소도 있다 — innerHTML 로 심는 id 는 정적으로 존재하지 않는다.
// 그것까지 실패로 치면 쓸모없는 경보가 된다. js 안에서 id="..." 로 생성되는 것은 제외한다.
const jsMadeIds = new Set();
for (const src of jsSrc.values()) {
  for (const m of src.matchAll(/\bid=["'`]([^"'`${}]+)["'`]/g)) jsMadeIds.add(m[1]);
  for (const m of src.matchAll(/\.id\s*=\s*['"`]([^'"`${}]+)['"`]/g)) jsMadeIds.add(m[1]);
}

const missing = [];
for (const [file, src] of jsSrc) {
  for (const m of src.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const id = m[1];
    if (htmlIds.has(id) || jsMadeIds.has(id)) continue;
    missing.push(`${file}: '${id}'`);
  }
}
check('getElementById 대상이 전부 존재한다', missing.length === 0,
  `없는 id ${missing.length}개 — 이 줄에서 예외가 나면 이후 스크립트가 멈춘다\n         ` +
  missing.slice(0, 8).join('\n         '));

// ── 2) id 중복 ──────────────────────────────────────────────
console.log('\n2) id 가 중복되지 않는가');
const idCount = {};
for (const m of HTML.matchAll(/\bid="([^"]+)"/g)) idCount[m[1]] = (idCount[m[1]] || 0) + 1;
const dupes = Object.entries(idCount).filter(([, n]) => n > 1);
check('index.html 에 중복 id 없음', dupes.length === 0,
  'getElementById 가 첫 번째만 집는다 — 나머지는 조용히 죽는다: ' +
  dupes.map(([k, n]) => `${k}×${n}`).join(', '));

// ── 3) 스크립트 참조 ────────────────────────────────────────
console.log('\n3) index.html 의 script 참조가 실재하는가');
const srcRefs = [...HTML.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(p => !/^https?:/.test(p));
const deadRefs = srcRefs.filter(p => !fs.existsSync(path.join(ROOT, p)));
check('참조한 스크립트 파일이 모두 있다', deadRefs.length === 0, '없는 파일: ' + deadRefs.join(', '));

const referenced = new Set(srcRefs.map(p => p.replace(/^\.?\//, '')));
const orphan = jsFiles.filter(f => !referenced.has('js/' + f));
check('js 파일이 모두 로드된다', orphan.length === 0,
  '아무도 안 불러오는 파일: ' + orphan.join(', '));

// ── 4) 로드 순서 ────────────────────────────────────────────
// const 는 호이스팅되지 않는다. 정의보다 먼저 로드된 파일이 최상위에서 쓰면 터진다.
// (function 은 호이스팅되고 대개 이벤트에서 호출되므로 여기서 보지 않는다)
console.log('\n4) 최상위 const 가 정의보다 먼저 쓰이지 않는가');
const order = srcRefs.filter(p => p.startsWith('js/') || p.startsWith('./js/'))
  .map(p => p.replace(/^\.?\//, '').slice(3));
const definedIn = new Map();
for (const f of order) {
  const src = jsSrc.get(f) || '';
  for (const m of src.matchAll(/^const\s+([A-Z][A-Z0-9_]{2,})\s*=/gm)) {
    if (!definedIn.has(m[1])) definedIn.set(m[1], f);
  }
}
const badOrder = [];
for (const [name, defFile] of definedIn) {
  const defIdx = order.indexOf(defFile);
  for (let i = 0; i < defIdx; i++) {
    const f = order[i];
    const src = jsSrc.get(f) || '';
    // 최상위에서 즉시 실행되는 부분만 본다 — 함수 본문 안은 나중에 돈다
    const topLevel = src.replace(/(^|\n)(async )?function[\s\S]*?\n\}/g, '');
    if (new RegExp('\\b' + name + '\\b').test(topLevel)) badOrder.push(`${f} 가 ${name} 을 쓰는데 정의는 ${defFile}`);
  }
}
check('로드 순서가 의존 방향과 맞다', badOrder.length === 0, badOrder.join('\n         '));

// ── 5) 서비스워커 ──────────────────────────────────────────
// addAll 은 목록 중 하나라도 404 면 **전체가 실패**한다. 부분 실패가 아니라
// 서비스워커 설치가 통째로 죽는다. 파일명을 바꾸고 여기를 안 고치면 그렇게 된다.
console.log('\n5) sw.js 캐시 목록이 실제 파일과 맞는가');
const SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const listed = [...SW.matchAll(/['"]\.\/((?:js|css)\/[^'"]+)['"]/g)].map(m => m[1]);
const actual = [
  ...fs.readdirSync(JS_DIR).map(f => 'js/' + f),
  ...fs.readdirSync(CSS_DIR).map(f => 'css/' + f),
];
const ghost = listed.filter(p => !actual.includes(p));
check('ASSETS 에 없는 파일이 없다', ghost.length === 0,
  'addAll 은 하나만 404 여도 전체가 실패한다 — 서비스워커 설치가 죽는다: ' + ghost.join(', '));
check('실제 파일이 ASSETS 에 빠지지 않았다',
  actual.filter(p => !listed.includes(p)).length === 0,
  '오프라인에서 안 뜬다: ' + actual.filter(p => !listed.includes(p)).join(', '));

// ── 6) 접근성 회귀 ─────────────────────────────────────────
// 2026-08-16 에 20개를 손으로 세어 고쳤다. 다시 손으로 세지 않는다.
console.log('\n6) 접근성 — 손으로 고친 것을 고정한다');
const visible = HTML.replace(/<div id="hidden-btns"[\s\S]*?<\/div>/, '');   // display:none 원본은 제외
let nameless = 0;
for (const m of visible.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)) {
  if (/aria-label\s*=|aria-labelledby\s*=/.test(m[1])) continue;
  if (/[A-Za-z가-힣0-9]/.test(m[2].replace(/<[^>]*>/g, ''))) continue;
  nameless++;
}
check('표시 버튼에 접근명이 있다', nameless === 0,
  `아이콘만 있고 이름 없는 버튼 ${nameless}개 — 스크린리더가 읽을 것이 없다`);

const labels = [...HTML.matchAll(/aria-label="([^"]+)"/g)].map(m => m[1]);
const dupLabels = labels.filter((v, i) => labels.indexOf(v) !== i);
check('aria-label 이 서로 다르다', dupLabels.length === 0,
  '닫기 버튼이 여러 개 열려 있으면 구분되지 않는다: ' + [...new Set(dupLabels)].join(', '));

console.log('\n' + (fails.length
  ? `실패 ${fails.length}건: ${fails.join(', ')}`
  : '전부 통과'));
process.exit(fails.length ? 1 : 0);
