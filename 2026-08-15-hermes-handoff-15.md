# 📦 할매봇 작업 지시서 #15 — 밀린 작업 일괄 정리

발신: Claude Code (로컬)
수신: **할매봇 (VPS)**
작성일: 2026-08-15
대상 커밋: **`c13ce3d`**
VPS 경로: `/opt/data/projects/workflow-builder`

> **지시서 #11·#12·#13·#14 는 전부 종료됐다.** 큐에 남아 있는 그 메시지들은
> 처리하지 말고 STEP 1 에서 정리한다. 이 문서 하나만 수행하면 된다.

---

## 로컬에서 이미 확인·처리한 것 (다시 하지 말 것)

| 항목 | 결과 |
|---|---|
| 텔레그램 버튼 | ✅ **복구됨** — 승인 24 가 `approver=@hanwoo79` (웹훅만 만드는 형식), `acceptCount 1` |
| `/api/approvals` 잠금 (#11) | ✅ 검증됨 — 무인증 401 / 키 200 |
| 밀린 승인 21·22·23·25 | ✅ 정리됨. 현재 pending 0 |
| 스펙 문서 §12 환경변수 | ✅ 20종 문서화 (`c13ce3d`) |

---

## STEP 1 — 큐에 쌓인 종료된 지시 정리

`ag_hermes` 앞으로 **5건이 pending 으로 남아 있다.** 전부 종료된 지시서다:

```
id 168  trace_handoff14_31a107b   #14 전용 봇 전환 → 완료
id 167  trace_handoff13_b47333a   #13 → #14 로 대체됨
id 165  trace_handoff12_urgent... #12 취소 지시
id 164  trace_handoff12_urgent... #12 → 취소됨 (의도된 정리였음)
id 163  trace_handoff11_b23fee6   #11 → 완료·검증됨
```

이대로 두면 스케줄러가 재시작될 때마다 대상이 되고, 당신이 큐를 볼 때마다 섞인다.

```sql
UPDATE agent_messages
   SET status = 'completed', read_at = now()
 WHERE to_agent = 'ag_hermes'
   AND status = 'pending'
   AND id IN (163, 164, 165, 167, 168);
```

> **id 를 명시해서 지운다.** `status='pending'` 전체를 건드리지 말 것 —
> 새로 들어온 지시까지 없애게 된다.

확인:
```sql
SELECT id, msg_type, trace_id, status FROM agent_messages
 WHERE to_agent = 'ag_hermes' ORDER BY id DESC LIMIT 8;
```

---

## STEP 2 — 최신 코드 배포

```bash
cd /opt/data/projects/workflow-builder
git status --short
git pull origin main        # c13ce3d
npm run check
npm test                    # 9스위트 135건 기대
npx pm2 restart workflow-builder
```

들어가는 것:
- 웹훅 생존 확인 (부팅 시 + 10분마다 `getWebhookInfo`)
- 스펙 문서 §12 환경변수 20종, §13 테스트 체계

---

## STEP 3 — 웹훅이 유지되는지 확인 (이번 문제의 핵심)

버튼이 한 번 동작한 것과 계속 동작하는 것은 다르다.
전용 봇으로 바꿨으니 이제 해제되지 않아야 한다.

```bash
curl -s -H "Authorization: Bearer <ADMIN_KEY>" \
  http://127.0.0.1:3737/api/telegram/status
```

| 필드 | 기대 |
|---|---|
| `webhook_registered` | **true** |
| `acceptCount` | 1 이상 |
| `rejectCount` | 0 |

**재시작 10분 뒤 한 번 더 확인한다.** `false` 로 바뀌면 아직도 무언가가 해제하는 것이다.

```bash
npx pm2 logs workflow-builder --lines 50 --nostream | grep "\[tg\]"
```
→ `⚠ 웹훅이 등록돼 있지 않다` 가 뜨면 보고할 것

---

## STEP 4 — 로컬 개발 환경용 스키마 덤프 (로드맵 Phase 2)

로컬에서 서버를 띄울 수 없는 상태다. 모든 검증이 프로덕션에서만 가능해서
가장 큰 구조적 위험으로 남아 있다. 스키마가 있으면 로컬 Postgres 로 개발할 수 있다.

```bash
cd /opt/data/projects/workflow-builder
pg_dump -h /opt/data/pgdata -U hermes -d odds --schema-only --no-owner --no-privileges \
  > ops/schema.sql
wc -l ops/schema.sql
grep -c "^CREATE TABLE" ops/schema.sql        # 실제 테이블 수 — 스펙 §8 은 26 이라 적혀 있다
grep "^CREATE TABLE" ops/schema.sql | sed 's/CREATE TABLE //;s/ (//'
```

**데이터는 포함하지 말 것** (`--schema-only`). 커밋 전에 확인:

```bash
grep -icE "wf_ak_|[0-9]{8,10}:[A-Za-z0-9_-]{30,}|password" ops/schema.sql
```
→ **0 이어야 한다.** 0 이 아니면 커밋하지 말고 그 줄을 보고할 것.

```bash
git add ops/schema.sql
git commit -m "chore: 스키마 덤프 (로컬 개발용, 데이터 없음)"
git push origin main
```

---

## STEP 5 — 큐 자동 픽업 확인 (질문)

**지금 자동화가 절반만 돈다.** 내가 `agent.send_message` 로 지시를 보내면:

```
✅ 큐에 적재됨
✅ scheduler 가 감지 → 승인 생성 → 텔레그램 알림
❌ 당신이 집어가지 않음  ← 사람이 알려줘야 시작된다
```

큐의 5건이 하나도 `claim` 되지 않은 게 그 증거다.

**질문: 당신은 VPS 에서 어떻게 기동되는가?**
- 상주 프로세스인가, 텔레그램 메시지로 깨어나는가, 수동 실행인가
- `agent.tasks.list_pending` 을 주기적으로 부르는 루프가 있는가

이 답에 따라 자동 픽업을 어떻게 붙일지 정해진다. **지금 만들지는 말고 현황만 알려달라.**

---

## 하지 말 것

1. **큐 정리에서 `status='pending'` 전체를 건드리지 말 것** — id 를 명시할 것
2. **`pg_dump` 에 데이터를 포함하지 말 것** — `--schema-only` 필수
3. **`ops/schema.sql` 을 시크릿 검사 없이 커밋하지 말 것**
4. **웹훅이 또 해제돼도 secret 을 의심하지 말 것** —
   `/api/telegram/status` 의 `rejectCount` 가 0 이면 secret 문제가 아니다.
   0 이면 콜백이 도달조차 못 하는 것이고, 원인은 롱폴링 충돌이다
5. **STEP 5 에서 자동 픽업을 임의로 구현하지 말 것** — 현황만 보고

---

## 보고 양식

```
[1] 큐 정리
- 163,164,165,167,168 처리 : 완료
- 남은 pending : ____건

[2] 배포
- pull 후 HEAD : ______  (c13ce3d 기대)
- npm test     : __스위트 / __건  (9/135 기대)
- restart      : 완료

[3] 웹훅 유지
- webhook_registered (직후)   : true / false
- webhook_registered (10분 뒤) : true / false   ← 핵심
- acceptCount / rejectCount   : ____ / ____
- [tg] 경고 로그 : 없음 / ______

[4] 스키마
- CREATE TABLE 수 : ____ (스펙 §8 은 26 이라 적혀 있다)
- 테이블 목록     :
- 시크릿 검사     : 0 / ____
- 커밋·푸시       : 완료 / 보류(사유)

[5] 기동 방식 (질문 답변)
- 상주 / 텔레그램 트리거 / 수동 :
- list_pending 폴링 루프 유무   :

[결과] 완료 / 진행 / 차단(사유)
```

작업 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록할 것.

---

## 이 건 이후 (지금은 하지 말 것)

- 삭제된 템플릿(`wf_tpl_team` 등) 재생성 — **사용자 결정 사항.** 임의로 만들지 말 것
- 자동 픽업 구현 — STEP 5 답변을 받은 뒤 설계한다
