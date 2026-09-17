// 파싱 프롬프트 템플릿. 오늘 날짜(Asia/Seoul)와 기존 활동 목록을 반드시 주입한다.
import { weekContext } from './core/dates.mjs';
import { scheduleText } from './schedule.mjs';

export { addDays, weekContext } from './core/dates.mjs';

const SCHEMA = `{
  "activities": [{ "slug": "...", "name": "...", "org": "...", "status": "진행중",
                   "start_date": "2026-09-18", "end_date": null, "cadence": "...",
                   "channels": ["인스타그램"], "completion": "...", "reward": "..." }],
  "items": [{ "activity_slug": "...", "title": "...", "kind": "마감",
              "due_at": "2026-09-18T10:00:00+09:00", "due_end": null, "all_day": false,
              "stage": "기획", "required": true, "memo": "...", "conflict_why": null }],
  "notes": ["사람이 확인해야 할 애매한 부분"]
}`;

export function buildPrompt({ rawText, activities = [], activityHint = null, now = new Date() }) {
  const wk = weekContext(now);
  const sched = `## 고정 주간 일정 (매주 반복 — 이 시간에는 다른 일정을 잡기 어렵다)\n${scheduleText()}`;

  const known = activities.length
    ? activities.map((a) =>
        `- ${a.slug} | ${a.name}${a.org ? ` (${a.org})` : ''} | 상태:${a.status}` +
        `${a.cadence ? ` | 주기:${a.cadence}` : ''}`).join('\n')
    : '(등록된 활동 없음)';

  const hint = activityHint
    ? `\n## 활동 힌트\n사용자가 이 원문이 "${activityHint}" 활동의 것이라고 알려줬다. ` +
      `특별한 근거가 없으면 모든 item 의 activity_slug 를 "${activityHint}" 로 둬라.\n`
    : '';

  return `너는 대학생의 서포터즈·대외활동 일정 파서다. 운영진이 보낸 정제되지 않은 안내문(카톡 공지, 가이드북, 노션 붙여넣기 등)을 읽고 일정 데이터로 변환한다.

## 오늘 (Asia/Seoul)
- 오늘: ${wk.today} (${wk.dow})
- 이번 주: ${wk.thisMon}(월) ~ ${wk.thisSun}(일)
- 다음 주: ${wk.nextMon}(월) ~ ${wk.nextSun}(일)
모든 상대 날짜("이번 주 금요일", "다음 주 화", "내일", "담주 말")는 위 기준으로 절대 날짜로 변환한다.

## 이미 등록된 활동 (이 목록에 있으면 반드시 이 slug 를 재사용)
${known}
${hint}
## 출력 형식
오직 하나의 \`\`\`json 코드블록만 출력한다. 코드블록 앞뒤에 설명 문장을 쓰지 마라.

\`\`\`json
${SCHEMA}
\`\`\`

## 규칙
1. 위 "이미 등록된 활동" 목록에 해당하는 활동이 있으면 반드시 그 slug 를 그대로 재사용한다. \`activities\` 배열에는 넣지 않는다.
2. 원문이 명백히 새로운 활동일 때만 \`activities\` 에 추가한다. slug 는 영소문자와 하이픈만 사용한다 (예: "code-it", "naver-ai").
3. 시각이 명시되지 않은 마감은 그날 23:59, 즉 \`"YYYY-MM-DDT23:59:00+09:00"\` 으로 둔다.
4. 기간형 일정(예: "9/14~9/20 콘텐츠 주간")은 \`all_day: true\` 로 두고 \`due_at\` 에 시작일, \`due_end\` 에 종료일을 넣는다.
5. 주차별 반복 일정표(예: "W1 9/14–9/20, W2 9/21–9/27 …")가 나오면 각 주차를 **개별 item 으로 전개**한다. 하나로 묶지 마라.
6. 원문에 없는 날짜·조건을 지어내지 마라. 날짜가 불확실하면 \`due_at\` 을 \`null\` 로 두고 \`notes\` 에 무엇이 불확실한지 적는다.
7. 아래 **고정 주간 일정**과 겹치는 일정에는 \`conflict_why\` 에 이유를 한 줄로 적는다 (예: "목 19:00 회의 — 배달전문점 알바와 겹침"). 겹치지 않으면 \`null\`. 알바 > 수업 > 근로 순으로 피하기 어려운 제약이다.

${sched}

8. \`kind\` 는 마감 | 회의 | 제출 | 업로드 | 안내 | 행사 중 하나.
9. \`stage\` 는 기획 | 제작 | 시안제출 | 피드백대기 | 업로드 | 완료 중 하나. 판단이 어려우면 "기획".
10. \`status\` 는 진행중 | 시작예정 | 검토중 | 종료 중 하나.
11. \`required\` 는 수료·필수 요건이면 true, 선택 참여면 false.
12. \`title\` 은 활동명을 반복하지 말고 무엇을 하는지만 짧게 쓴다 (예: "OT 참석", "1주차 콘텐츠 업로드").
13. 일정이 하나도 없으면 \`items\` 를 빈 배열로 두고 \`notes\` 에 이유를 적는다. 빈 결과도 유효하다.

## 원문
<<<RAW
${rawText}
RAW`;
}
