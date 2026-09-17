// 고정 주간 일정(수업 / 근로 / 알바) — public/schedule.json 이 유일한 원본이다.
// 대시보드는 같은 파일을 fetch 하므로 CLI 와 규칙이 갈라지지 않는다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './db.mjs';
import { seoulYMD, seoulHM, seoulDow } from './render.mjs';

let _sched = null;

export function schedule(file = join(ROOT, 'public', 'schedule.json')) {
  if (_sched) return _sched;
  try {
    _sched = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    _sched = { semester: null, classes: [], work: [], parttime: [] };
  }
  return _sched;
}

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** 고정 블록을 {day, start, end, kind, label, detail} 평면 배열로 편다. */
export function blocks() {
  const s = schedule();
  const out = [];
  for (const c of s.classes ?? [])
    for (const sl of c.slots ?? [])
      out.push({ ...sl, kind: '수업', label: c.name, color: c.color,
        detail: [c.prof, c.room].filter(Boolean).join(' · ') || null });
  for (const w of s.work ?? [])
    for (const sl of w.slots ?? [])
      out.push({ ...sl, kind: '근로', label: w.label, color: w.color, detail: null });
  for (const p of s.parttime ?? [])
    for (const sl of p.slots ?? [])
      out.push({ ...sl, kind: '알바', label: p.label, color: null, hatch: true, detail: null });
  return out;
}

/** 요일별로 묶어 시작시각 순 정렬. */
export function byDay(day) {
  return blocks().filter((b) => b.day === day).sort((a, b) => toMin(a.start) - toMin(b.start));
}

/**
 * 어떤 시각이 고정 일정과 겹치는지. 겹치면 블록을, 아니면 null.
 * 제약이 센 순서(알바 → 수업 → 근로)로 본다.
 */
export function fixedAt(due) {
  if (!due) return null;
  const day = seoulDow(due);
  const at = toMin(seoulHM(due));
  const rank = { 알바: 0, 수업: 1, 근로: 2 };
  return byDay(day)
    .filter((b) => at >= toMin(b.start) && at < toMin(b.end))
    .sort((a, b) => rank[a.kind] - rank[b.kind])[0] ?? null;
}

/** 충돌 사유 한 줄. 겹치지 않으면 null. */
export function conflictReason(due, allDay = false) {
  if (!due || allDay) return null;
  const b = fixedAt(due);
  if (!b) return null;
  const when = `${b.day} ${b.start.replace(':00', '')}–${b.end.replace(':00', '')}시`;
  return b.kind === '알바' ? `${when} ${b.label}와 겹침`
       : b.kind === '근로' ? `${when} 근로와 겹침`
       : `${when} ${b.label} 수업과 겹침`;
}

/** 프롬프트에 넣을 사람이 읽는 요약. */
export function scheduleText() {
  const s = schedule();
  const D = ['월', '화', '수', '목', '금', '토', '일'];
  const lines = [];
  for (const day of D) {
    const bs = byDay(day);
    if (!bs.length) continue;
    lines.push(`- ${day}: ` + bs.map((b) =>
      `${b.start}–${b.end} ${b.kind === '수업' ? b.label : b.label}`).join(', '));
  }
  // 온라인 과목은 정해진 시간이 없다 — 빠진 정보가 아니므로 그렇게 밝힌다.
  const online = (s.classes ?? []).filter((c) => c.online || !(c.slots ?? []).length).map((c) => c.name);
  if (online.length)
    lines.push(`- 온라인 과목(정해진 시간 없이 아무 때나 수강): ${online.join(', ')} — 일정 충돌 대상이 아니다.`);
  return lines.join('\n');
}
