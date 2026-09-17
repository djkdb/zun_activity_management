// Asia/Seoul 날짜 처리. 표시(render)와 분리해 둔다 — 파싱·충돌·내보내기가 전부 여기에 의존한다.
export const TZ = 'Asia/Seoul';

const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hmFmt  = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const dowFmt = new Intl.DateTimeFormat('ko-KR', { timeZone: TZ, weekday: 'short' });

const asDate = (d) => (d instanceof Date ? d : new Date(d));

/** Asia/Seoul 기준 YYYY-MM-DD */
export const seoulYMD = (d = new Date()) => ymdFmt.format(asDate(d));
/** Asia/Seoul 기준 HH:MM */
export const seoulHM = (d) => hmFmt.format(asDate(d));
/** Asia/Seoul 기준 요일 (월~일) */
export const seoulDow = (d) => dowFmt.format(asDate(d)).replace(/요일$/, '');

export const DOWS = ['일', '월', '화', '수', '목', '금', '토'];

/** 'HH:MM' → 분 */
export const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
/** 분 → 'HH:MM' */
export const toHM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const ymdToUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };

/** YYYY-MM-DD 에 n일 더하기 (달·해 넘김 포함) */
export const addDays = (ymd, n) => new Date(ymdToUTC(ymd) + n * 86400000).toISOString().slice(0, 10);

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

/** YYYY-MM-DD + HH:MM → KST ISO 문자열. 문자열 조립이라 브라우저 타임존에 흔들리지 않는다. */
export const kstISO = (ymd, hm = '23:59') => `${ymd}T${hm.length === 5 ? hm : toHM(toMin(hm))}:00+09:00`;

/** 그 날의 월요일 (일요일은 지난 월요일로) */
export function mondayOf(ymd) {
  const idx = DOWS.indexOf(seoulDow(kstISO(ymd, '12:00')));
  return addDays(ymd, idx === 0 ? -6 : 1 - idx);
}

/** 상대 날짜 해석에 쓰는 주 경계 */
export function weekContext(now = new Date()) {
  const today = seoulYMD(now);
  const mon = mondayOf(today);
  return {
    today, dow: seoulDow(now),
    thisMon: mon, thisSun: addDays(mon, 6),
    nextMon: addDays(mon, 7), nextSun: addDays(mon, 13),
  };
}

/** 그 달의 마지막 날 */
export function endOfMonth(ymd) {
  const [y, m] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
