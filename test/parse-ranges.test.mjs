import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackParse, parseTimeRange, parseRecurrence, segment, matchActivity }
  from '../public/lib/parse-rules.mjs';
import { seoulYMD, seoulHM } from '../public/lib/dates.mjs';

const NOW = new Date('2026-09-17T12:00:00+09:00');            // 목
const ACTS = [
  { slug: 'naver',  name: '네이버 AI 디깅클럽 1기' },
  { slug: 'teazr',  name: 'Teazr 마케팅 서포터즈 1기' },
  { slug: 'whatjob', name: '왓잡 서포터즈 2기' },
];
const one = (t, o = {}) => fallbackParse(t, { now: NOW, ...o }).items[0];

test('날짜 범위 — 9/14~9/20', () => {
  const it = one('9/14~9/20 콘텐츠 주간');
  assert.equal(seoulYMD(it.due_at), '2026-09-14');
  assert.equal(seoulYMD(it.due_end), '2026-09-20');
  assert.equal(it.all_day, true);
  assert.equal(it.title, '콘텐츠 주간');
});

test('날짜 범위 — 부터/까지', () => {
  const it = one('10월 1일부터 10월 5일까지 자료조사');
  assert.equal(seoulYMD(it.due_at), '2026-10-01');
  assert.equal(seoulYMD(it.due_end), '2026-10-05');
  assert.equal(it.title, '자료조사');
});

test('시각 범위 — 오후 2시~5시 는 14~17', () => {
  const it = one('10월 3일 오후 2시~5시 발표회');
  assert.equal(seoulHM(it.due_at), '14:00');
  assert.equal(seoulHM(it.due_end), '17:00');
  assert.equal(seoulYMD(it.due_end), '2026-10-03');
});

test('시각 범위 — 24시간 표기', () => {
  const it = one('내일 18:00~20:00 스터디');
  assert.equal(seoulHM(it.due_at), '18:00');
  assert.equal(seoulHM(it.due_end), '20:00');
  assert.deepEqual(parseTimeRange('18:00~20:00'), ['18:00', '20:00']);
  assert.equal(parseTimeRange('그냥 문장'), null);
});

test('한 줄에 마감이 둘이면 둘로 나눈다', () => {
  const r = fallbackParse('9월 28일까지 아이디어 정리하고 10월 5일까지 분석 완료', { now: NOW });
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items.map((i) => i.title), ['아이디어 정리', '분석 완료']);
  assert.equal(seoulYMD(r.items[0].due_at), '2026-09-28');
  assert.equal(seoulYMD(r.items[1].due_at), '2026-10-05');
});

test('범위는 나누지 않는다 (날짜 2개지만 1건)', () => {
  assert.equal(fallbackParse('10월 1일부터 10월 5일까지 자료조사', { now: NOW }).items.length, 1);
  assert.equal(segment('9/14~9/20 콘텐츠 주간').length, 1);
  assert.equal(segment('9월 28일까지 정리하고 10월 5일까지 분석').length, 2);
});

test('매주 반복 — 주 수만큼 펼치고 notes 로 알린다', () => {
  const r = fallbackParse('매주 화요일 팀 회의', { now: NOW, weeks: 4 });
  assert.equal(r.items.length, 4);
  assert.deepEqual(r.items.map((i) => seoulYMD(i.due_at)),
    ['2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13']);
  assert.ok(r.items.every((i) => i.title === '팀 회의'));
  assert.ok(r.notes.some((n) => /매주 화요일 반복/.test(n)));
  assert.equal(parseRecurrence('매주 화요일'), '화');
  assert.equal(parseRecurrence('다음주 화요일'), null);
});

test('활동명을 알아본다', () => {
  assert.equal(matchActivity('네이버 미션 제출', ACTS), 'naver');
  assert.equal(matchActivity('왓잡 서포터즈 3주차', ACTS), 'whatjob');
  assert.equal(matchActivity('Teazr W1 업로드', ACTS), 'teazr');
  assert.equal(matchActivity('그냥 공모전', ACTS), null);
  assert.equal(one('네이버 미션 10월 5일까지', { activities: ACTS }).activity_slug, 'naver');
});

test('명시한 활동이 자동 매칭보다 우선', () => {
  assert.equal(one('네이버 미션 10월 5일까지',
    { activities: ACTS, activitySlug: 'teazr' }).activity_slug, 'teazr');
});

test('제목에서 조사·연결어미가 빠진다', () => {
  assert.equal(one('다음주 금요일 6시에 축구').title, '축구');
  assert.equal(one('10월 15일까지 BC카드 공모전 제출해야 함').title, 'BC카드 공모전 제출');
  assert.equal(one('매주 화요일 팀 회의').title, '팀 회의');
});

test('날짜가 없으면 아무것도 만들지 않는다', () => {
  const r = fallbackParse('포트폴리오 업데이트 해야 함', { now: NOW });
  assert.equal(r.items.length, 0);
});
