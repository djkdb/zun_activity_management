import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, fold, itemEvent, fixedEvent, buildCalendar, defaultAlarms } from '../public/lib/ics.mjs';

const NOW = new Date('2026-09-17T12:00:00+09:00');
const ACT = { id: 'a1', name: 'BC카드 공모전', color: '#007EEC' };
const ITEM = {
  id: 'i1', activity_id: 'a1', title: '공모전 제출', kind: '마감',
  due_at: '2026-10-15T23:59:00+09:00', due_end: null, all_day: false,
  required: true, done: false, conflict: false, conflict_why: null, memo: null,
};

test('이스케이프 — 역슬래시를 먼저', () => {
  assert.equal(esc('a;b,c'), 'a\;b\\,c');
  assert.equal(esc('a\\b'), 'a\\\\b');
  assert.equal(esc('두\n줄'), '두\\n줄');
  assert.equal(esc('C:\\경로; 메모'), 'C:\\\\경로\; 메모');
});

test('줄 접기 — 75옥텟, 한글이 깨지지 않는다', () => {
  const long = 'SUMMARY:' + '가'.repeat(60);           // 한글 1자 = 3바이트
  const folded = fold(long);
  const rows = folded.split('\r\n');
  assert.ok(rows.length > 1, '접혀야 한다');
  for (const r of rows) assert.ok(Buffer.from(r, 'utf8').length <= 75, `${Buffer.from(r).length}옥텟`);
  for (const r of rows.slice(1)) assert.ok(r.startsWith(' '), '이어지는 줄은 공백으로 시작');
  // 언폴딩하면 원문 그대로 — 글자가 깨지지 않았다는 뜻
  assert.equal(rows.map((r, i) => (i ? r.slice(1) : r)).join(''), long);
  assert.ok(!folded.includes('\uFFFD'), '깨진 문자 없음');
});

test('짧은 줄은 안 접는다', () => {
  assert.equal(fold('SUMMARY:회의'), 'SUMMARY:회의');
});

test('VEVENT — 시각 있는 마감', () => {
  const ev = itemEvent(ITEM, ACT, { now: NOW }).join('\r\n');
  assert.match(ev, /UID:item-i1@zun\.board/);
  assert.match(ev, /DTSTART:20261015T145900Z/);        // 23:59 KST = 14:59 UTC
  assert.match(ev, /SUMMARY:공모전 제출 · BC카드 공모전/);
  assert.match(ev, /STATUS:CONFIRMED/);
  assert.match(ev, /CATEGORIES:마감/);
});

test('마감에는 D-7/D-3/D-1 알람이 붙는다', () => {
  const ev = itemEvent(ITEM, ACT, { now: NOW }).join('\r\n');
  assert.match(ev, /TRIGGER:-P7D/);
  assert.match(ev, /TRIGGER:-P3D/);
  assert.match(ev, /TRIGGER:-P1D/);
  assert.equal((ev.match(/BEGIN:VALARM/g) || []).length, 3);
  assert.deepEqual(defaultAlarms('회의'), ['-PT1H']);
  assert.deepEqual(defaultAlarms('안내'), []);
});

test('완료된 항목엔 알람을 달지 않는다', () => {
  const ev = itemEvent({ ...ITEM, done: true }, ACT, { now: NOW }).join('\r\n');
  assert.match(ev, /STATUS:COMPLETED/);
  assert.match(ev, /SUMMARY:✓ /);
  assert.ok(!ev.includes('BEGIN:VALARM'));
});

test('종일 항목 — DTEND 는 하루 뒤(배타적)', () => {
  // 실제 DB 의 종일 항목은 UTC 오프셋으로 저장된다: 09-20T15:00Z = KST 09-21 00:00
  const ev = itemEvent({ ...ITEM, all_day: true, due_at: '2026-09-20T15:00:00+00:00',
    due_end: '2026-09-23T14:59:00+00:00' }, ACT, { now: NOW }).join('\r\n');
  assert.match(ev, /DTSTART;VALUE=DATE:20260921/);
  assert.match(ev, /DTEND;VALUE=DATE:20260924/);
});

test('due_at 없으면 이벤트를 만들지 않는다', () => {
  assert.equal(itemEvent({ ...ITEM, due_at: null }, ACT, { now: NOW }), null);
});

test('고정 일정 — 매주 반복', () => {
  const ev = fixedEvent(
    { day: '목', start: '16:00', end: '18:00', kind: '수업', label: '머신러닝', detail: '이건명 · S4-1-106' },
    { from: '2026-09-14', count: 16, now: NOW }).join('\r\n');
  assert.match(ev, /RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=16/);
  assert.match(ev, /DTSTART:20260917T070000Z/);        // 목 16:00 KST = 07:00 UTC
  assert.match(ev, /LOCATION:S4-1-106/);
});

test('UID 는 안정적 — 두 번 만들어도 같다 (아이폰 중복 방지)', () => {
  const a = buildCalendar({ items: [ITEM], activities: [ACT], now: NOW });
  const b = buildCalendar({ items: [ITEM], activities: [ACT], now: new Date('2026-09-18T00:00:00+09:00') });
  const uids = (s) => s.match(/UID:[^\r\n]+/g);
  assert.deepEqual(uids(a), uids(b));
});

test('전체 캘린더 골격', () => {
  const ics = buildCalendar({ items: [ITEM], activities: [ACT], name: 'zun', now: NOW });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.match(ics, /X-WR-TIMEZONE:Asia\/Seoul/);
  assert.match(ics, /REFRESH-INTERVAL;VALUE=DURATION:PT1H/);
  // 모든 줄이 CRLF 이고 75옥텟 이하
  for (const l of ics.split('\r\n')) assert.ok(Buffer.from(l, 'utf8').length <= 75);
  assert.ok(!ics.includes('\n\n'));
});

test('끝 시각이 없으면 종류별 기본 길이를 준다 (길이 0 방지)', () => {
  const meet = itemEvent({ ...ITEM, kind: '회의' }, ACT, { now: NOW }).join('\r\n');
  assert.match(meet, /DTSTART:20261015T145900Z/);
  assert.match(meet, /DTEND:20261015T155900Z/);   // +1시간
  const due = itemEvent(ITEM, ACT, { now: NOW }).join('\r\n');
  assert.match(due, /DTEND:20261015T152900Z/);    // 마감은 +30분
});
