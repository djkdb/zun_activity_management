# PHASE 0 — 레포 감사 (2026-09-17)

구현 전 현재 상태를 있는 그대로 적는다. 없는 것은 없다고 적는다.

---

## 1. 현재 아키텍처

```
bin/zun.mjs   479줄  CLI 전체 — 인자 파싱·5개 명령·미리보기·저장·중복검사가 한 파일
src/db.mjs     95줄  Supabase 클라이언트(service_role) + 질의 4개 + .env 로더
src/parse.mjs 118줄  claude CLI 서브프로세스 + JSON 추출 + normalize()
src/prompt.mjs 91줄  파싱 프롬프트 템플릿 (활동목록·오늘·고정일정 주입)
src/render.mjs 109줄 ANSI·CJK 폭 계산 표·Asia/Seoul 날짜 유틸
src/schedule.mjs 85줄 고정 주간일정 로더 + 충돌 판정
public/index.html 1227줄  대시보드 전체 (CSS+JS 인라인, 빌드 없음)
public/schedule.json      시간표 원본 (CLI·대시보드 공용)
```

- **런타임 의존성 1개** (`@supabase/supabase-js`). devDependencies 0개.
- 빌드 스텝 없음. TypeScript 없음. 번들러 없음.
- **AI 파싱은 `claude` CLI 서브프로세스**가 유일한 경로다. 이건 비용 제약(구독 정액,
  종량과금 금지)에서 나온 선택이며 계속 지켜야 한다.

## 2. 현재 데이터 모델

Supabase(Postgres) 한 프로젝트를 **다른 앱과 공유**한다. `sp_` 4개가 우리 것이고
나머지 18개(`items`, `battles`, `profiles` …)는 study/battle 앱 소유다.

```
sp_activity (8행) ──1:N──> sp_item (39행)
       │                        │
       └──────1:N──> sp_output ─┘   (산출물·활동비, 0행)
sp_ingest  원문+파싱결과 보관 (0행 — 쓰기만 하고 아무도 읽지 않는다)
```

**중요한 발견: `kind`/`stage`/`status`에 CHECK 제약이 없다.** 전부 기본값이 있는
자유 텍스트다. 즉 `kind='할일'`, `kind='마일스톤'`, `kind='알림'` 을
**DDL 없이 지금 당장 넣을 수 있다.**

제약조건은 PK/UNIQUE(slug)/FK 3개뿐이고, FK 는 `ON DELETE CASCADE`(item) /
`SET NULL`(output)로 이미 합리적이다.

RLS: anon 은 읽기 + `sp_item` UPDATE + `sp_output` 전체. 생성·삭제와 `sp_ingest`
전체는 service_role 전용 = CLI 전용.

## 3. 현재 CLI UX

```
zun add [텍스트]   인자 / 파이프 / -f 파일 / $EDITOR 로 원문 → claude 파싱 → 표 미리보기
                  → [Enter] 저장 [e] 수정 [q] 취소 → 중복 확인 → 저장
zun save <json>   파싱 건너뛰고 직접 삽입 (스킬이 호출)
zun ls [일수]      다가오는 마감 (기본 30일), 날짜별 그룹 + 고정일정 표시
zun done <검색어>  제목 부분일치 → 번호 선택 → 완료 토글
zun open          배포된 대시보드 열기
옵션: -f --activity --source -y --dry-run --all -h
```

강점: **입력이 자유롭다.** 이미 "이번 주 금요일", 주차별 표 전개, 활동 자동 매칭이
동작한다. 목표 UX의 절반은 이미 있다.

## 4. 현재 구현된 기능

| 기능 | 상태 |
|---|---|
| 자연어 → 일정 파싱 | ✅ `claude -p` + 구조화 JSON + normalize |
| 상대 날짜 해석 | ✅ 오늘·이번주·다음주 경계를 프롬프트에 주입 |
| 기존 활동 자동 매칭 | ✅ slug 목록 주입 |
| 중복 방지 | ✅ 같은 활동+같은 날짜+제목 유사도(Dice ≥0.6) |
| 고정 일정 충돌 감지 | ✅ 수업·근로·알바 (`schedule.json`) |
| 활동 정보 보완 | ✅ 비어있거나 '미정'인 칸만 채움 |
| 웹 대시보드 | ✅ 캘린더·마감·활동카드·산출물 |
| **Reminder** | ❌ 없음 |
| **Task / Milestone** | ❌ 없음 (마감만 있음) |
| **Notion 연동** | ❌ 없음 |
| **Apple 연동 / .ics** | ❌ 없음 |
| **today / week / search / inbox** | ❌ 없음 |
| **테스트** | ❌ 0개 |
| **config 명령** | ❌ 없음 (.env 직접 편집) |
| **로깅** | ❌ 없음 (console 직접) |
| **타입/스키마 검증** | ❌ 없음 (normalize 가 방어 일부 담당) |

## 5. 잘못된 부분 / 기술 부채

1. **`bin/zun.mjs` 479줄이 전부 한 파일.** 인자 파싱·5개 명령·미리보기 렌더·저장
   트랜잭션·중복 검사가 섞여 있다. 명령을 늘리면 바로 무너진다. **가장 시급하다.**
2. **`src/db.mjs` 에 try/catch 가 0개.** 모든 에러가 `main().catch` 로 올라가
   문맥 없는 메시지가 된다.
3. **중복 검사가 item 당 네트워크 왕복 1회.** 20건 붙여넣으면 20회. 하루치를
   한 번에 받아 메모리에서 비교해야 한다.
4. **`sp_ingest` 는 쓰기만 하고 읽지 않는다.** 되돌리기·재파싱에 쓸 수 있는데 안 쓴다.
5. **파싱 규칙이 두 곳에 중복.** `src/prompt.mjs` 와 `.claude/skills/zun-ingest/SKILL.md`
   가 같은 12개 규칙을 각자 적고 있다. 이미 한 번 어긋날 뻔했다.
6. **`normalize()` 가 검증이 아니라 강제 변환이다.** 잘못된 날짜 문자열이 그대로
   DB 로 간다. 실패를 보고하지 않는다.
7. **`claude` 실패 시 폴백이 없다.** CLI 가 없거나 타임아웃이면 기능 전체가 멈춘다.
8. **날짜 유틸이 `render.mjs`(표시 모듈)에 산다.** `schedule.mjs` 가 표시 모듈을
   import 하는 역방향 의존이 생겼다.
9. **대시보드 1227줄 단일 파일.** 지금은 감당되지만 기능이 더 붙으면 어렵다.
   다만 "빌드 없음"은 Cloudflare Pages 배포의 장점이라 신중해야 한다.
10. **테스트 0개.** 날짜 파싱처럼 조용히 틀리는 로직이 많은데 안전망이 없다.

## 6. 확장 시 문제가 될 부분

- **동기화 메타데이터가 없다.** `external_id` / `provider` / `synced_at` / `hash` 가
  없으면 Apple 연동은 실행할 때마다 중복 이벤트를 만든다. idempotent sync 불가.
- **item 끼리 부모-자식 관계가 없다.** 마일스톤을 마감 아래 달 수 없다.
- **알림(reminder)을 저장할 자리가 없다.** D-7/D-3/D-1 을 어디에도 못 적는다.
- **`zun` 최상위 자연어 단축이 없다.** 현재 `zun "..."` 은 "알 수 없는 명령"이다.
- 반복 일정(recurrence)·장소·URL 필드가 `sp_item` 에 없다 (memo 로 우회 중).

## 7. 고도화 우선순위 (내 판단)

기존 UX 를 깨지 않는 것과, **스키마 변경 없이 갈 수 있는 거리**를 기준으로 정렬했다.

**P0 — 스키마 변경 없이 지금 가능 · 기반 정리**
1. `bin/zun.mjs` 분해 (`src/cli/*`) + 인자 라우터만 남기기
2. 날짜 유틸을 `src/core/dates.mjs` 로 분리 (역방향 의존 제거)
3. `node:test` 로 날짜·마감·충돌·중복 테스트 (의존성 0)
4. **`zun "자연어"` 최상위 단축** — 미지정 명령을 `add` 로 라우팅
5. 파싱 실패 시 **정규식 폴백 파서** (graceful degradation)
6. 규칙 중복 제거 — 프롬프트 규칙을 한 곳에서 생성해 SKILL.md 가 참조

**P1 — 실사용 핵심 (스키마 변경 없이 가능)**
7. `zun today` / `zun week` / `zun search` / `zun deadline`
8. 중복 검사 N+1 제거
9. `kind='할일'|'마일스톤'` 도입 — **CHECK 제약이 없어 DDL 불필요**
10. 마감 감지 시 마일스톤 **제안 → 사용자 승인** UX
11. 기존 일정 간 시간 충돌 감지(고정 일정 + item 상호)

**P2 — 외부 연동 (여기서 스키마 변경이 필요해진다)**
12. `zun export` → `.ics` (VEVENT + VALARM)
13. **Cloudflare Pages 에 `calendar.ics` 발행 → 아이폰 "구독 캘린더"** (아래 8절)
14. 동기화 메타데이터 컬럼 추가 → idempotent sync

**P3 — 고급**
15. inbox, 자연어 검색, Notion, URL 스크래핑, analytics

## 8. 제안하는 새로운 아키텍처

### 8-1. 모듈 구조 (과하지 않게, 지금 크기에 맞춰)

```
bin/zun.mjs          인자 라우팅만 (~60줄)
src/
  cli/               명령 하나당 파일 — add.mjs today.mjs week.mjs search.mjs export.mjs …
  core/
    dates.mjs        Asia/Seoul 날짜 (render 에서 분리)
    model.mjs        Activity/Item 형태 + 검증 (의존성 없이 ~60줄)
    conflict.mjs     고정일정 + 기존 item + 버퍼
    dedupe.mjs       유사도·중복
    rules.mjs        파싱 규칙 한 곳 (프롬프트·스킬이 여기서 가져감)
  providers/
    ai/claude-cli.mjs   현재 서브프로세스 구현
    ai/fallback.mjs     정규식 날짜 파서 (AI 없이도 동작)
    ai/index.mjs        인터페이스 + 실패 시 폴백
    store/supabase.mjs  현재 db.mjs
    export/ics.mjs      iCalendar 생성
  render/            터미널 표·박스·색 (현 render.mjs)
```

**의존성은 계속 1개로 둔다.** 검증은 zod 대신 손으로 쓴 ~60줄 검증기 —
이미 `normalize()` 가 하던 일을 실패 보고가 되게 바꾸는 수준이면 충분하다.
테스트는 Node 22 내장 `node:test` (의존성 0).

### 8-2. Activity / Event / Task 를 새 테이블 없이 표현

`kind` 에 CHECK 제약이 없다는 점을 활용한다. **새 테이블 0개, 추가 컬럼 5개**로
요청하신 계층을 전부 표현할 수 있다.

```
sp_activity            = Activity           (그대로)
sp_item kind='마감'     = Deadline
sp_item kind='회의|행사' = Event
sp_item kind='할일'     = Task        ← 새 kind 값, DDL 불필요
sp_item kind='마일스톤'  = Milestone   ← 새 kind 값, DDL 불필요
sp_item kind='알림'     = Reminder    ← 새 kind 값, DDL 불필요
```

부모-자식과 동기화만 컬럼이 필요하다 (**추가 전용, 파괴적이지 않음**):

```sql
alter table sp_item
  add column parent_id   uuid references sp_item(id) on delete cascade,
  add column external_id text,
  add column provider    text,
  add column synced_at   timestamptz,
  add column sync_hash   text;
create index on sp_item (parent_id);
create unique index on sp_item (provider, external_id) where external_id is not null;
```

→ **이 5개 컬럼이 이번 고도화의 유일한 스키마 변경이다.** 기존 39행·8행은
그대로 남고 컬럼은 전부 nullable 이라 현재 코드도 계속 동작한다.

### 8-3. Apple 연동 — companion 앱 없이 가는 길

이게 이번 감사에서 제일 값진 발견이다. **이미 Cloudflare Pages 에 정적 배포
중이므로, `.ics` 를 같은 곳에 발행하면 아이폰이 "구독 캘린더"로 자동 동기화한다.**

```
zun export → public/calendar.ics → git push → Pages 자동 배포
                                                    ↓
        아이폰 설정 → 캘린더 → 계정 추가 → 구독 캘린더 → URL 입력
                                                    ↓
                        iOS 가 주기적으로 당겨감 (읽기 전용, 알림 포함)
```

- **companion 앱·EventKit·CalDAV 서버 전부 불필요.** 개발량 대비 효과가 압도적이다.
- `VALARM` 을 넣으면 D-7/D-3/D-1 알림이 **아이폰 알림으로 실제로 온다.**
- 중복이 안 생긴다 — 구독 캘린더는 파일 전체를 덮어쓴다. `UID` 만 안정적으로
  유지하면 idempotent 가 공짜로 따라온다.
- 한계: **읽기 전용**이다(아이폰에서 체크해도 CLI 로 안 돌아온다). 그리고 미리알림
  (Reminders)은 구독으로 안 된다 — 필요하면 그때 iOS 단축어를 붙인다.

→ 그래서 iOS companion 앱은 **지금 만들지 않는다.** 양방향 동기화가 실제로
필요해진 다음에 판단할 일이다.

## 9. 단계별 구현 계획

| 단계 | 내용 | 스키마 변경 | 기존 UX 영향 |
|---|---|---|---|
| **1** | 모듈 분해 + 날짜 분리 + 테스트 도입 | 없음 | 없음 (동작 동일) |
| **2** | `zun "자연어"` 단축 + 폴백 파서 + 규칙 단일화 | 없음 | 추가만 |
| **3** | `today` / `week` / `search` / `deadline` | 없음 | 추가만 |
| **4** | 할일·마일스톤 kind + 마감 → 마일스톤 제안 UX | 없음 | 추가만 |
| **5** | `zun export` → `.ics` + Pages 발행 + 아이폰 구독 | 없음 | 추가만 |
| **6** | 알림(kind='알림') + 부모-자식 + 동기화 메타 | **컬럼 5개** | 추가만 |
| **7** | inbox / Notion / 자연어 검색 | 미정 | 추가만 |

각 단계 끝에 실제로 실행해 확인하고, 기존 `add`/`ls`/`done`/`save`/`open` 이
그대로 동작하는지 회귀 확인한다.

---

## 결정이 필요한 것

1. **6단계의 컬럼 5개 추가를 승인하시나요?** 추가 전용·nullable 이라 기존 데이터와
   코드에 영향이 없지만, 살아있는 DB 를 바꾸는 일이라 임의로 하지 않겠습니다.
   승인 전까지는 1~5단계(스키마 변경 없음)만 진행합니다.
2. **Notion 을 실제로 쓰시나요?** 현재 연동이 전혀 없어서, 쓰신다면 어떤 DB/페이지를
   쓰는지 알아야 설계할 수 있습니다. 안 쓰시면 이 항목은 빼겠습니다.
3. **아이폰 연동은 위 '구독 캘린더' 방식으로 가도 될까요?** 읽기 전용이지만 앱 없이
   오늘 바로 됩니다. 양방향이 꼭 필요하면 범위가 크게 달라집니다.
