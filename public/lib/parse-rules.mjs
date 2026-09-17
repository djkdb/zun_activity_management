// 규칙 기반 파서. 브라우저(빠른 입력)와 CLI(AI 실패 시 폴백)가 같이 쓴다.
// 원칙: 확신하지 못하는 값은 비워 두고 notes 에 적는다 — 날짜를 지어내지 않는다.
import { seoulYMD, addDays, kstISO, endOfMonth, mondayOf, DOWS } from './dates.mjs';

const DOW_RE = '일|월|화|수|목|금|토';
const RANGE = '~|～|-|–|—|부터';

// ── 시각 ──────────────────────────────────────────────────────────
const clampH = (h) => Math.max(0, Math.min(23, h));

/** '오후 3시' '18:00' '2시 30분' → 'HH:MM' (없으면 null) */
export function parseTime(text) {
  let m = text.match(/(오전|오후|아침|저녁|밤|새벽)?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?/);
  if (m) {
    let h = Number(m[2]);
    const mark = m[1];
    if (mark === '오후' || mark === '저녁' || mark === '밤') { if (h < 12) h += 12; }
    else if (mark === '새벽' || mark === '아침' || mark === '오전') { if (h === 12) h = 0; }
    else if (h <= 7) h += 12;              // "6시에 축구" 는 저녁으로 본다
    return `${String(clampH(h)).padStart(2, '0')}:${String(Number(m[3] ?? 0)).padStart(2, '0')}`;
  }
  m = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  return null;
}

/** '2시~5시' '18:00~20:00' → ['HH:MM','HH:MM'] (없으면 null) */
export function parseTimeRange(text) {
  let m = text.match(new RegExp(`(\\d{1,2}:\\d{2})\\s*(?:${RANGE})\\s*(\\d{1,2}:\\d{2})`));
  if (m) return [m[1].padStart(5, '0'), m[2].padStart(5, '0')];

  m = text.match(new RegExp(`(오전|오후|아침|저녁|밤|새벽)?\\s*(\\d{1,2})\\s*시\\s*(?:${RANGE})\\s*(\\d{1,2})\\s*시`));
  if (m) {
    const mark = m[1];
    const lift = (h) => {
      if (mark === '오후' || mark === '저녁' || mark === '밤') return h < 12 ? h + 12 : h;
      if (mark === '새벽' || mark === '아침' || mark === '오전') return h === 12 ? 0 : h;
      return h <= 7 ? h + 12 : h;
    };
    let a = lift(Number(m[2])), b = lift(Number(m[3]));
    if (b <= a) b = Math.min(23, b + 12);   // '2시~5시' 는 14~17
    return [`${String(clampH(a)).padStart(2, '0')}:00`, `${String(clampH(b)).padStart(2, '0')}:00`];
  }
  return null;
}

// ── 날짜 ──────────────────────────────────────────────────────────
const D_ABS   = String.raw`\d{4}[-.]\d{1,2}[-.]\d{1,2}`;
const D_MD_KR = String.raw`\d{1,2}\s*월\s*\d{1,2}\s*일`;
const D_MD_SL = String.raw`\b\d{1,2}\/\d{1,2}\b`;
const D_REL   = String.raw`모레|내일|낼|오늘|(?:이번|다음|담)\s*주말|(?:이번|다음|담)\s*주\s*(?:${DOW_RE})\s*요?일?|(?<!매\s*주\s*)(?:${DOW_RE})요일|(?:이번|이|다음)\s*달\s*(?:말|안|내)`;
const DATE_RE = new RegExp(`(${D_ABS}|${D_MD_KR}|${D_MD_SL}|${D_REL})`, 'g');

/** 날짜 표현 하나를 YYYY-MM-DD 로. 못 읽으면 null. */
export function parseDate(text, now = new Date()) {
  const today = seoulYMD(now);

  let m = text.match(new RegExp(D_ABS));
  if (m) { const [y, mo, d] = m[0].split(/[-.]/); return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`; }

  m = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/) || text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (m) {
    const mo = Number(m[1]), d = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const y = Number(today.slice(0, 4));
      const cand = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return cand < addDays(today, -31) ? `${y + 1}-${cand.slice(5)}` : cand;
    }
  }

  if (/모레/.test(text)) return addDays(today, 2);
  if (/내일|낼/.test(text)) return addDays(today, 1);
  if (/오늘/.test(text)) return today;

  m = text.match(/(이번|다음|담)\s*주말/);
  if (m) return addDays(m[1] === '이번' ? mondayOf(today) : addDays(mondayOf(today), 7), 5);

  m = text.match(new RegExp(`(이번|다음|담)\\s*주\\s*(${DOW_RE})\\s*요?일?`));
  if (m) {
    const mon = m[1] === '이번' ? mondayOf(today) : addDays(mondayOf(today), 7);
    const i = DOWS.indexOf(m[2]);
    return addDays(mon, i === 0 ? 6 : i - 1);
  }

  m = text.match(new RegExp(`(?<![가-힣])(${DOW_RE})\\s*요일`));
  if (m) {
    const i = DOWS.indexOf(m[1]);
    const cand = addDays(mondayOf(today), i === 0 ? 6 : i - 1);
    return cand < today ? addDays(cand, 7) : cand;
  }

  if (/(이번|이)\s*달\s*(말|안|내)/.test(text)) return endOfMonth(today);
  if (/다음\s*달\s*말/.test(text)) return endOfMonth(addDays(endOfMonth(today), 1));
  return null;
}

/** '매주 화요일' → 요일 (없으면 null) */
export function parseRecurrence(text) {
  const m = text.match(new RegExp(`매\\s*주\\s*(${DOW_RE})\\s*요?일?`));
  return m ? m[1] : null;
}

export const looksLikeDeadline = (t) => /까지|마감|데드라인|제출|신청|접수/.test(t);

// ── 제목 정리 ─────────────────────────────────────────────────────
function cleanTitle(s) {
  return s
    .replace(new RegExp(`매\\s*주\\s*(?:${DOW_RE})\\s*요?일?`, 'g'), ' ')   // '매주 화요일' 통째로
    .replace(DATE_RE, ' ')
    .replace(/(오전|오후|아침|저녁|밤|새벽)?\s*\d{1,2}\s*시(\s*\d{1,2}\s*분)?/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
    .replace(new RegExp(`\\s*(?:${RANGE})\\s*`, 'g'), ' ')
    .replace(/매\s*주/g, ' ')
    .replace(/까지|부터/g, ' ')
    .replace(/(?:^|\s)(에|에는|은|는|이|가|을|를)(?=\s|$)/g, ' ')
    .replace(/\s*(해야\s*함|해야\s*됨|해야지|하기|있음|있다|임|함)\s*$/, '')
    .replace(/\s*(하고|이고|고)\s*$/, '')      // '정리하고' → '정리'
    .replace(/\s*(해야|하고|해서)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── 문장 → 조각 ───────────────────────────────────────────────────
/**
 * 한 줄 안에 날짜가 여러 개면 각 날짜 앞에서 자른다.
 * 단 'A부터 B까지' / 'A~B' 처럼 사이가 범위 표시면 한 덩어리로 둔다.
 */
export function segment(lineText) {
  const hits = [...lineText.matchAll(DATE_RE)];
  if (hits.length <= 1) return [{ text: lineText, dates: hits.map((h) => h[0]) }];

  const segs = [];
  let startIdx = 0;
  let pending = [hits[0][0]];
  for (let i = 1; i < hits.length; i++) {
    const between = lineText.slice(hits[i - 1].index + hits[i - 1][0].length, hits[i].index);
    const isRange = new RegExp(`^\\s*(?:${RANGE})?\\s*$`).test(between)
      || /^\s*(부터)?\s*$/.test(between.replace(/까지/, ''));
    if (isRange) { pending.push(hits[i][0]); continue; }   // 같은 덩어리 (범위)
    segs.push({ text: lineText.slice(startIdx, hits[i].index), dates: pending });
    startIdx = hits[i].index;
    pending = [hits[i][0]];
  }
  segs.push({ text: lineText.slice(startIdx), dates: pending });
  return segs;
}

/** 원문에서 알려진 활동명을 찾아 slug 로. */
export function matchActivity(text, activities = []) {
  for (const a of activities) {
    const name = String(a.name ?? '');
    if (!name) continue;
    const head = name.replace(/\s*\d+기$/, '').trim();          // '왓잡 서포터즈 2기' → '왓잡 서포터즈'
    const first = head.split(/\s+/)[0];
    if (text.includes(name) || (head.length > 1 && text.includes(head))
        || (first.length > 1 && text.includes(first))) return a.slug;
  }
  return null;
}

/**
 * 원문 → normalize() 가 받는 모양.
 * @param {{activitySlug?:string|null, now?:Date, activities?:Array, weeks?:number}} o
 */
export function fallbackParse(rawText, { activitySlug = null, now = new Date(), activities = [], weeks = 8 } = {}) {
  const items = [];
  const notes = [];

  for (const raw of rawText.split(/\r?\n|[·•]|(?:그리고|또한|및)\s+/)) {
    const lineText = raw.trim();
    if (lineText.length < 2) continue;

    for (const seg of segment(lineText)) {
      const chunk = seg.text.trim();
      if (!chunk) continue;

      const tr = parseTimeRange(chunk);
      const hm = tr ? tr[0] : parseTime(chunk);
      const rec = parseRecurrence(chunk);
      const dates = seg.dates.map((d) => parseDate(d, now)).filter(Boolean);
      const title = cleanTitle(chunk) || chunk.slice(0, 40);
      const slug = activitySlug ?? matchActivity(chunk, activities);
      const kind = looksLikeDeadline(chunk) ? '마감' : (hm || rec) ? '회의' : '마감';

      // 매주 반복 — 끝이 없으면 weeks 주까지만 펼친다. 미리보기에서 빼면 된다.
      if (rec && !dates.length) {
        const i = DOWS.indexOf(rec);
        let d = addDays(mondayOf(seoulYMD(now)), i === 0 ? 6 : i - 1);
        if (d < seoulYMD(now)) d = addDays(d, 7);
        for (let n = 0; n < weeks; n++, d = addDays(d, 7)) {
          items.push(mk({ slug, title, kind, ymd: d, hm, end: tr?.[1] ?? null }));
        }
        notes.push(`"${title}" 은 매주 ${rec}요일 반복이라 ${weeks}주까지만 만들었습니다.`);
        continue;
      }

      if (!dates.length) {
        if (hm) notes.push(`"${chunk}" — 시각만 찾았고 날짜를 못 찾았습니다.`);
        continue;
      }

      // 날짜 범위 (9/14~9/20)
      if (dates.length > 1) {
        const [a, b] = [dates[0], dates[dates.length - 1]];
        items.push({
          ...mk({ slug, title, kind, ymd: a, hm: hm ?? '00:00', end: null }),
          due_at: kstISO(a, hm ?? '00:00'),
          due_end: kstISO(b, tr?.[1] ?? '23:59'),
          all_day: !hm,
        });
        continue;
      }

      items.push(mk({ slug, title, kind, ymd: dates[0], hm, end: tr?.[1] ?? null }));
    }
  }

  notes.unshift('규칙 기반으로 읽었습니다. 날짜·제목을 꼭 확인하세요.');
  return { activities: [], items, notes };

  function mk({ slug, title, kind, ymd, hm, end }) {
    return {
      activity_slug: slug, title, kind,
      due_at: kstISO(ymd, hm ?? '23:59'),
      due_end: end ? kstISO(ymd, end) : null,
      all_day: false, stage: '기획', required: true, memo: null, conflict_why: null,
    };
  }
}
