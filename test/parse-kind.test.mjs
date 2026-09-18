// 종류·필수·제목 정리. 종류에 따라 아이폰 알림 시점이 갈리므로 정확해야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessKind, looksRequired, fallbackParse } from '../public/lib/parse-rules.mjs';

const NOW = new Date('2026-09-17T12:00:00+09:00');
const one = (t) => fallbackParse(t, { now: NOW }).items[0];

test('종류 — 행사', () => {
  for (const t of ['2차 오리엔테이션', 'OT 참석', '발대식', '수료식', 'MT 공지', '워크숍 진행'])
    assert.equal(guessKind(t), '행사', t);
});

test('종류 — 회의', () => {
  for (const t of ['팀 회의', '줌 미팅', '멘토링 세션', '1회차 코칭 프로그램', '특강 수강'])
    assert.equal(guessKind(t), '회의', t);
});

test('종류 — 업로드', () => {
  for (const t of ['인증샷 업로드', '릴스 게시', '블로그 포스팅', '3편 발행'])
    assert.equal(guessKind(t), '업로드', t);
});

test('종류 — 제출', () => {
  for (const t of ['2주차 미션 제출', '시안 제출', '원고 넘기기 제출', '보고서'])
    assert.equal(guessKind(t), '제출', t);
});

test('종류 — 안내', () => {
  for (const t of ['4주차 미션 공지 확인', '결과 발표', '신청 페이지 오픈'])
    assert.equal(guessKind(t), '안내', t);
});

test('종류 — 마감', () => {
  for (const t of ['10월 8일까지', '최종 마감', '지원서 접수', '2기 모집'])
    assert.equal(guessKind(t), '마감', t);
});

test('아무것도 안 걸리면 시각 유무로 가른다', () => {
  assert.equal(guessKind('그냥 무언가', true), '회의');
  assert.equal(guessKind('그냥 무언가', false), '마감');
});

test("'미션' 만으로는 제출이 아니다 — 미션 공지는 안내다", () => {
  assert.equal(guessKind('4주차 미션 공지 확인'), '안내');
  assert.equal(guessKind('4주차 미션 제출'), '제출');
});

test('필수는 그렇게 적혀 있을 때만', () => {
  assert.ok(looksRequired('2주차 미션 제출 필수'));
  assert.ok(looksRequired('반드시 참석'));
  assert.ok(!looksRequired('2주차 미션 제출'));
  assert.equal(one('10월 8일까지 2주차 미션 제출 필수').required, true);
  assert.equal(one('10월 8일까지 2주차 미션 제출').required, false,
    '전부 필수로 두면 배지가 아무 말도 못 한다');
});

test('제목 정리 — 말머리·요일 괄호·목록 기호를 걷어낸다', () => {
  assert.equal(one('[공지] 10/2(금) 오후 3시 2차 오리엔테이션 진행합니다').title, '2차 오리엔테이션');
  assert.equal(one('- 10/9 왓잡 4주차 미션 공지 확인').title, '왓잡 4주차 미션 공지 확인');
  assert.equal(one('【필독】 10/5 서류 제출').title, '서류 제출');
});

test('제목 정리 — 존댓말 꼬리와 필수 표시를 뺀다', () => {
  assert.equal(one('11/1 발대식 참석 바랍니다').title, '발대식 참석');
  assert.equal(one('내일까지 원고 제출해주세요').title, '원고 제출');
  assert.equal(one('10월 8일까지 2주차 미션 제출 필수').title, '2주차 미션 제출');
});

test('시각이 붙은 줄은 시각까지 제대로 읽는다', () => {
  const it = one('10/2(금) 오후 3시 2차 오리엔테이션');
  assert.equal(it.due_at.slice(0, 16), '2026-10-02T15:00');
  assert.equal(it.kind, '행사');
});
