# 모델 교체 가능성 보고 — 센터장을 GPT·Grok 으로 바꿀 수 있는가

작성: Claude Code (센터장)
작성일: 2026-08-17
기준 커밋: `e581bbb`
질문: *"지금 너의 모델을 클로드가 아닌 GPT나 Grok 으로 교체할 수 있는가"*

---

## 결론 (한 줄)

**센터장(Tier 1)은 못 바꾼다. 그런데 Tier 2·3 은 이미 Claude 가 아니다.**

---

## 1. 왜 센터장은 못 바꾸는가

나는 **Claude Code** 라는 CLI 위에서 돈다. 이 실행기는 Anthropic 이 만들었고
Anthropic 모델만 붙는다.

| 붙는 것 | 안 붙는 것 |
|---|---|
| Anthropic API (Opus·Sonnet·Haiku·Fable) | GPT (OpenAI) |
| Amazon Bedrock — **Claude 계열** | Grok (xAI) |
| Google Vertex AI — **Claude 계열** | Gemini·Llama·Mistral |

Bedrock·Vertex 는 "다른 회사 인프라"지 "다른 회사 모델"이 아니다.
경유지가 바뀔 뿐 모델은 Claude 다.

`/model` 로 바꿀 수 있는 범위도 Claude 안이다 (Opus 5 ↔ Sonnet 5 ↔ Haiku 4.5 ↔ Fable 5).

### 우회로가 없지는 않다 — 권하지 않는다

Anthropic API 형식을 OpenAI 형식으로 번역하는 커뮤니티 프록시가 있다.
**공식 지원이 아니다.** 그리고 이 팀에는 특히 안 맞는다:

- 툴 호출 형식이 어긋나면 파일 편집·git·MCP 가 조용히 깨진다 —
  **오늘 하루 종일 잡은 게 "조용히 깨지는 것"이다**
- 깨졌을 때 원인이 모델인지 프록시인지 분간이 안 된다
- 판단자가 틀리면 아래 계층이 전부 틀린다 (초안 §4)

**Tier 1 은 실험할 자리가 아니다.**

---

## 2. 🔴 그런데 — 팀의 3계층 중 둘은 이미 Claude 가 아니다

이게 이 보고의 핵심이다. 질문이 "바꿀 수 있나" 였는데, **이미 바뀌어 있다.**

| 계층 | 누구 | 실제 모델 | 과금 | 교체 난이도 |
|---|---|---|---|---|
| **Tier 1** | 센터장 | Claude Opus 5 | Anthropic 구독 | ❌ **불가** |
| **Tier 2** | 할매봇 | `deepseek/deepseek-v4-flash-latest` | Nous Portal | ⚠️ 런타임 교체 필요 |
| **Tier 3** | 워커 | `moonshotai/kimi-k3` | Nous Portal | ✅ **환경변수 한 줄** |

### 근거

**Tier 2** — `msg_319`(할매봇 인증 실측, 오늘 `cost-audit`):

```
실제_인증          : Nous Portal OAuth access_token (/opt/data/auth.json, active_provider=nous)
delegation_model   : deepseek/deepseek-v4-flash-latest
ANTHROPIC_API_KEY  : 없음
홈_claude_json     : oauthAccount 없음 — Claude 구독 인증 안 씀
```

**할매봇은 Claude 를 한 번도 쓴 적이 없다.** 오늘 비용 조사에서 확인한 사실이다.

**Tier 3** — `server.js:1744`:

```js
const workerModel = process.env.WF_LLM_WORKER_MODEL || 'deepseek/deepseek-v4-flash-0731';
const r = await fetch(nous.base + '/chat/completions', {
  headers: { Authorization: 'Bearer ' + nous.token },
  body: JSON.stringify({ model: workerModel, ... }),
});
```

- 엔드포인트가 **OpenAI 호환**(`/chat/completions`)이다
- 모델은 `WF_LLM_WORKER_MODEL` 문자열 하나다
- **이미 한 번 갈아봤다** — `deepseek` → `moonshotai/kimi-k3` (`#31`, `ecosystem.config.js`)

---

## 3. 그래서 실제로 할 수 있는 것

### ✅ 즉시 가능 — Tier 3 모델 교체

Nous Portal 카탈로그에 GPT·Grok 계열이 있다면 **환경변수 한 줄 + `pm2 restart`** 다.

```
WF_LLM_WORKER_MODEL=<카탈로그의 모델명>
```

**전제가 하나 있다 — 카탈로그에 있는가.** 이건 VPS 에서만 확인된다(§5).

`#25` 의 교훈: 카탈로그에 없는 이름을 넣으면 **전 호출 404** 가 된다.
그때 `|| JSON.stringify(j)` 때문에 404 본문이 결과로 기록되고 `success:true` 로 찍혔다.
지금은 502 로 뜨게 고쳐놨지만, **모델명은 반드시 실호출로 확인해야 한다.**

### ⚠️ 가능하지만 큰 작업 — 다른 공급자 추가

지금 LLM 경로는 **Nous 단일**이다. 폴백 체인이라 이름 붙었지만 실제로는:

```js
async function callLLMWithFallback(messages, opts) {
  const nous = getNousAuth();
  if (!nous) return { fallback: true, error: 'no auth' };
  try { /* Nous 호출 */ }
  catch (e) { /* 폴백 = 규칙 기반 문자열. 다른 LLM 이 아니다 */ }
}
```

**"폴백"이 다른 모델이 아니라 규칙 기반 하드코딩 문자열이다.**
OpenAI·xAI 를 직접 붙이려면 공급자 추상화를 만들어야 한다 — 키 관리·레이트
리밋·과금 경로가 각각 늘어난다.

참고: `/api/fallback-log` 는 현재 **0건**이다. 폴백이 발동한 적이 없다 —
Nous 가 안정적이었다는 뜻이고, 동시에 **폴백 경로가 한 번도 검증된 적이 없다**는 뜻이다.

### ⚠️ 별도 런타임 — Tier 1 을 비-Claude 로 두고 싶다면

Claude Code 를 GPT 로 바꾸는 게 아니라, **다른 CLI 를 나란히 세우는** 방법이다.
이 환경에는 `pumasi` 스킬이 이미 그 패턴으로 있다 —
Claude 가 PM·아키텍트를 맡고 Codex CLI(OpenAI) 인스턴스가 병렬 개발을 맡는다.

즉 **"판단자를 교체" 가 아니라 "집행자를 다른 모델로 추가"** 다.
초안 §4 의 계층 구조와 어긋나지 않는다.

---

## 4. 그런데 — 바꿀 값이 있는가

기술적 가능성과 별개로, **모델 교체가 실제로 성과를 바꾼 전례가 이 팀에 있다.**

`deepseek-v4-flash` → `moonshotai/kimi-k3` 교체 후 측정
(`2026-08-16-deepseek-worker-capability.md` 부록):

- ✅ **이름만으로 지어내는 위험이 줄었다** — 코드 없이 물으면 거부한다
- ✅ **코드 리뷰가 더 깊어졌다** — `queue-trigger.js` seen 버그에서 예외 미처리와
  원자성까지 짚었다. 내가 직접 볼 때 못 본 것이다
- ❌ **거짓 전제는 여전히 받는다** — 없는 헬퍼를 "있다"고 하면 그걸 쓰는 답을 낸다

**Tier 3 모델 교체는 근거 있는 레버다.** 채택률로 바로 측정된다
(`#29` 무효 → `#33` 46% → `#39` 진행 중).

반면 **Tier 1 교체는 측정할 방법이 없다.** 판단자가 바뀌면 비교 기준 자체가 바뀐다.

---

## 5. 확인이 필요한 것 (VPS 에서만 됨)

내가 Windows 에서 못 보는 것이다. 할매봇이 재야 한다.

```bash
# Nous Portal 카탈로그에 무엇이 있는가
node -e "
const a=JSON.parse(require('fs').readFileSync('/opt/data/auth.json','utf8'));
const n=a.providers.nous;
fetch(n.inference_base_url+'/models',{headers:{Authorization:'Bearer '+n.access_token}})
 .then(r=>r.json()).then(j=>console.log((j.data||[]).map(m=>m.id).join('\n')));
"
```

**확인할 것**

1. 카탈로그에 GPT·Grok 계열 모델명이 있는가 (없을 가능성이 높다)
2. 있다면 실호출이 200 을 주는가 (`#25` 처럼 이름만 있고 404 일 수 있다)
3. 단가가 Kimi 와 얼마나 다른가

**값을 모르면 "모른다" 고 적을 것.** 지어내면 판단이 통째로 틀어진다.

---

## 6. 권고

| 계층 | 권고 | 이유 |
|---|---|---|
| Tier 1 센터장 | **그대로 둔다** | 교체 수단이 없고, 우회로는 조용한 고장을 만든다 |
| Tier 2 할매봇 | **그대로 둔다** | 이미 비-Claude 다. 지금 잘 돈다 |
| Tier 3 워커 | **카탈로그 확인 후 판단** | 한 줄이고, 채택률로 즉시 측정된다 |

**질문에 대한 답을 다시 정리하면** — 바꿀 수 있느냐가 아니라
**이미 셋 중 둘이 다른 모델이고, 바꿀 수 있는 자리는 정확히 한 곳(Tier 3)이다.**

---

## 7. 이 문서의 한계

- Nous 카탈로그를 직접 못 봤다. §5 가 채워지기 전까지 "GPT·Grok 사용 가능" 은 **미확인**이다
- Claude Code 의 지원 범위는 내가 도는 실행기에 대한 것이다.
  다른 버전·배포에서 달라질 수 있다
- `pumasi` 는 이 환경에 스킬로 존재하는 것을 확인했을 뿐, 이 프로젝트에서
  써본 적은 없다

---

`trace_id`: `model-swap-feasibility-20260817`
