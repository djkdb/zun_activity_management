// Cloudflare Pages Function — /calendar.ics
//
// 정적 파일로 두면 누가 터미널에서 zun export 를 돌려야 갱신된다.
// 소유자는 터미널을 쓰지 않으므로, 요청이 올 때마다 DB 를 읽어 즉석에서 만든다.
// 웹에서 일정을 추가하면 아이폰이 다음 갱신 때 바로 받아간다.
import { buildCalendar } from '../public/lib/ics.mjs';
import { rest, SUPABASE_URL, SUPABASE_ANON_KEY } from '../public/lib/config.mjs';

/** schedule.json 을 같은 배포본에서 읽어 고정 일정을 평탄화한다. */
async function fixedBlocks(origin) {
  try {
    const res = await fetch(`${origin}/schedule.json`, { cf: { cacheTtl: 300 } });
    if (!res.ok) return { blocks: [], termEnd: null };
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
    return { blocks: out, termEnd: s.term_end ?? null };
  } catch { return { blocks: [], termEnd: null }; }
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

    const withSchedule = opt('schedule') !== '0';
    const { blocks, termEnd } = withSchedule
      ? await fixedBlocks(url.origin) : { blocks: [], termEnd: null };

    const ics = buildCalendar({
      items, activities,
      fixed: blocks,
      name: opt('name') || 'zun',
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
        'X-Zun-Error': String(e?.message ?? e).slice(0, 200),
      },
    });
  }
}
