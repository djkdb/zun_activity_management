// /calendar.ics 의 피드 분리. 아이폰은 캘린더당 색이 하나뿐이라
// 종류별 색을 보려면 이 갈라짐이 정확해야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/calendar.ics.js';

const ACTS = [
  { id: 'a1', slug: 'whatjob', name: '왓잡 서포터즈 2기', color: '#E86A2B' },
  { id: 'a2', slug: 'teazr', name: 'Teazr 마케팅', color: 'not-a-hex' },
];
const ITEMS = [
  { id: 'i1', activity_id: 'a1', title: '3주차 시안', kind: '제출',
    due_at: '2026-09-21T01:00:00Z', all_day: false, done: false },
  { id: 'i2', activity_id: 'a2', title: 'W2 업로드', kind: '마감',
    due_at: '2026-09-27T14:59:00Z', all_day: false, done: false },
];
const SCHEDULE = {
  term_end: null,
  classes: [{ name: '데이터베이스시스템', prof: '강윤석', room: 'S4-1-106', color: '#F5A524',
    slots: [{ day: '화', start: '13:00', end: '15:00' }] }],
  work: [{ label: '근로', color: '#30A46C', slots: [{ day: '화', start: '10:00', end: '12:00' }] }],
  parttime: [{ label: '배달전문점 알바', slots: [{ day: '금', start: '17:00', end: '21:00' }] }],
};

/** Supabase REST 와 정적 자산을 가로채 실제 경로 그대로 돌린다. */
function harness() {
  const real = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const u = String(input?.url ?? input);
    const body = u.includes('sp_activity') ? ACTS : u.includes('sp_item') ? ITEMS : null;
    if (body) return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    throw new Error(`예상 못한 요청: ${u}`);
  };
  return { restore: () => { globalThis.fetch = real; } };
}
const ENV = { ASSETS: { fetch: async () => new Response(JSON.stringify(SCHEDULE)) } };

async function get(qs = '') {
  const h = harness();
  try {
    const res = await onRequestGet({ request: new Request(`https://zm.test/calendar.ics${qs}`), env: ENV });
    return { res, body: await res.text() };
  } finally { h.restore(); }
}
const summaries = (b) => [...b.matchAll(/^SUMMARY:(.*)$/gm)].map((m) => m[1]);

test('기본 피드 — 수업·근로·알바·서포터즈가 모두 들어간다', async () => {
  const { res, body } = await get();
  assert.equal(res.headers.get('X-Zun-Feed'), 'all');
  assert.equal(res.headers.get('X-Zun-Items'), '2');
  assert.equal(res.headers.get('X-Zun-Fixed'), '3');
  assert.match(body, /X-WR-CALNAME:zun/);
  assert.equal(summaries(body).length, 5);
});

test('?only=class — 수업만. 근로·알바·서포터즈는 빠진다', async () => {
  const { res, body } = await get('?only=class');
  assert.equal(res.headers.get('X-Zun-Items'), '0');
  assert.equal(res.headers.get('X-Zun-Fixed'), '1');
  assert.deepEqual(summaries(body), ['🎓 데이터베이스시스템']);
  assert.match(body, /X-APPLE-CALENDAR-COLOR:#3478F6/);
  assert.match(body, /X-WR-CALNAME:zun 수업/);
});

test('?only=work — 근로와 알바만', async () => {
  const { body } = await get('?only=work');
  assert.deepEqual(summaries(body).sort(), ['💼 근로', '🛵 배달전문점 알바']);
  assert.match(body, /X-APPLE-CALENDAR-COLOR:#30A46C/);
});

test('?only=supporters — 서포터즈만. 시간표는 아예 읽지 않는다', async () => {
  let touched = false;
  const env = { ASSETS: { fetch: async () => { touched = true; return new Response('{}'); } } };
  const h = harness();
  try {
    const res = await onRequestGet({ request: new Request('https://zm.test/calendar.ics?only=supporters'), env });
    const body = await res.text();
    assert.equal(res.headers.get('X-Zun-Fixed'), '0');
    assert.equal(summaries(body).length, 2);
    assert.ok(!touched, 'schedule.json 을 헛되이 읽지 않는다');
  } finally { h.restore(); }
});

test('?only=<활동 slug> — 그 활동 것만 남고 색은 활동 색을 쓴다', async () => {
  const { res, body } = await get('?only=whatjob');
  assert.equal(res.headers.get('X-Zun-Items'), '1');
  assert.deepEqual(summaries(body), ['⏰ 3주차 시안 · 왓잡 서포터즈 2기']);
  assert.match(body, /X-APPLE-CALENDAR-COLOR:#E86A2B/);
  assert.match(body, /X-WR-CALNAME:zun 왓잡 서포터즈 2기/);
});

test('활동 색이 hex 가 아니면 기본색으로 떨어진다', async () => {
  const { body } = await get('?only=teazr');
  assert.match(body, /X-APPLE-CALENDAR-COLOR:#F5A524/);
});

test('모르는 only 값은 전체로 되돌린다 — 구독이 빈 채로 남지 않게', async () => {
  const { res, body } = await get('?only=없는거');
  assert.equal(res.headers.get('X-Zun-Items'), '2');
  assert.equal(summaries(body).length, 5);
});

test('only 에 한글이 와도 헤더가 안 터진다 (헤더는 latin-1 만 받는다)', async () => {
  const { res, body } = await get('?only=한글피드');
  assert.equal(res.headers.get('X-Zun-Feed'), 'all');
  assert.ok(!res.headers.get('X-Zun-Error'), '오류 경로로 새지 않는다');
  assert.equal(summaries(body).length, 5);
});

test('활동 피드의 X-Zun-Feed 는 slug 를 담는다', async () => {
  const { res } = await get('?only=whatjob');
  assert.equal(res.headers.get('X-Zun-Feed'), 'act:whatjob');
});

test('?marks=0 이면 표식 없이 원래 제목만', async () => {
  const { body } = await get('?only=class&marks=0');
  assert.deepEqual(summaries(body), ['데이터베이스시스템']);
});

test('DB 가 죽어도 200 + 빈 캘린더 — 아이폰이 구독을 버리지 않게', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('DB 끊김'); };
  try {
    const res = await onRequestGet({ request: new Request('https://zm.test/calendar.ics'), env: ENV });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /BEGIN:VCALENDAR[\s\S]*END:VCALENDAR/);
    assert.equal(res.headers.get('X-Zun-Error'), 'DB ??');   // 한글 2자가 ? 로 바뀌어 나간다
  } finally { globalThis.fetch = real; }
});
