import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packColumns } from '../public/lib/layout.mjs';

const at = (h, m = 0) => h * 60 + m;
const pack = (...pairs) => packColumns(pairs.map(([a, b]) => ({ start: a, end: b })));

test('빈 입력', () => assert.deepEqual(packColumns([]), []));

test('안 겹치면 전부 칸 하나를 다 쓴다', () => {
  const r = pack([at(9), at(10)], [at(10), at(12)], [at(14), at(16)]);
  assert.deepEqual(r, [{ col: 0, cols: 1 }, { col: 0, cols: 1 }, { col: 0, cols: 1 }]);
});

test('둘이 겹치면 반씩', () => {
  const r = pack([at(9), at(11)], [at(10), at(12)]);
  assert.deepEqual(r, [{ col: 0, cols: 2 }, { col: 1, cols: 2 }]);
});

test('셋이 겹치면 1/3씩', () => {
  const r = pack([at(9), at(12)], [at(10), at(12)], [at(11), at(12)]);
  assert.deepEqual(r.map((x) => x.cols), [3, 3, 3]);
  assert.deepEqual(r.map((x) => x.col).sort(), [0, 1, 2]);
});

test('끝난 자리는 다시 쓴다', () => {
  // 9~10 과 10~11 은 안 겹치므로 같은 칸. 9~11 하나가 옆 칸.
  const r = pack([at(9), at(11)], [at(9), at(10)], [at(10), at(11)]);
  assert.equal(r[0].cols, 2);
  assert.equal(r[1].col, r[2].col, '연달아 붙은 둘은 같은 칸을 쓴다');
  assert.notEqual(r[0].col, r[1].col);
});

test('덩어리가 다르면 분모도 다르다', () => {
  // 오전엔 셋이 겹치고, 오후엔 하나뿐
  const r = pack([at(9), at(12)], [at(9), at(12)], [at(9), at(12)], [at(14), at(15)]);
  assert.deepEqual(r.map((x) => x.cols), [3, 3, 3, 1]);
});

test('맞닿은 것은 안 겹친 것으로 본다 (10시 끝 / 10시 시작)', () => {
  const r = pack([at(9), at(10)], [at(10), at(11)]);
  assert.deepEqual(r.map((x) => x.cols), [1, 1]);
});

test('실제 목요일 — 수업 4칸 + 서포터즈 1건', () => {
  // 09~10 수업, 10~12 근로, 14~16 수업, 16~18 수업, 18~21 알바, 19:00 회의(겹침)
  const r = pack(
    [at(9), at(10)], [at(10), at(12)], [at(14), at(16)],
    [at(16), at(18)], [at(18), at(21)], [at(19), at(20)]);
  assert.deepEqual(r.slice(0, 4).map((x) => x.cols), [1, 1, 1, 1], '겹치지 않는 수업은 폭 전체');
  assert.equal(r[4].cols, 2, '알바와 회의가 겹쳐 반씩');
  assert.equal(r[5].cols, 2);
  assert.notEqual(r[4].col, r[5].col);
});
