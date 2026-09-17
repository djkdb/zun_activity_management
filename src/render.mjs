// 터미널 렌더링 + Asia/Seoul 날짜 유틸. 외부 의존성 없음.

const SEOUL = 'Asia/Seoul';
const useColor = process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb';
const E = (n) => (useColor ? `\x1b[${n}m` : '');

export const A = {
  reset: E(0), bold: E(1), dim: E(2), underline: E(4),
  red: E(31), green: E(32), yellow: E(33), blue: E(34),
  magenta: E(35), cyan: E(36), gray: E(90),
};

/** #RRGGBB → 24bit ANSI 전경색 */
export function hex(c) {
  if (!useColor || !/^#?[0-9a-f]{6}$/i.test(c || '')) return '';
  const h = c.replace('#', '');
  return `\x1b[38;2;${parseInt(h.slice(0, 2), 16)};${parseInt(h.slice(2, 4), 16)};${parseInt(h.slice(4, 6), 16)}m`;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const strip = (s) => String(s ?? '').replace(ANSI_RE, '');

/** 한글·CJK·이모지는 폭 2로 계산 (표 정렬용) */
export function width(s) {
  let n = 0;
  for (const ch of strip(s)) {
    const c = ch.codePointAt(0);
    const wide =
      (c >= 0x1100 && c <= 0x115f) || c === 0x2329 || c === 0x232a ||
      (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) ||
      (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff);
    n += wide ? 2 : 1;
  }
  return n;
}

export function truncate(s, max) {
  s = String(s ?? '');
  if (width(s) <= max) return s;
  let out = '', n = 0;
  for (const ch of strip(s)) {
    const cw = width(ch);
    if (n + cw > max - 1) break;
    out += ch; n += cw;
  }
  return out + '…';
}

export const pad = (s, n) => String(s ?? '') + ' '.repeat(Math.max(0, n - width(s)));
export const padStart = (s, n) => ' '.repeat(Math.max(0, n - width(s))) + String(s ?? '');

/** 헤더 + 행 배열을 정렬된 표로. align: 'l'|'r' 배열. */
export function table(headers, rows, align = []) {
  const cols = headers.length;
  const w = headers.map((h, i) =>
    Math.max(width(h), ...rows.map((r) => width(r[i] ?? ''))));
  const line = (cells) =>
    cells.map((c, i) => (align[i] === 'r' ? padStart(c, w[i]) : pad(c, w[i])))
      .join('  ').trimEnd();
  const out = [A.bold + line(headers) + A.reset,
    A.gray + w.map((n) => '─'.repeat(n)).join('  ') + A.reset];
  for (const r of rows) out.push(line(Array.from({ length: cols }, (_, i) => r[i] ?? '')));
  return out.join('\n');
}

// ── 날짜 ──────────────────────────────────────────────────────────
// 실제 구현은 core/dates.mjs 에 있다. 여기서는 표시용으로 다시 내보내기만 한다.
export { seoulYMD, seoulHM, seoulDow, dday, ddayLabel } from './core/dates.mjs';
import { seoulYMD as _ymd, seoulHM as _hm, seoulDow as _dow } from './core/dates.mjs';

/** "9/18(금) 10:00" — all_day 면 시각 생략 */
export function fmtDue(due, allDay = false) {
  if (!due) return '미정';
  const [, m, d] = _ymd(due).split('-');
  const base = `${Number(m)}/${Number(d)}(${_dow(due)})`;
  return allDay ? base : `${base} ${_hm(due)}`;
}

export const ok = (s) => `${A.green}✓${A.reset} ${s}`;
export const warn = (s) => `${A.yellow}!${A.reset} ${s}`;
export const err = (s) => `${A.red}✗${A.reset} ${s}`;
