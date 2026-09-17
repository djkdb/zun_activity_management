// iCalendar(RFC 5545) 생성. 아이폰 '구독 캘린더'가 이 파일을 통째로 당겨간다.
// UID 가 안정적이면 파일을 다시 써도 아이폰에서 중복이 생기지 않는다.
import { seoulYMD, seoulHM, toMin, DOWS, addDays, kstISO } from '../../core/dates.mjs';

const DOMAIN = 'zun.board';

/** RFC 5545 TEXT 이스케이프. 순서 중요 — 역슬래시를 먼저. */
export const esc = (s) => String(s ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/;/g, '\;')
  .replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

/**
 * 75옥텟 줄 접기. 한글은 UTF-8 멀티바이트라 문자 수가 아니라 바이트로 세야 하고,
 * 문자 중간에서 자르면 깨진다.
 */
export function fold(line) {
  const b = Buffer.from(line, 'utf8');
  if (b.length <= 75) return line;
  const parts = [];
  let start = 0;
  while (start < b.length) {
    const limit = parts.length === 0 ? 75 : 74;   // 이어지는 줄은 앞에 공백 1칸
    let end = Math.min(start + limit, b.length);
    while (end > start && end < b.length && (b[end] & 0xc0) === 0x80) end--; // 문자 경계까지 후퇴
    parts.push((parts.length ? ' ' : '') + b.subarray(start, end).toString('utf8'));
    start = end;
  }
  return parts.join('\r\n');
}

/** ISO → 20261015T145900Z (UTC). 한국은 서머타임이 없어 UTC 고정이 안전하다. */
const utcStamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateStamp = (iso) => seoulYMD(iso).replace(/-/g, '');

const line = (k, v) => fold(`${k}:${v}`);

/** 끝 시각이 없을 때 쓰는 기본 길이(분) */
export function defaultMinutes(kind) {
  if (kind === '회의' || kind === '행사') return 60;
  return 30;   // 마감·제출·업로드·안내 — 짧게 잡아 캘린더를 덜 가린다
}

/** 마감·제출은 D-7/D-3/D-1, 시간 약속은 1시간 전 */
export function defaultAlarms(kind) {
  if (kind === '마감' || kind === '제출') return ['-P7D', '-P3D', '-P1D'];
  if (kind === '회의' || kind === '행사') return ['-PT1H'];
  return [];
}

function alarm(trigger, summary) {
  return [
    'BEGIN:VALARM', 'ACTION:DISPLAY',
    line('DESCRIPTION', esc(summary)),
    `TRIGGER:${trigger}`,
    'END:VALARM',
  ];
}

/** sp_item 한 건 → VEVENT */
export function itemEvent(item, activity, { now = new Date(), alarms = true } = {}) {
  if (!item.due_at) return null;
  const actName = activity?.name ?? null;
  const summary = actName ? `${item.title} · ${actName}` : item.title;
  const out = ['BEGIN:VEVENT'];

  out.push(line('UID', `item-${item.id}@${DOMAIN}`));
  out.push(line('DTSTAMP', utcStamp(now.toISOString())));
  out.push(line('SUMMARY', esc(`${item.done ? '✓ ' : ''}${summary}`)));

  if (item.all_day) {
    out.push(line('DTSTART;VALUE=DATE', dateStamp(item.due_at)));
    // DTEND 는 배타적이라 하루 더한다
    out.push(line('DTEND;VALUE=DATE', dateStamp(addDays(seoulYMD(item.due_end ?? item.due_at), 1))));
  } else {
    out.push(line('DTSTART', utcStamp(item.due_at)));
    // 끝 시각이 없으면 길이 0 이 돼 캘린더에서 점으로 보인다. 종류별 기본 길이를 준다.
    const end = item.due_end
      ?? new Date(new Date(item.due_at).getTime() + defaultMinutes(item.kind) * 60000).toISOString();
    out.push(line('DTEND', utcStamp(end)));
  }

  const desc = [
    item.kind ? `종류: ${item.kind}` : null,
    item.required ? '필수' : null,
    item.conflict && item.conflict_why ? `⚠ ${item.conflict_why}` : null,
    item.memo || null,
  ].filter(Boolean).join('\n');
  if (desc) out.push(line('DESCRIPTION', esc(desc)));

  if (item.kind) out.push(line('CATEGORIES', esc(item.kind)));
  out.push(`STATUS:${item.done ? 'COMPLETED' : 'CONFIRMED'}`);
  out.push(`TRANSP:${item.all_day ? 'TRANSPARENT' : 'OPAQUE'}`);

  if (alarms && !item.done)
    for (const t of defaultAlarms(item.kind)) out.push(...alarm(t, summary));

  out.push('END:VEVENT');
  return out;
}

/** 고정 주간 일정 한 칸 → 매주 반복 VEVENT */
export function fixedEvent(block, { from, count = 16, until = null, now = new Date() } = {}) {
  // from(월요일) 기준으로 그 주의 해당 요일을 첫 발생으로 잡는다
  const idx = DOWS.indexOf(block.day);
  const first = addDays(from, idx === 0 ? 6 : idx - 1);
  const uid = `fixed-${block.day}-${block.start.replace(':', '')}-${block.label}@${DOMAIN}`;

  const out = ['BEGIN:VEVENT'];
  out.push(line('UID', esc(uid)));
  out.push(line('DTSTAMP', utcStamp(now.toISOString())));
  out.push(line('SUMMARY', esc(block.label)));
  out.push(line('DTSTART', utcStamp(kstISO(first, block.start))));
  out.push(line('DTEND', utcStamp(kstISO(first, block.end))));
  const byday = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][idx];
  out.push(`RRULE:FREQ=WEEKLY;BYDAY=${byday};${until ? `UNTIL=${dateStamp(until)}T235900Z` : `COUNT=${count}`}`);
  if (block.detail) out.push(line('DESCRIPTION', esc(block.detail)));
  out.push(line('CATEGORIES', esc(block.kind)));
  if (block.detail) out.push(line('LOCATION', esc(block.detail.split(' · ').pop())));
  out.push('TRANSP:OPAQUE');
  out.push('END:VEVENT');
  return out;
}

/**
 * 전체 캘린더.
 * @param {{items:Array, activities:Array, fixed?:Array, name?:string, now?:Date,
 *          termEnd?:string|null, weeks?:number, alarms?:boolean}} o
 */
export function buildCalendar({
  items = [], activities = [], fixed = [],
  name = 'zun', now = new Date(), termEnd = null, weeks = 16, alarms = true,
} = {}) {
  const byId = new Map(activities.map((a) => [a.id, a]));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//zun board//KO`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    line('X-WR-CALNAME', esc(name)),
    'X-WR-TIMEZONE:Asia/Seoul',
    'X-PUBLISHED-TTL:PT1H',            // 아이폰에 1시간마다 확인하라고 알린다
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];

  for (const it of items) {
    const ev = itemEvent(it, byId.get(it.activity_id), { now, alarms });
    if (ev) lines.push(...ev);
  }

  if (fixed.length) {
    const from = (() => { const t = seoulYMD(now); const i = DOWS.indexOf(
      ['일','월','화','수','목','금','토'][new Date(kstISO(t, '12:00')).getUTCDay()]);
      return addDays(t, i === 0 ? -6 : 1 - i); })();
    for (const b of fixed) lines.push(...fixedEvent(b, { from, count: weeks, until: termEnd, now }));
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
