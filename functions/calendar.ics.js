// Cloudflare Pages Function — /calendar.ics
//
// 정적 파일로 두면 누가 터미널에서 zun export 를 돌려야 갱신된다.
// 소유자는 터미널을 쓰지 않으므로, 요청이 올 때마다 DB 를 읽어 즉석에서 만든다.
// 웹에서 일정을 추가하면 아이폰이 다음 갱신 때 바로 받아간다.
import { buildCalendar } from '../public/lib/ics.mjs';
import { rest, SUPABASE_URL, SUPABASE_ANON_KEY } from '../public/lib/config.mjs';

/**
 * 피드 분리.
 * 아이폰 구독 캘린더는 캘린더 하나에 색 하나만 준다. 종류별로 색을 다르게 보려면
 * 피드를 나눠서 각각 구독하는 수밖에 없다. ?only= 로 고른다.
 */
const FEEDS = {
  class:      { name: 'zun 수업',     color: '#3478F6', fixed: ['수업'],        items: false },
  work:       { name: 'zun 근로·알바', color: '#30A46C', fixed: ['근로', '알바'], items: false },
  supporters: { name: 'zun 서포터즈',  color: '#F5A524', fixed: [],             items: true },
};
const ALL = { key: 'all', name: 'zun', color: '#F5A524', fixed: null, items: true }; // fixed:null = 전부

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * HTTP 헤더 값은 latin-1 만 담을 수 있다. 한글이 섞이면 Response 생성이 통째로 터진다.
 * 진단용 헤더 하나 때문에 캘린더가 안 나가는 일이 없도록 여기서 걸러 낸다.
 */
const hdr = (v) => String(v ?? '').replace(/[^\x20-\x7E]/g, '?').slice(0, 200);

/** ?only= 값을 피드 정의로 바꾼다. 활동 slug 를 주면 그 활동만 담은 피드가 된다. */
function feedFor(only, activities) {
  if (!only) return ALL;
  if (FEEDS[only]) return { key: only, ...FEEDS[only] };
  const act = activities.find((a) => a.slug === only);
  if (act) return {
    key: `act:${act.slug}`,
    name: `zun ${act.name}`, color: HEX.test(act.color ?? '') ? act.color : '#F5A524',
    fixed: [], items: true, activityId: act.id,
  };
  return ALL;                                  // 모르는 값이면 전체 — 구독이 빈 채로 남지 않게
}

/**
 * schedule.json 을 같은 배포본에서 읽어 고정 일정을 평탄화한다.
 * Worker 가 자기 호스트로 fetch 하면 실패한다 — 정적 자산은 ASSETS 바인딩으로 읽는다.
 */
async function fixedBlocks(origin, env) {
  try {
    const req = new Request(`${origin}/schedule.json`);
    const res = env?.ASSETS?.fetch ? await env.ASSETS.fetch(req) : await fetch(req);
    if (!res.ok) return { blocks: [], termEnd: null, why: `schedule.json ${res.status}` };
    const s = await res.json();
    const out = [];
    for (const c of s.classes ?? []) {
      if (c.online || !(c.slots ?? []).length) continue;
      for (const sl of c.slots)
        out.push({ ...sl, kind: '수업', label: c.name, color: c.color,
          detail: [c.prof, c.room].filter(Boolean).join(' · ') || null });
    }
    for (const w of s.work ?? [])
      for (const sl of w.slots ?? [])
        out.push({ ...sl, kind: '근로', label: w.label, color: w.color, detail: null });
    for (const p of s.parttime ?? [])
      for (const sl of p.slots ?? [])
        out.push({ ...sl, kind: '알바', label: p.label, color: null, detail: null, alba: true });
    return { blocks: out, termEnd: s.term_end ?? null, why: null };
  } catch (e) { return { blocks: [], termEnd: null, why: String(e?.message ?? e).slice(0, 120) }; }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const opt = (k) => url.searchParams.get(k);

  try {
    const cfg = {
      url: env?.SUPABASE_URL || SUPABASE_URL,
      key: env?.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY,
    };
    const [activities, items] = await Promise.all([
      rest('sp_activity?select=id,slug,name,color', cfg),
      rest('sp_item?select=*&order=due_at.asc', cfg),
    ]);

    const only = opt('only');
    const feed = feedFor(only, activities);

    const withSchedule = opt('schedule') !== '0' && feed.fixed?.length !== 0;
    const { blocks, termEnd, why } = withSchedule
      ? await fixedBlocks(url.origin, env) : { blocks: [], termEnd: null, why: null };

    const fixed = feed.fixed ? blocks.filter((b) => feed.fixed.includes(b.kind)) : blocks;
    let rows = feed.items ? items : [];
    if (feed.activityId) rows = rows.filter((it) => it.activity_id === feed.activityId);

    const ics = buildCalendar({
      items: rows, activities,
      fixed,
      name: opt('name') || feed.name,
      color: feed.color,
      marks: opt('marks') !== '0',
      termEnd,
      weeks: 16,
      alarms: opt('alarms') !== '0',
    });

    return new Response(ics, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="zun.ics"',
        // 아이폰이 자주 당겨가되 서버를 괴롭히지 않는 선
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
        // 조용히 비는 일이 없도록 진단값을 남긴다
        'X-Zun-Feed': hdr(feed.key),
        'X-Zun-Items': String(rows.length),
        'X-Zun-Fixed': String(fixed.length),
        ...(why ? { 'X-Zun-Schedule-Error': hdr(why) } : {}),
      },
    });
  } catch (e) {
    // 구독이 끊기지 않도록 빈 캘린더라도 200 으로 돌려준다.
    const empty = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//zun board//KO',
      'X-WR-CALNAME:zun (오류)', 'X-WR-TIMEZONE:Asia/Seoul',
      'END:VCALENDAR', '',
    ].join('\r\n');
    return new Response(empty, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Zun-Error': hdr(e?.message ?? e),
      },
    });
  }
}
