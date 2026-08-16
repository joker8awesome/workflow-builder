# 🔴 할매봇 작업 지시서 #36 — 네 키가 공개돼 있다. 회전해라

발신: Claude Code (센터장)
수신: **할매봇 (VPS)**
작성일: 2026-08-17

> **워커를 부르지 마라. LLM 호출 0회다.**
> **키 값을 보고에 절대 쓰지 마라** — 앞 24자(`wf_ak_ag_hermes_`)까지만 적어라.

---

## 무슨 일인가

네 키 `wf_ak_ag_hermes_ookX…` 가 **공개 저장소에 평문으로 올라가 있었다.**

| 위치 | 커밋 | 언제부터 |
|---|---|---|
| `ops/review1/run_review.js` | `c0d64c6` | 08-16 |
| `ops/review2/run_review.py` | `577b8a9` | 오늘 (내가 브랜치 push 시켜서) |

`raw.githubusercontent.com` 에서 인증 없이 그대로 읽혔다. 실제로 확인했다 —
추정이 아니다.

방금 두 파일에서 키를 지우고 `WF_HERMES_KEY` 환경변수로 바꿔 push 했다(`4cfeb01`).
브랜치 `review33-a`·`review33-b` 는 삭제했다.

**하지만 그것으로는 안 끝난다.** git 히스토리에는 남아 있고, 포크·캐시·이미
긁어간 스캐너에는 그대로다. **회전만이 실제 해결이다.**

내 쪽 `ag_claude_desktop` 키는 이미 회전했다(구 키 401 확인). 네 차례다.

---

## 먼저 알아둘 것

- 네 키에는 `mcp:admin` 이 **없다**. 그래서 자격증명 API 를 네 키로는 못 부른다
- 대신 `WF_ACCESS_TOKEN` 이 복구 경로로 허용돼 있다(`credentials-api.js:28`).
  `ecosystem.config.js` 에 있을 것이다
- **이 방식이면 새 키가 VPS 밖으로 한 번도 안 나간다.** 그래서 이 경로를 쓴다

---

## STEP 1 — git pull 먼저

```bash
cd /opt/data/projects/workflow-builder
git pull
grep -n "WF_HERMES_KEY" ops/review1/run_review.js ops/review2/run_review.py
```

두 파일 다 환경변수를 읽는 형태여야 한다. 아직 평문 키가 보이면 **멈추고 보고해라.**

---

## STEP 2 — 새 키 발급 (localhost, 키는 밖으로 안 나간다)

```bash
cd /opt/data/projects/workflow-builder
node -e "
const T = process.env.WF_ACCESS_TOKEN;
if (!T) { console.error('WF_ACCESS_TOKEN 없음 — 여기서 멈춰라'); process.exit(2); }
fetch('http://localhost:3737/api/agents/ag_hermes/credentials', {
  method:'POST',
  headers:{'Content-Type':'application/json', Authorization:'Bearer '+T},
  body: JSON.stringify({ name:'hermes-vps-r2', scopes:['mcp:read','mcp:execute'] })
}).then(r=>r.json()).then(j=>{
  if(!j.key){ console.error('발급 실패:', JSON.stringify(j)); process.exit(2); }
  require('fs').writeFileSync('/opt/data/.hermes-key', j.key, {mode:0o600});
  console.log('발급 완료 id=', j.credential_id||j.id, 'scopes=', JSON.stringify(j.scopes));
  console.log('키는 /opt/data/.hermes-key 에만 기록했다 (0600)');
});
"
```

### 🔴 지킬 것

- **스코프는 `mcp:read`·`mcp:execute` 두 개만.** `mcp:admin` 을 넣지 마라
- 키를 화면에 찍지 마라. 위 스크립트는 파일에만 쓴다
- `/opt/data/.hermes-key` 는 **저장소 밖**이다. 저장소 안으로 옮기지 마라

---

## STEP 3 — 설치하고 새 키가 실제로 되는지

키를 쓰는 곳 전부에 반영해라. 최소한 이것들이다 — **네가 직접 확인해라:**

```bash
grep -rn "WF_HERMES_KEY\|WF_MCP_KEY" /opt/data/projects/workflow-builder/ops/ \
  /opt/data/scripts/ ~/.hermes/scripts/ 2>/dev/null
```

반영 후 **실동작 확인**:

```bash
export WF_HERMES_KEY="$(cat /opt/data/.hermes-key)"
node -e "
fetch('http://localhost:3737/mcp',{method:'POST',
 headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.WF_HERMES_KEY},
 body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'agent.whoami',arguments:{}}})})
 .then(r=>r.json()).then(j=>console.log(j.result?.content?.[0]?.text||JSON.stringify(j)));
"
```

`agent_id: ag_hermes` 가 나와야 한다. **안 나오면 STEP 4 로 가지 마라** —
구 키를 폐기하면 네 접근이 끊긴다.

---

## STEP 4 — 구 키 폐기하고, 죽었는지 확인

STEP 3 이 ✅ 일 때만.

```bash
node -e "
const T=process.env.WF_ACCESS_TOKEN;
(async()=>{ for(const id of [64,63]){
  const r=await fetch('http://localhost:3737/api/agents/ag_hermes/credentials/'+id,
    {method:'DELETE',headers:{Authorization:'Bearer '+T}});
  console.log('id',id,'폐기 HTTP',r.status, JSON.stringify(await r.json()));
}})();
"
```

- **id 64** = `hermes-vps` (유출된 것)
- **id 63** = `hermes-vps (사용자)` — 한 번도 안 쓰였다. 같이 정리한다

폐기 뒤 **구 키가 진짜 죽었는지** 확인해라. 구 키 문자열은 네 쪽 히스토리·설정에
남아 있을 테니 그걸로 `agent.whoami` 를 한 번 때려서 **401** 이 나오는지 봐라.
**401 확인 전에는 완료라고 하지 마라.**

---

## STEP 5 — 또 어디에 적어놨는가

```bash
grep -rn "wf_ak_ag_hermes_" /opt/data/projects/workflow-builder/ \
  --exclude-dir=.git --exclude-dir=node_modules 2>/dev/null
grep -rln "wf_ak_" /opt/data/scripts/ ~/.hermes/ /opt/data/agents/ 2>/dev/null
```

**하나라도 나오면 그 파일 경로를 보고해라.** 키 값은 적지 마라.

이번 사고의 원인이 정확히 이거다 — `.gitignore` 는 `.mcp.json` 을 막았지만
**그 키를 인용한 문서와 스크립트**는 막지 못했다.

---

## 하지 말 것

1. **키 값을 보고·커밋·로그에 쓰지 마라** — 앞 24자까지만
2. **워커를 부르지 마라** — 이번 지시에 LLM 호출은 없다
3. **STEP 3 실패 상태로 STEP 4 하지 마라** — 네 접근이 끊긴다
4. **새 키에 `mcp:admin` 넣지 마라** — 지금까지 없이도 다 됐다
5. **히스토리를 다시 쓰지 마라** — force-push 금지. 사용자 결정이다

---

## 보고 양식

```
[1] pull
- 두 스크립트 환경변수화 : 확인 / 아직 평문(멈춤)

[2] 발급
- 새 credential id : __   scopes : ______
- 키 기록 위치 : /opt/data/.hermes-key (0600)  예 / 아니오

[3] 설치·검증
- 키를 쓰던 곳 : ______ (경로만)
- whoami 결과 : ag_hermes 확인 / 실패(사유)

[4] 폐기
- id 64 : HTTP ___    id 63 : HTTP ___
- 구 키 재시도 : HTTP ___   ← 401 이어야 함

[5] 잔존 검사
- 저장소 내 평문 : 0건 / 있음(경로: ______)
- 저장소 밖 평문 : 0건 / 있음(경로: ______)

[결과] 완료 / 차단(사유)
```

---

## 참고 — 이건 네 잘못이 아니다

`ops/review2/run_review.py` 가 공개된 건 **내가 지시서 #35 에서 그 커밋을
브랜치로 push 하라고 승인했기 때문이다.** 안에 뭐가 있는지 안 보고 승인했다.

다만 스크립트에 키를 박은 관행은 바꿔야 한다. 앞으로 워커 호출 스크립트는
**처음부터 `process.env` 로 써라.** 이번 지시가 끝나면 그게 기본이다.

`trace_id`: `key-rotate-hermes-20260817`
