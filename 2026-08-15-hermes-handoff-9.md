# 🎨 할매봇 작업 지시서 #9 — UI 2차 수정 배포 (짧음)

발신: Claude Code (로컬)
수신: **할매봇 (VPS)**
작성일: 2026-08-15
대상 커밋: **`bc2c14f`**
VPS 경로: `/opt/data/projects/workflow-builder`

> **`index.html` 만 바뀐다. 재시작 불필요** — `server.js:257` 의 `express.static` 이 그대로 서빙한다.
> 지시서 #8 과 같은 성격이다.

---

## 무엇을 고쳤나

브라우저로 실제 동작을 확인해 찾은 2건이다.

### 1. 상단 "팀" 버튼이 두 개라 구분이 안 됐다

나란히 있으면서 각각 다른 패널을 여는데, 라벨만으로는 알 수 없었다.

| id | 이전 | 이후 |
|---|---|---|
| `btn-agents` | `팀` | **`에이전트`** |
| `btn-team` | `🤝 팀` | **`🤝 팀 현황`** |

`aria-label` 도 함께 붙였다 (버튼 108개에 `aria` 가 1개뿐이던 문제의 일부).

### 2. 패널 토글 10곳이 인라인 style 만 비교했다

```js
el.style.display = el.style.display === 'none' ? 'block' : 'none'
```

인라인 `display` 가 없고 **스타일시트로만 숨긴 요소**에서는 `'' === 'none'` 이 false 라
`'none'` 을 다시 넣는다 — **첫 클릭이 아무 일도 안 한다.**

브라우저에서 예전 코드를 그대로 재현해 확인했다:

```
초기: inline=(없음)  computed=none
예전 코드 1클릭 → none    ← 열려야 하는데 안 열림
새 코드   1클릭 → block   ← 정상
```

지금은 10개 패널 전부 인라인 `display:none` 이 있어 드러나지 않았다.
**새 패널을 CSS 클래스로 숨기는 순간 깨진다.**

`togglePanel(el)` 헬퍼로 통일했다. 실제 표시 상태(computed)를 보고,
이번 호출로 열렸는지를 boolean 으로 돌려준다:

```js
if (togglePanel(panel)) loadTeamStatus();
```

---

## STEP 1 — 배포

```bash
cd /opt/data/projects/workflow-builder
git status --short          # 비어 있어야 한다
git pull origin main        # bc2c14f
npm test                    # 8스위트 120건
```

**pm2 restart 불필요.** 다음 요청부터 새 파일이 나간다.

---

## STEP 2 — 검증

```bash
grep -c "togglePanel(" index.html                                   # 11
grep -c "style.display === 'none' ? 'block' : 'none'" index.html    # 0   ← 옛 패턴 잔존 없음
grep -c 'aria-label="팀 현황 대시보드"' index.html                    # 1
curl -s http://127.0.0.1:3737/ | grep -c "togglePanel("             # 11  ← 서버가 새 파일을 내보내는가
```

### 🧑 사용자 눈 확인 (선택)

- 상단 버튼이 `에이전트` / `🤝 팀 현황` 으로 구분되는지
- 두 버튼이 각각 다른 패널을 여는지
- 패널을 열고 닫는 게 **첫 클릭부터** 동작하는지

---

## 롤백

```bash
git checkout 209106d -- index.html
```
재시작 불필요.

---

## 하지 말 것

1. **`togglePanel` 을 다시 인라인 style 비교로 되돌리지 말 것** —
   CSS 로 숨긴 패널에서 첫 클릭이 죽는다
2. **버튼 라벨을 둘 다 "팀" 으로 되돌리지 말 것** — 구분이 안 된다
3. **`aria-label` 을 지우지 말 것**

---

## 아직 남은 것 (이번 범위 밖)

`/api/approvals` 는 여전히 무인증이다. `scheduler.py` 가 인증 없이 POST 하기 때문에 열어뒀다.
악용하면 **사용자 텔레그램에 승인 알림을 다량 보낼 수 있다.**
스케줄러에 키를 주고 닫는 것이 다음 과제다 — 아직 착수하지 말 것.

---

## 보고 양식

```
[1] 배포
- pull 전 HEAD : ______
- pull 후 HEAD : ______  (bc2c14f 기대)
- npm test     : __스위트 / __건  (8/120 기대)

[2] 검증
- togglePanel(          : ____ (11 기대)
- 옛 토글 패턴 잔존     : ____ (0 기대)
- aria-label 팀 현황    : ____ (1 기대)
- 서버 응답 togglePanel : ____ (11 기대)
- 🧑 버튼 구분          : Y / N
- 🧑 첫 클릭 동작       : Y / N

[결과] 완료 / 진행 / 차단(사유)
```

작업 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록할 것.
