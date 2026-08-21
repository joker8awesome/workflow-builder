# 코드리뷰 워커 프로토콜 — Option B (할매봇 실행 + Kimi 리뷰)

작성: 센터장(Opus 4.8) · 2026-08-20 · advisor 압력검증 반영
목적: 완성된 파이썬 프로그램 + 매뉴얼을 받아, **실제 가동하며** 취약점·개선점을 반복 리뷰해 리포트.

> 이 문서는 **프로그램-독립 프로토콜**이다. 프로그램·매뉴얼을 받으면 §9의 빈칸(실행명령·입력세트·청킹)만 채워 번호 지시서로 발행한다.

---

## 아키텍처 (왜 이 형태인가)

- **할매봇(Tier2) = 러너 + 오케스트레이터.** VPS에서 실제 `python`/shell 실행(#49~55로 검증된 유일한 실행 주체).
- **Kimi(Tier3) = 리뷰어.** `[소스]+[매뉴얼]+[실제 실행결과]`를 받아 findings 반환. **Kimi는 실행하지 않는다**(실행 수단이 없다 → 시키면 환각).
- **핵심 게이트(B가 A보다 나은 이유):** Kimi의 모든 주장을 할매봇이 **실제 재현으로 검증**한다. 리뷰어는 실행 못 하지만 러너가 검증한다 — 이 비대칭이 환각을 잡는다.

---

## §0 프로브 게이트 (리뷰 라운드 前 필수 — 실패 시 HALT·보고·대기)

리뷰를 단 한 라운드도 돌리기 전에, 워커 경로가 코드형 프롬프트에서 실제로 동작하는지 실측한다. (advisor 지목 지뢰 2건)

1. **모델 확인** — configured model에 코드형 프롬프트 1건을 던지고 응답의 `model` 필드를 읽는다.
   `server.js:1741`은 기본이 `deepseek/deepseek-v4-flash-0731`이다. **만약 deepseek면 "Kimi 워커" 라벨이 틀린 것 → 정정 보고**(2026-08-16 "Kimi인데 라우트는 deepseek" 사고 재발 방지). 조용히 재라벨 금지.
2. **content 지뢰** — `server.js:1759`는 `message.content`만 읽는다. 08-17 실측: **Kimi K3는 코드 프롬프트에서 reasoning이 max_tokens를 소진해 `content`가 빈값/`'None'`, 실답은 `message.reasoning`에 있음.** content가 비면 `!text` 분기가 502 `llm_failed`를 낸다 → **리뷰 라운드 전에 핸들러가 reasoning 폴백을 해야 함.** 코드리뷰가 바로 이 프롬프트 형태다.
   - 프로브에서 `content` 비었나 / `reasoning`에 있나 / `finish_reason` / 60s timeout 여부를 실측 보고.
   - **content가 비면: 리뷰 라운드로 넘어가지 말고 정지·보고·대기.** (핸들러 수정은 별도 승인 결정 — server.js 변경이라 §8 범위와 충돌, 센터장 판단 필요.)

---

## §1 격리 & 분류 (첫 실행 前 — adversarial 실행 前 보고)

"완성된 프로그램"을 pm2·prod DB가 도는 박스에서 엣지 입력으로 돌리는 게 이 작업의 유일한 실피해 경로다.

- **분류 후 보고:** 프로그램이 무엇을 건드리나 — prod DB 자격증명 / network egress / 파일시스템 쓰기 / subprocess. **분류를 센터장에 먼저 보고**한 뒤 adversarial 실행 시작.
- **격리 실행:** scratch dir(`/opt/data/agents/<id>` 패턴), **fresh venv**, prod env 변수 없음, wall-clock 캡, 출력 크기 캡.

---

## §2 결정론 도구 먼저 (린터가 generic 스윕을 이미 한다)

- 할매봇이 venv에서 `bandit`(보안) · `ruff`(정적) · `pip-audit`(의존성 CVE) 실행 → **그 실제 출력**이 Kimi 프롬프트 재료로 들어간다.
- Kimi는 린터가 못 하는 것만 시킨다: **매뉴얼이 약속한 동작 vs 실제 관측된 동작의 괴리** + 설계 수준 개선. generic 체크리스트는 린터에 맡긴다.

---

## §3 실행 (할매봇 — 입력은 매뉴얼의 약속에서 파생)

- **정상 케이스:** 매뉴얼이 정의한 사용법.
- **엣지/퍼징:** 매뉴얼 약속의 경계 — 빈 입력, 거대 입력, 잘못된 타입, 경계값, 악의적 입력(injection·path traversal). 제너릭 목록이 아니라 **매뉴얼의 약속에서 도출**(이 셋업의 고유 산출물).
- **수집(raw, 할매봇 의견 아님):** stdout · stderr · exit code · wall-time · peak-mem(측정 가능하면) · 기록된 파일 · traceback/예외.

---

## §4 Kimi 리뷰 (관점 로테이션 — loop-until-dry 동력)

각 라운드는 관점 하나에 집중, 프롬프트 = `[소스 청크] + [매뉴얼] + [실제 실행결과]`.
- **보안/취약점:** injection, path traversal, unsafe deserialization(pickle/`yaml.load`), `os.system`/`subprocess(shell=True)`, eval, 하드코딩 시크릿, 안전하지 않은 temp, 입력검증 부재.
- **정확성:** 매뉴얼 약속 vs 실제 관측 괴리, 엣지 크래시, 예외 미처리.
- **성능/리소스:** O(n²), 불필요 I/O, 메모리 징후.
- **개선/유지보수:** 구조, 명명, 중복, 테스트 부재.

**Kimi 제약(실측):** 60s timeout · 출력 4000토큰 캡 · reasoning 필드 · 중국어 safety refusal(보안 프롬프트가 prime trigger, #48을 죽인 그것). → 소스 크면 청킹, 리포트 관점/파일별 분할.

---

## §5 Finding 계약 (없으면 리포트가 반증불가 — 반드시)

- Kimi의 **모든 주장은 `file:line` 앵커 + 구체적 재현 입력/명령**을 달아야 한다.
- 할매봇이 그 입력으로 **재실행** → 스탬프: **CONFIRMED**(재현됨) / **REFUTED**(재현 안 됨) / **STATIC-ONLY**(실행으로 못 흔듦 — 구조·명명 등).
- **앵커 없는 주장 = 반려**(caveat 달아 포함이 아니라 제외). 이게 B가 A를 이기는 이유 전부.

---

## §6 실패는 실패로 (silent 실패를 clean bill로 읽지 않는다)

`server.js:1731-1733` 주석의 교훈: 리뷰 12건 중 7건이 잘렸는데 받는 쪽이 완성된 답으로 읽었다.
- **호출마다** 할매봇이 `model` · `truncated`(finish_reason=length) · refusal 여부를 기록·보고.
- `truncated=true` → 그 슬라이스 재분할·재실행.
- refusal → verbatim 로그, 해당 슬라이스 **unreviewed** 표시, 계속.
- **"no findings"는 호출이 실제 완료됐을 때만 유효.** 502/timeout/refusal은 "깨끗함"이 아니라 "미검토".

---

## §7 수렴 (loop-until-dry)

- 매 라운드 dedupe는 **지금까지 본 전부(seen)** 기준 — **confirmed 기준 아님**(그러면 REFUTED가 매 라운드 부활해 수렴 안 함).
- **K=2 연속 라운드 새 발견 0 → 정지.** 하드 라운드 캡 둔다.
- 드롭·미검토분은 `log()` — 잘린 스윕이 전수 커버리지로 읽히지 않게.
- **rate limit 주의:** worker 분당 20회 — files × dimensions × rounds가 이걸 넘지 않게 배분.

---

## §8 범위 밖 (B를 고른 이유를 지킨다)

- **server.js 변경·신규 엔드포인트 없음.** 기존 경로만(할매봇 python/shell + `/api/llm/worker`).
- **pm2 restart 없음** → `guarded-deploy`/승인게이트 이 작업 범위 아님.
- **`run_python` 툴 배선 금지**(그건 Option C — 별도 결정).
- (예외: §0에서 content 지뢰 확인 시 핸들러 reasoning 폴백은 server.js 변경 → 그때만 별도 승인 게이트로 올린다.)

---

## 보고

- 할매봇 → 센터장(나) → 사용자. `trace_id` 부여. `deepbot_action.md` 로그.
- 최종 리포트: CONFIRMED findings(심각도순) + REFUTED/STATIC-ONLY 목록 + 미검토 슬라이스 + 라운드별 수렴 로그.

---

## §9 프로그램 받으면 채울 빈칸

- [ ] 실행 명령 (매뉴얼 기준): `______`
- [ ] 입력세트 (정상 + 엣지, 매뉴얼 약속 파생): `______`
- [ ] 소스 청킹 크기 (Kimi 컨텍스트/4000토큰 캡 기준): `______`
- [ ] 프로그램 위치 (이 repo / 별도 경로 / 첨부): `______`
- [ ] network / DB / secrets 필요 여부: `______`
- [ ] trace_id: `code-review-<name>-20260820`
