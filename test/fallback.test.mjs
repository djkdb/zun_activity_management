import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, fallbackParse, looksLikeDeadline } from '../public/lib/parse-rules.mjs';
import { seoulYMD, seoulHM } from '../public/lib/dates.mjs';

const NOW = new Date('2026-09-17T12:00:00+09:00'); // 목요일

test('절대 날짜', () => {
  assert.equal(parseDate('10월 15일까지 제출', NOW), '2026-10-15');
  assert.equal(parseDate('10/15 마감', NOW), '2026-10-15');
  assert.equal(parseDate('2026-10-15 마감', NOW), '2026-10-15');
});

test('상대 날짜', () => {
  assert.equal(parseDate('오늘 안에', NOW), '2026-09-17');
  assert.equal(parseDate('내일 오후 3시', NOW), '2026-09-18');
  assert.equal(parseDate('모레까지', NOW), '2026-09-19');
  assert.equal(parseDate('다음주 금요일', NOW), '2026-09-25');
  assert.equal(parseDate('이번 주 금요일', NOW), '2026-09-18');
  assert.equal(parseDate('이번 주말', NOW), '2026-09-19');
  assert.equal(parseDate('이번 달 말까지', NOW), '2026-09-30');
});

test('지난 달짜는 내년으로 본다', () => {
  assert.equal(parseDate('1월 5일 발표', NOW), '2027-01-05');
  assert.equal(parseDate('9월 30일', NOW), '2026-09-30'); // 이번 달은 그대로
});

test('없으면 null — 날짜를 지어내지 않는다', () => {
  assert.equal(parseDate('포트폴리오 업데이트 해야 함', NOW), null);
  assert.equal(parseDate('', NOW), null);
});

test('시각 — 오전/오후/맨숫자', () => {
  const one = (t) => fallbackParse(t, { now: NOW }).items[0];
  assert.equal(seoulHM(one('내일 오후 3시 회의').due_at), '15:00');
  assert.equal(seoulHM(one('내일 오전 9시 회의').due_at), '09:00');
  assert.equal(seoulHM(one('내일 밤 11시 마감').due_at), '23:00');
  assert.equal(seoulHM(one('다음주 금요일 6시에 축구').due_at), '18:00'); // 맨숫자 6시는 저녁
  assert.equal(seoulHM(one('10월 15일까지 제출').due_at), '23:59');       // 시각 없으면 23:59
});

test('여러 문장을 각각 뽑는다', () => {
  const r = fallbackParse(
    '9월 28일까지 공모전 아이디어 정리하고\n10월 5일까지 분석 완료', { now: NOW });
  assert.equal(r.items.length, 2);
  assert.equal(seoulYMD(r.items[0].due_at), '2026-09-28');
  assert.equal(seoulYMD(r.items[1].due_at), '2026-10-05');
  assert.match(r.items[0].title, /아이디어/);
});

test('제목에서 날짜·시각 표현이 빠진다', () => {
  const r = fallbackParse('10월 15일까지 BC카드 공모전 제출해야 함', { now: NOW });
  assert.match(r.items[0].title, /BC카드 공모전/);
  assert.doesNotMatch(r.items[0].title, /10월|15일/);
});

test('마감 표현 판별', () => {
  assert.ok(looksLikeDeadline('10월 15일까지 제출'));
  assert.ok(looksLikeDeadline('공모전 마감'));
  assert.ok(!looksLikeDeadline('금요일에 축구'));
});

test('활동 힌트가 붙는다 / notes 에 경고가 남는다', () => {
  const r = fallbackParse('내일 3시 회의', { activitySlug: 'teazr', now: NOW });
  assert.equal(r.items[0].activity_slug, 'teazr');
  assert.match(r.notes[0], /규칙 기반/);
});
