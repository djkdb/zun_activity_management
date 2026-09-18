---
name: zun-ingest
description: 서포터즈·대외활동 안내문 원문(카톡 공지, 가이드북, 노션 붙여넣기 등)을 일정으로 파싱해 Supabase 에 저장한다. 사용자가 운영진 공지·가이드북·모집 안내 같은 정제되지 않은 텍스트를 붙여넣거나, 일정을 등록·추가해 달라고 할 때 사용한다.
---

# zun-ingest

사용자가 이 세션에 **안내문 원문을 그대로 붙여넣었을 때** 쓰는 스킬이다.
CLI 를 다시 spawn 하지 말고 (`zun add` 를 호출하면 claude 서브프로세스가 중첩된다),
**네가 직접 아래 규칙대로 파싱해서 임시 JSON 파일로 쓴 뒤 `node bin/zun.mjs save <파일>` 을 호출한다.**

## 절차

### 1. 기존 활동 목록을 먼저 읽는다
```bash
node -e "import('./src/db.mjs').then(async m=>{const a=await m.listActivities();console.log(a.map(x=>\`\${x.slug} | \${x.name} | \${x.org??'-'} | \${x.status} | \${x.cadence??'-'}\`).join('\n'))})"
```
이 목록에 있는 활동이면 **반드시 그 slug 를 재사용**한다. 새 활동일 때만 `activities` 에 넣는다.

### 2. 오늘 날짜를 확인한다 (Asia/Seoul)
```bash
node -e "import('./src/prompt.mjs').then(m=>console.log(JSON.stringify(m.weekContext(),null,1)))"
```
`today` / `thisMon`~`thisSun` / `nextMon`~`nextSun` 이 나온다.
"이번 주 금요일", "다음 주 화", "담주 말" 같은 상대 날짜는 이 값을 기준으로 절대 날짜로 바꾼다.

### 3. 원문을 파싱한다

아래 스키마 그대로 JSON 을 만든다.

```json
{
  "activities": [{ "slug": "...", "name": "...", "org": "...", "status": "진행중",
                   "start_date": "2026-09-18", "end_date": null, "cadence": "...",
                   "channels": ["인스타그램"], "completion": "...", "reward": "..." }],
  "items": [{ "activity_slug": "...", "title": "...", "kind": "마감",
              "due_at": "2026-09-18T10:00:00+09:00", "due_end": null, "all_day": false,
              "stage": "기획", "required": true, "memo": "...", "conflict_why": null }],
  "notes": ["사람이 확인해야 할 애매한 부분"]
}
```

**규칙 (CLI 의 `src/prompt.mjs` 와 동일해야 한다)**

1. 기존 활동 목록에 있으면 그 slug 를 그대로 재사용하고 `activities` 에는 넣지 않는다.
2. 새 활동일 때만 `activities` 에 추가한다. slug 는 영소문자 + 하이픈.
3. 시각이 없는 마감은 그날 `23:59:00+09:00`.
4. 기간형 일정은 `all_day: true` + `due_at`(시작) + `due_end`(종료).
5. 주차별 반복 일정표("W1 9/14–9/20, W2 9/21–9/27 …")는 **각 주차를 개별 item 으로 전개**한다.
6. 원문에 없는 날짜·조건을 지어내지 않는다. 불확실하면 `due_at: null` + `notes` 에 기록.
7. **고정 주간 일정**(수업 / 근로 / 알바)과 겹치면 `conflict_why` 에 한 줄로 적는다.
   고정 일정은 `public/schedule.json` 이 원본이고, 아래 명령으로 확인한다:
   ```bash
   node -e "import('./src/schedule.mjs').then(m=>console.log(m.scheduleText()))"
   ```
   (비워둬도 CLI 가 `schedule.json` 을 보고 자동으로 채운다. 원문에 다른 충돌 사유가
   있으면 그걸 우선 적는다.) 피하기 어려운 순서는 알바 > 수업 > 근로.
8. `kind`: 마감 | 회의 | 제출 | 업로드 | 안내 | 행사
9. `stage`: 기획 | 제작 | 시안제출 | 피드백대기 | 업로드 | 완료 (모르면 "기획")
10. `status`: 진행중 | 시작예정 | 검토중 | 종료
11. `title` 에 활동명을 반복하지 않는다. "OT 참석", "1주차 콘텐츠 업로드" 처럼 할 일만 쓴다.
12. 일정이 없으면 `items: []` + `notes` 에 이유. 빈 결과도 유효하다.

### 4. 임시 파일로 쓰고 저장한다

JSON 을 임시 파일에 쓴 뒤:

```bash
node bin/zun.mjs save /tmp/zun-parsed.json
```

- 미리보기 표가 뜨고 `[Enter] 저장 [q] 취소` 를 묻는다.
- 사용자가 이미 "저장해줘" 라고 명확히 말했다면 `--yes` 를 붙여 확인을 건너뛴다.
- 중복(같은 활동 + 같은 날짜 + 비슷한 제목)은 CLI 가 감지해서 건너뛴다.
- 저장 후 임시 파일은 지운다.

### 5. 결과를 사용자에게 알린다

몇 건이 저장됐는지, 건너뛴 게 있는지, `notes` 에 담긴 **확인이 필요한 항목**을 짚어준다.
날짜가 `null` 인 항목이 있으면 운영진에게 무엇을 물어봐야 하는지 알려준다.

## 주의

- `.env` 의 `SUPABASE_SERVICE_ROLE_KEY` 가 있어야 저장된다. 없으면 CLI 가 안내 메시지를 낸다.
- `sp_` 접두사 테이블만 쓴다. 같은 Supabase 프로젝트에 있는 `items` 등 다른 앱 테이블은 건드리지 않는다.
- 스키마를 새로 만들거나 마이그레이션하지 않는다. 이미 적용돼 있다.
