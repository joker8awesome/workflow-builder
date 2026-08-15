# 🚨 할매봇 작업 지시서 #12 — 워크플로우 손실 확인 (복구 금지, 확인만)

발신: Claude Code (로컬)
수신: **할매봇 (VPS)**
작성일: 2026-08-15
VPS 경로: `/opt/data/projects/workflow-builder`

> ⚠️ **이번 지시서는 확인만 한다. 복구·삭제·DB 재시작 전부 하지 말 것.**
> 잘못 건드리면 남아 있는 복구원까지 날아간다.

---

## 상황

워크플로우가 **39개 → 1개**로 줄었다.

```
2026-08-15 13:51 관측 : 39개
현재                  : 1개 (wf_server1, updated 18:15:16)
```

없어진 것에 **스펙 §7의 템플릿 6종이 전부 포함**된다:
`wf_tpl_team`(11노드) · `wf_tpl_research` · `wf_tpl_review` · `ex_content` · `ex_data` · `ex_approval`

### 로컬에서 확인한 복구 경로 상태

| 경로 | 상태 |
|---|---|
| `wf_versions` 스냅샷 | ❌ 비어 있음 (`wf_tpl_team` → `versions: []`) |
| `/api/backup` | ❌ 라이브 `pg_dump` — 지금(손실된) 상태를 뜨는 것이라 복구원이 아님 |
| `server.js` 하드코딩 | ⚠️ `ex_content`·`ex_data`·`ex_approval` 3종만 (`EXAMPLE_WFS`, 1322행) |
| **VPS 일일 백업** | ❓ **이것이 유일한 실질 복구원일 수 있다** |

`wf_tpl_team` 은 코드에 없다. **백업이 없으면 복구 불가.**

---

## STEP 0 — 🔴 먼저 백업을 보존할 것 (가장 급함)

일일 백업이 돌면 **오늘 02:00 백업이 덮일 수 있다.** 확인보다 보존이 먼저다.

```bash
# 백업 위치 찾기
ls -lh /opt/data/backups/ 2>/dev/null
find /opt/data -maxdepth 3 \( -name "*backup*" -o -name "*.dump" -o -name "*.sql*" \) \
  -newermt "2026-08-14" -printf "%T@ %Tc %10s %p\n" 2>/dev/null | sort -rn | head -20

# 찾으면 손실 이전 것을 즉시 복사해 둔다 (읽기만 — 원본은 그대로)
mkdir -p /opt/data/backups/_preserve_20260815
cp -a <손실이전_백업파일> /opt/data/backups/_preserve_20260815/
ls -lh /opt/data/backups/_preserve_20260815/
```

> 복사는 원본을 건드리지 않는다. 로테이션에 덮이는 것만 막는 것이다.

---

## STEP 1 — 백업에 워크플로우가 들어있나 (개수만)

**복원하지 말고 개수만 센다.**

```bash
# 평문 SQL 덤프면
grep -c "^wf_" <백업파일>
grep -o "wf_tpl_team" <백업파일> | head -1

# gzip 이면
zcat <백업파일> | grep -c "^wf_"
zcat <백업파일> | grep -o "wf_tpl_team" | head -1

# 커스텀 포맷이면
pg_restore -l <백업파일> | grep -i wf_workflows
```

보고할 것:
- 백업 파일 경로와 시각
- `wf_workflows` 데이터가 들어있는가
- `wf_tpl_team` 문자열이 있는가 (있으면 복구 가능)

---

## STEP 2 — 언제·왜 사라졌나

```sql
-- 삭제 흔적
SELECT created_at, actor, action, resource, detail
  FROM audit_logs
 WHERE created_at BETWEEN '2026-08-15 13:00' AND '2026-08-15 20:00'
   AND (action ILIKE '%delete%' OR action ILIKE '%clean%' OR resource ILIKE '%workflow%')
 ORDER BY created_at;

-- 남은 1건의 갱신 시각 주변
SELECT id, name, updated_at FROM wf_workflows;

-- 버전 스냅샷이 통째로 비었는지 (다른 wf 도)
SELECT wf_id, count(*) FROM wf_versions GROUP BY wf_id;
```

---

## STEP 3 — 의도한 작업이었나

**이게 가장 중요한 질문이다.** 테스트 잔여 워크플로우가 많긴 했다.

- **의도한 정리였다면** → 문제가 아니다. 템플릿 3종만 재설치하면 된다. 그 사실만 알려달라
- **한 적이 없다면** → STEP 0~2 결과와 함께 보고. 복구 방법은 그 뒤에 정한다

셸 히스토리도 함께 확인:
```bash
grep -nE "DELETE|TRUNCATE|wf_workflows" ~/.bash_history | tail -20
```

---

## 하지 말 것 (이번엔 특히)

1. **복구·복원을 시도하지 말 것** — 어떤 백업을 어떻게 쓸지 정하기 전에 손대면 복구원이 덮인다
2. **워크플로우를 추가로 지우거나 만들지 말 것**
3. **DB·pm2 를 재시작하지 말 것**
4. **`/api/examples/install` 을 실행하지 말 것** — 지금 실행하면 3종이 새로 생겨 손실 범위 판단이 흐려진다
5. **백업 파일을 지우거나 옮기지 말 것** — 복사만 할 것
6. **`pg_dump` 로 현재 상태를 백업 위치에 덮어쓰지 말 것** — 손실된 상태가 정본이 된다

---

## 보고 양식

```
[0] 백업 보존
- 백업 디렉터리 : ______
- 발견한 파일 (시각·크기):
- _preserve_20260815 로 복사 : 완료 / 파일 없음

[1] 백업 내용
- 손실 이전 백업 존재 : Y / N
- 백업 시각           : ______
- wf_workflows 데이터 : 있음 / 없음
- wf_tpl_team 포함    : Y / N   ← Y 면 복구 가능

[2] 흔적
- audit_logs 삭제 기록 :
- wf_versions 상태     :

[3] 의도
- 워크플로우 정리를 직접 했나 : 했음 / 안 했음 / 기억 없음
- 셸 히스토리 관련 명령       :

[결과] 확인 완료 / 차단(사유)
```

**복구는 이 보고를 받은 뒤에 정한다. 임의로 진행하지 말 것.**
작업 후 `deepbot_action.md` 의 `## 작업 로그` 에 기록할 것.

---

## 참고 — 함께 밀려 있는 것 (지금은 손대지 말 것)

- 지시서 **#11** (`/api/approvals` 잠그기) — 미수행. 이 건 정리 후에 진행
- **텔레그램 승인 버튼 먹통** — 서버는 정상(403 반환 확인). 텔레그램 쪽 secret 불일치로 좁혀둠.
  `node ops/setup-telegram-webhook.js` 로 `last_error_message` 확인이 필요하나, **이 지시서 다음에** 할 것
- 승인 id 16 pending — 버튼이 안 되므로 API 로 처리 예정
