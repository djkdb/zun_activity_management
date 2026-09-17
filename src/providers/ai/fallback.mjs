// claude 가 없거나 실패했을 때 쓰는 규칙 기반 파서.
// AI 를 대체하려는 게 아니라 "아무것도 못 하는 상태"를 막는 것이 목적이다.
// 확신하지 못하는 값은 비워 두고 notes 에 적는다 — 날짜를 지어내지 않는다.
import { seoulYMD, seoulDow, addDays, kstISO, endOfMonth, mondayOf, DOWS } from '../../core/dates.mjs';

const DOW_RE = '일|월|화|수|목|금|토';

/** 오전/오후/밤/저녁/새벽 + 시 → 'HH:MM' */
function parseTime(text) {
  let m = text.match(/(오전|오후|아침|저녁|밤|새벽)?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?/);
  if (m) {
    let h = Number(m[2]);
    const min = Number(m[3] ?? 0);
    const mark = m[1];
    if (mark === '오후' || mark === '저녁' || mark === '밤') { if (h < 12) h += 12; }
    else if (mark === '새벽' || mark === '아침' || mark === '오전') { if (h === 12) h = 0; }
    else if (h <= 7) h += 12;           // "6시에 축구" 는 저녁으로 본다
    if (h > 23) h = 23;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  m = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  return null;
}

/** 텍스트에서 날짜(YYYY-MM-DD) 하나를 뽑는다. 못 뽑으면 null. */
export function parseDate(text, now = new Date()) {
  const today = seoulYMD(now);

  // 10월 15일 / 10/15 / 2026-10-15
  let m = text.match(/(\d{4})[-.](\d{1,2})[-.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  m = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/) || text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (m) {
    const mo = Number(m[1]), d = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const y = Number(today.slice(0, 4));
      const cand = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      // 이미 지난 달이면 내년으로 본다 (한 달 이상 과거일 때만)
      return cand < addDays(today, -31) ? `${y + 1}-${cand.slice(5)}` : cand;
    }
  }

  if (/모레/.test(text)) return addDays(today, 2);
  if (/내일|낼/.test(text)) return addDays(today, 1);
  if (/오늘/.test(text)) return today;

  // 이번/다음 주말 — '주'를 먼저 소비하면 '말'만 남아 안 잡힌다. 따로 본다.
  m = text.match(/(이번|다음|담)\s*주말/);
  if (m) {
    const weekMon = m[1] === '이번' ? mondayOf(today) : addDays(mondayOf(today), 7);
    return addDays(weekMon, 5);                          // 토요일
  }
  // 이번 주 / 다음 주 + 요일
  m = text.match(new RegExp(`(이번|다음|담)\\s*주\\s*(${DOW_RE})\\s*요?일?`));
  if (m) {
    const weekMon = m[1] === '이번' ? mondayOf(today) : addDays(mondayOf(today), 7);
    const idx = DOWS.indexOf(m[2]);                      // 일=0 … 토=6
    return addDays(weekMon, idx === 0 ? 6 : idx - 1);
  }
  // 그냥 "금요일"
  m = text.match(new RegExp(`(?<![가-힣])(${DOW_RE})\\s*요일`));
  if (m) {
    const idx = DOWS.indexOf(m[1]);
    const mon = mondayOf(today);
    const cand = addDays(mon, idx === 0 ? 6 : idx - 1);
    return cand < today ? addDays(cand, 7) : cand;       // 지났으면 다음 주
  }

  if (/이번\s*달\s*(말|안|내)|이달\s*(말|안|내)/.test(text)) return endOfMonth(today);
  if (/다음\s*달\s*말/.test(text)) return endOfMonth(addDays(endOfMonth(today), 1));

  return null;
}

/** 마감 표현인지 (…까지 / 마감 / 제출 / 데드라인) */
export const looksLikeDeadline = (t) => /까지|마감|데드라인|제출|신청|접수/.test(t);

/**
 * 원문 → parse.mjs 의 normalize() 가 받는 모양.
 * 문장을 줄·쉼표로 쪼개 각각에서 날짜를 찾는다.
 */
export function fallbackParse(rawText, { activitySlug = null, now = new Date() } = {}) {
  const items = [];
  const notes = [];

  const chunks = rawText
    .split(/[\n·•]|(?<=[다요음함])[,、]\s*|(?:그리고|또한)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);

  for (const chunk of chunks) {
    const ymd = parseDate(chunk, now);
    const hm = parseTime(chunk);
    if (!ymd && !hm) continue;

    const title = chunk
      .replace(/(\d{4})[-.]\d{1,2}[-.]\d{1,2}/g, '')
      .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, '')
      .replace(/\b\d{1,2}\/\d{1,2}\b/g, '')
      .replace(/(오전|오후|아침|저녁|밤|새벽)?\s*\d{1,2}\s*시(\s*\d{1,2}\s*분)?/g, '')
      .replace(/\b\d{1,2}:\d{2}\b/g, '')
      .replace(new RegExp(`(이번|다음|담)?\\s*주?\\s*(${DOW_RE})\\s*요일`, 'g'), '')
      .replace(/오늘|내일|낼|모레|이번\s*달\s*(말|안|내)/g, '')
      .replace(/까지|에\s*$|\s+/g, ' ')
      .trim();

    if (!ymd) { notes.push(`"${chunk}" — 시각만 찾았고 날짜를 못 찾았습니다.`); continue; }

    items.push({
      activity_slug: activitySlug,
      title: title || chunk.slice(0, 40),
      kind: looksLikeDeadline(chunk) ? '마감' : hm ? '회의' : '마감',
      due_at: kstISO(ymd, hm ?? '23:59'),
      due_end: null,
      all_day: false,
      stage: '기획',
      required: true,
      memo: null,
      conflict_why: null,
    });
  }

  notes.unshift('AI 파싱을 쓰지 못해 규칙 기반으로 읽었습니다. 날짜·제목을 꼭 확인하세요.');
  return { activities: [], items, notes };
}
