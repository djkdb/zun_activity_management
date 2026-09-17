// 시간 그리드 배치. 캘린더 앱들이 쓰는 방식 그대로 —
// 겹치지 않으면 칸 전체를 쓰고, 겹치는 것끼리만 폭을 나눠 갖는다.
// 순수 함수라 테스트할 수 있다.

/**
 * @param {Array<{start:number,end:number}>} blocks  분 단위 (09:00 = 540)
 * @returns 같은 순서로 { col, cols } — col 번째 칸을 cols 개 중 하나로 쓴다
 */
export function packColumns(blocks) {
  const n = blocks.length;
  const out = new Array(n).fill(null).map(() => ({ col: 0, cols: 1 }));
  if (!n) return out;

  // 시작 순, 같으면 긴 것 먼저 (긴 블록이 왼쪽에 오는 편이 읽기 좋다)
  const order = blocks.map((b, i) => i)
    .sort((a, b) => blocks[a].start - blocks[b].start
      || (blocks[b].end - blocks[b].start) - (blocks[a].end - blocks[a].start));

  let cluster = [];          // 현재 서로 겹치는 덩어리
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    const cols = Math.max(...cluster.map((i) => out[i].col)) + 1;
    for (const i of cluster) out[i].cols = cols;   // 덩어리 전체가 같은 분모를 쓴다
    cluster = [];
    clusterEnd = -Infinity;
  };

  const colEnds = [];        // 각 칸이 언제 비는지
  for (const i of order) {
    const b = blocks[i];
    if (b.start >= clusterEnd) { flush(); colEnds.length = 0; }

    let col = colEnds.findIndex((end) => end <= b.start);
    if (col === -1) { col = colEnds.length; colEnds.push(b.end); }
    else colEnds[col] = b.end;

    out[i].col = col;
    cluster.push(i);
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  flush();
  return out;
}
