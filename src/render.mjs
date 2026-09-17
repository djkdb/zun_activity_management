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

// ── 날짜 ──────────────────────────────────────────────────────────────
const ymdFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: SEOUL, year: 'numeric', month: '2-digit', day: '2-digit',
});
const hmFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: SEOUL, hour: '2-digit', minute: '2-digit', hour12: false,
});
const dowFmt = new Intl.DateTimeFormat('ko-KR', { timeZone: SEOUL, weekday: 'short' });

/** Asia/Seoul 기준 YYYY-MM-DD */
export const seoulYMD = (d = new Date()) => ymdFmt.format(d instanceof Date ? d : new Date(d));
/** Asia/Seoul 기준 HH:MM */
export const seoulHM = (d) => hmFmt.format(d instanceof Date ? d : new Date(d));
/** Asia/Seoul 기준 요일 (월~일) */
export const seoulDow = (d) => dowFmt.format(d instanceof Date ? d : new Date(d)).replace(/요일$/, '');

const ymdToUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };

/** 오늘(Seoul) 기준 D-day. 오늘=0, 내일=1 */
export function dday(due, now = new Date()) {
  if (!due) return null;
  return Math.round((ymdToUTC(seoulYMD(due)) - ymdToUTC(seoulYMD(now))) / 86400000);
}

export function ddayLabel(due, now = new Date()) {
  const d = dday(due, now);
  if (d === null) return '미정';
  if (d === 0) return 'D-DAY';
  return d > 0 ? `D-${d}` : `D+${-d}`;
}

/** "9/18(금) 10:00" — all_day면 시각 생략 */
export function fmtDue(due, allDay = false) {
  if (!due) return '미정';
  const [, m, d] = seoulYMD(due).split('-');
  const base = `${Number(m)}/${Number(d)}(${seoulDow(due)})`;
  return allDay ? base : `${base} ${seoulHM(due)}`;
}

export const ok = (s) => `${A.green}✓${A.reset} ${s}`;
export const warn = (s) => `${A.yellow}!${A.reset} ${s}`;
export const err = (s) => `${A.red}✗${A.reset} ${s}`;
