import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  seoulYMD, seoulHM, seoulDow, addDays, dday, ddayLabel,
  kstISO, mondayOf, weekContext, endOfMonth, toMin, toHM,
} from '../public/lib/dates.mjs';

// UTC 기준으로 돌려도 KST 날짜가 밀리지 않아야 한다 (가장 흔한 버그)
test('KST 경계 — UTC 15:00 은 이미 다음 날 서울', () => {
  assert.equal(seoulYMD(new Date('2026-09-17T15:00:00Z')), '2026-09-18');
  assert.equal(seoulYMD(new Date('2026-09-17T14:59:00Z')), '2026-09-17');
});

test('seoulHM / seoulDow', () => {
  assert.equal(seoulHM('2026-09-18T10:00:00+09:00'), '10:00');
  assert.equal(seoulDow('2026-09-18T10:00:00+09:00'), '금');
  assert.equal(seoulDow('2026-09-20T10:00:00+09:00'), '일');
});

test('addDays — 달·해 넘김', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29'); // 윤년
});

test('dday — 오늘 0, 내일 1, 어제 -1', () => {
  const now = new Date('2026-09-17T12:00:00+09:00');
  assert.equal(dday('2026-09-17T23:59:00+09:00', now), 0);
  assert.equal(dday('2026-09-18T00:01:00+09:00', now), 1);
  assert.equal(dday('2026-09-16T23:00:00+09:00', now), -1);
  assert.equal(dday(null, now), null);
});

test('ddayLabel', () => {
  const now = new Date('2026-09-17T12:00:00+09:00');
  assert.equal(ddayLabel('2026-09-17T23:59:00+09:00', now), 'D-DAY');
  assert.equal(ddayLabel('2026-09-20T23:59:00+09:00', now), 'D-3');
  assert.equal(ddayLabel('2026-09-14T23:59:00+09:00', now), 'D+3');
  assert.equal(ddayLabel(null, now), '미정');
});

test('kstISO — 시각 없으면 그날 23:59', () => {
  assert.equal(kstISO('2026-10-15'), '2026-10-15T23:59:00+09:00');
  assert.equal(kstISO('2026-10-15', '18:00'), '2026-10-15T18:00:00+09:00');
  // 조립한 문자열이 실제로 그 시각으로 읽혀야 한다
  assert.equal(seoulYMD(kstISO('2026-10-15')), '2026-10-15');
  assert.equal(seoulHM(kstISO('2026-10-15')), '23:59');
});

test('mondayOf — 일요일은 지난 월요일로', () => {
  assert.equal(mondayOf('2026-09-17'), '2026-09-14'); // 목
  assert.equal(mondayOf('2026-09-14'), '2026-09-14'); // 월
  assert.equal(mondayOf('2026-09-20'), '2026-09-14'); // 일
  assert.equal(mondayOf('2026-09-21'), '2026-09-21'); // 다음 월
});

test('weekContext', () => {
  const wk = weekContext(new Date('2026-09-17T09:00:00+09:00'));
  assert.deepEqual(wk, {
    today: '2026-09-17', dow: '목',
    thisMon: '2026-09-14', thisSun: '2026-09-20',
    nextMon: '2026-09-21', nextSun: '2026-09-27',
  });
});

test('endOfMonth', () => {
  assert.equal(endOfMonth('2026-09-17'), '2026-09-30');
  assert.equal(endOfMonth('2026-02-10'), '2026-02-28');
  assert.equal(endOfMonth('2028-02-10'), '2028-02-29');
  assert.equal(endOfMonth('2026-12-01'), '2026-12-31');
});

test('toMin / toHM 왕복', () => {
  assert.equal(toMin('18:30'), 1110);
  assert.equal(toHM(1110), '18:30');
  assert.equal(toHM(toMin('09:05')), '09:05');
});
