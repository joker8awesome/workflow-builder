# 지시서 #40 — Phase 1 배분 (배치 A·B·C 동시)

작성: Claude Code (센터장)  
작성일: 2026-08-17  
기준 커밋: `29eb1de` (CSS 사고 복구)  
대상: 할매봇 (ag_hermes) — Phase 0 완료 후 배치 배분  
trace_id: `fleet-phase1-20260817`

---

## 0. Phase 0 완료 확인 ✅

| 단계 | 내용 | 상태 |
|---|---|---|
| 0-1 | `/api/llm/worker` 보고 경로 수정 | ✅ 완료 (report_to 동적, status='pending') |
| 0-2 | `index.html` 분해 (5,589줄 → 1,013줄 + js/·css/) | ✅ 완료 (18 js파일 + 2 css파일) |
| 0-3 | 회귀 확인 (npm test + 육안) | ✅ 완료 (223건 통과) |

**분해된 파일:**
- js/: 18개 파일 (canvas-render.js 34K, tests-more-menu.js 40K 등)
- css/: main.css (27K) + cred-modal.css (2.8K)

---

## 1. Phase 1 배치 A — Esc 로 패널 닫기

**목표:** 패널 15개를 Esc로 닫을 수 있게 하기  
**워커:** Kimi  
**합격 기준:** 리스너 1개, npm test 통과  

### 작업 내용

현재 패널을 열고 Esc 를 눌러도 반응하지 않는다.
위임 방식으로 처리해야 한다 — 패널마다 리스너 15개를 달지 마라.

아래 코드를 워커에게 보낸다:

```js
// js/core-store.js:28
function togglePanel(el) {
  if (!el) return false;
  const willOpen = getComputedStyle(el).display === 'none';
  el.style.display = willOpen ? 'block' : 'none';
  return willOpen;
}

// js/groups-export-ws.js:88 (기존 Escape 핸들러 1)
if (e.key === 'Escape') { input.value = cur; input.blur(); }

// js/virtual-render-palette.js:37 (기존 Escape 핸들러 2)
if (e.key === 'Escape') pal.style.display = 'none';
```

패널 마크업 샘플:

```html
<div id="trace-panel" role="dialog" aria-modal="true" style="display:none;...">
  <button id="trace-close" aria-label="트레이스 닫기">✕</button>
  ...
</div>

<div id="agents-panel" role="dialog" aria-modal="true" style="display:none;...">
  <button id="agents-close" aria-label="에이전트 목록 닫기">✕</button>
  ...
</div>

<div id="session-panel" role="dialog" aria-modal="true" style="display:none;...">
  <button id="session-close" aria-label="세션 닫기">✕</button>
  ...
</div>
```

### 워커에게 물을 것

**프롬프트:**

```
아래는 js/core-store.js 와 index.html 의 해당 부분이다.

js/core-store.js (패널 토글 함수):
function togglePanel(el) {
  if (!el) return false;
  const willOpen = getComputedStyle(el).display === 'none';
  el.style.display = willOpen ? 'block' : 'none';
  return willOpen;
}

index.html (패널 마크업 샘플):
<div id="trace-panel" role="dialog" aria-modal="true" style="display:none;...">
  <button id="trace-close" aria-label="트레이스 닫기">✕</button>
</div>

현재 상황:
- 패널이 열려 있어도 Esc 키를 눌러도 반응하지 않는다
- 기존 Escape 핸들러는 2개뿐이다 (groups-export-ws.js, virtual-render-palette.js 에서 각각 특정 용도)
- 패널을 닫기 위해 마우스로 ✕ 버튼을 찾아야 한다

목표:
위임 방식 (delegation pattern) 으로 처리하라. 패널마다 리스너를 15개 달지 마라.
- 모든 열린 패널 중 가장 위에 있는 패널을 닫는다
- 키다운 리스너는 **1개만** 만든다
- 다른 Escape 핸들러(input 편집, palette)와 충돌하지 않도록 검사 순서를 정한다

형식:
앵커: <위 코드에서 그대로 복사한 한 줄>
제안: <설명>

위 코드에 없는 함수·파일·설정은 언급하지 마라.
확실하지 않으면 "확실하지 않음"이라고 답하라. 추측하지 마라.
```

---

## 2. Phase 1 배치 B — 포커스 이동과 복귀

**목표:** 패널 열기/닫기 시 포커스를 이동·복귀시키기  
**워커:** Kimi  
**합격 기준:** 0개 미이동, 0개 미복귀, npm test 통과  

### 작업 내용

현재 패널을 열어도 포커스가 뒤에 남는다. 키보드 사용자가 Tab 을 수십 번 눌러야 패널에 닿는다.

아래 코드를 워커에게 보낸다:

```js
// js/core-store.js:28
function togglePanel(el) {
  if (!el) return false;
  const willOpen = getComputedStyle(el).display === 'none';
  el.style.display = willOpen ? 'block' : 'none';
  return willOpen;
}
```

패널 마크업 샘플:

```html
<!-- 열기 버튼 -->
<button id="btn-open-agents" aria-label="에이전트 보기">📋</button>

<!-- 패널 (이미 role="dialog" 와 aria-modal="true" 가 있음) -->
<div id="agents-panel" role="dialog" aria-modal="true" style="display:none;">
  <input type="text" placeholder="검색...">
  <button id="agents-close" aria-label="에이전트 목록 닫기">✕</button>
  ...
</div>
```

### 워커에게 물을 것

**프롬프트:**

```
아래는 js/core-store.js 의 togglePanel 함수와 
index.html 의 패널·버튼 마크업이다.

js/core-store.js:
function togglePanel(el) {
  if (!el) return false;
  const willOpen = getComputedStyle(el).display === 'none';
  el.style.display = willOpen ? 'block' : 'none';
  return willOpen;
}

index.html (샘플):
<button id="btn-open-agents" aria-label="에이전트 보기">📋</button>
...
<div id="agents-panel" role="dialog" aria-modal="true" style="display:none;">
  <input type="text" placeholder="검색...">
  <button id="agents-close" aria-label="에이전트 목록 닫기">✕</button>
  ...
</div>

현재 문제:
- 패널을 열어도 포커스가 뒤에 남는다
- 키보드 사용자가 Tab 을 수십 번 눌러야 패널에 닿는다
- 닫을 때 포커스가 어디로 갈지 알 수 없다

목표:
1. 패널 열기 시:
   - 패널의 **첫 포커스 가능 요소**(input/button/link 등)로 포커스 이동
   - textarea/input 이 있으면 그 쪽으로, 없으면 첫 번째 버튼으로

2. 패널 닫기 시:
   - **패널을 열었던 버튼**으로 포커스 되돌리기
   - 예: "에이전트 보기" 버튼을 눌러서 열었으면, 닫을 때 그 버튼으로

3. 모든 패널에 이미 `role="dialog"` 와 `aria-modal="true"` 가 있다 (확인됨)

형식:
앵커: <위 코드에서 그대로 복사한 한 줄>
제안: <설명>

위 코드에 없는 함수·파일·설정은 언급하지 마라.
확실하지 않으면 "확실하지 않음"이라고 답하라. 추측하지 마라.
```

---

## 3. Phase 1 배치 C — CSS 파일명 정리

**워커 불필요** — 내가 수정한다  
**중요:** 3개가 한 커밋에 있어야 함

### 변경사항

이전 파일명이 틀렸다:
- `css/mobile.css` ← 실제 내용은 자격증명 모달 전용

올바른 이름:
- `css/cred-modal.css` ← 이미 생성됨

**동시에 수정할 곳 (한 커밋):**

1. **index.html** — `<link>` 태그
   ```html
   <!-- Before -->
   <link rel="stylesheet" href="css/mobile.css">
   
   <!-- After -->
   <link rel="stylesheet" href="css/cred-modal.css">
   ```

2. **sw.js** — ASSETS 배열
   ```js
   // Before
   const ASSETS = ['/css/mobile.css', ...];
   
   // After
   const ASSETS = ['/css/cred-modal.css', ...];
   ```

3. **sw.js** — CACHE 버전
   ```js
   // Before
   const CACHE = 'wf-builder-v7';
   
   // After
   const CACHE = 'wf-builder-v8';
   ```

### ⚠️ 중요

**3개가 한 커밋에 없으면 배포 순간 서비스워커가 죽는다**

- `addAll()` 은 목록 중 **하나라도 404** 면 전체 실패
- 파일명만 바꾸고 ASSETS 를 안 고치면 SW 설치 불가
- CACHE 버전을 안 올리면 사용자의 기존 SW가 옛 파일 목록 서빙

---

## 4. 배분 계획

### 동시 배분 (3개)

| # | 배치 | 대상 | 처리 | 합격 기준 |
|---|---|---|---|---|
| A | Esc 닫기 | Kimi 워커 | 리스너 1개 추가 | 리스너 1개, npm test ✅ |
| B | 포커스 | Kimi 워커 | togglePanel 내부 수정 | 0개 미이동, 0개 미복귀 |
| C | CSS 정리 | 내가 처리 | 3개 파일 동시 수정 | test ✅, Pages 배포 ✅ |

### 처리 순서

```
T+0분   배치 A·B 동시 호출 (Kimi 워커 2회 독립 호출)
        └─ 각각 다른 trace_id
        
T+3분   배치 A 결과 수신 (예상 완료)
        ├─ 환각 게이트 (앵커·존재·test)
        ├─ npm test 통과 ✅
        ├─ 적용 & commit
        └─ 보고
        
T+3~5분 배치 B 결과 수신 (포커스는 조금 더 오래)
        ├─ 환각 게이트 검사
        ├─ npm test 통과 ✅
        ├─ 적용 & commit
        └─ 보고
        
T+8분   배치 C 처리 (자동)
        ├─ index.html <link> 수정
        ├─ sw.js ASSETS 수정
        ├─ sw.js CACHE v7→v8
        ├─ 한 커밋 (3개 동시)
        ├─ npm test 통과 ✅
        └─ GitHub Pages 배포
        
T+10분  완료 보고
        └─ 모두 배포 ✅
```

---

## 5. 규칙 재확인

### 환각 게이트 (배치 A·B용)

| # | 규칙 | 체크 |
|---|---|---|
| ① | 앵커: 실제 파일에서 복사한 문자열 | `grep` 확인 |
| ② | 저장소에 없는 함수·파일·설정 언급 시 반려 | `grep` 확인 |
| ③ | npm test 통과가 합격 기준 (워커 선언 아님) | test 돌림 |
| ④ | 반려 3회면 회수, 나에게 에스컬레이션 | 카운트 |
| ⑤ | 지시 자체의 사실을 먼저 확인 (거짓 전제 방지) | 이 지시서가 정확한가 |
| ⑥ | ARIA 속성은 붙이는 요소가 맞는지 확인 | `aria-expanded` → 버튼에만 |

### 보고 양식 (배치별)

```
[배치 A] Esc 닫기
- 워커 호출: 1회
- 최종 판단 불가: 0개
- 실제 결함/채택: _건 / _개 중
- 반려: 취향 _ / 오판 _ / 환각 _
- 합격 기준: 리스너 1개, npm test 223건 통과

[배치 B] 포커스
- 워커 호출: 1회
- 최종 판단 불가: 0개
- 실제 결함/채택: _건 / _개 중
- 반려: 취향 _ / 오판 _ / 환각 _
- 합격 기준: 0개 미이동, 0개 미복귀, npm test 통과

[배치 C] CSS 정리
- 파일명 변경: 1곳
- ASSETS 동기화: 1곳
- CACHE 버전 올림: v7→v8
- npm test 223건 통과
- Pages 배포: ✅
```

---

## 6. 다음 지시서

완료 후 다음 단계:
- 배치 A·B 채택률 측정 후 Phase 2 판단
- 또는 미루기 항목(인라인 style, 색상 토큰) 재검토

---

**총 예상 시간: ~25분**  
**trace_id: fleet-phase1-20260817**
