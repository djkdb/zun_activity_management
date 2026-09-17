#!/usr/bin/env node
// zun — 서포터즈·대외활동 CLI. 원문을 던지면 claude CLI 로 파싱해 Supabase 에 넣는다.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, openSync, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { db, listActivities, listUpcoming, searchItems, itemsOnDate, ConfigError, loadEnv } from '../src/db.mjs';
import { buildPrompt } from '../src/prompt.mjs';
import { parseWithClaude, ClaudeMissingError, ClaudeRunError, JsonExtractError, normalize } from '../src/parse.mjs';
import {
  A, hex, table, fmtDue, ddayLabel, dday, seoulYMD, seoulDow, hitsAlba,
  truncate, ok, warn, err,
} from '../src/render.mjs';

// ── 인터랙션 ──────────────────────────────────────────────────────────
let _rl = null;
function rl() {
  if (_rl) return _rl;
  let input = process.stdin;
  if (!process.stdin.isTTY) {
    // 파이프로 원문을 받은 경우 stdin 은 이미 소모됐다. 터미널을 다시 연다.
    try { input = createReadStream(null, { fd: openSync('/dev/tty', 'r') }); }
    catch { return null; }
  }
  _rl = createInterface({ input, output: process.stdout });
  return _rl;
}
async function ask(q, fallback = null) {
  const r = rl();
  if (!r) return fallback;
  try { return (await r.question(q)).trim(); } catch { return fallback; }
}
function closeRl() { if (_rl) { _rl.close(); _rl = null; } }

// ── 원문 확보 ─────────────────────────────────────────────────────────
function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function editorText(initial = '') {
  const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
  const file = join(tmpdir(), `zun-${Date.now()}.md`);
  writeFileSync(file, initial, 'utf8');
  const r = spawnSync(editor, [file], { stdio: 'inherit' });
  if (r.error) { unlinkSync(file); throw new Error(`에디터(${editor}) 실행 실패: ${r.error.message}`); }
  const text = readFileSync(file, 'utf8');
  unlinkSync(file);
  return text;
}

const EDITOR_HINT = `# 운영진 안내문 원문을 여기에 그대로 붙여넣으세요.
# '#' 로 시작하는 줄은 무시됩니다. 저장 후 종료하면 파싱이 시작됩니다.

`;

async function getRawText(opts) {
  if (opts.file) return readFileSync(opts.file, 'utf8');
  if (opts.text) return opts.text;
  if (!process.stdin.isTTY) {
    const piped = readStdin();
    if (piped.trim()) return piped;
  }
  const t = editorText(EDITOR_HINT);
  return t.split('\n').filter((l) => !l.startsWith('#')).join('\n');
}

// ── 유사도 (중복 검사) ────────────────────────────────────────────────
const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-_.,!?~()[\]/]/g, '');
function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
/** Dice 계수 0..1 */
export function similar(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const A1 = bigrams(x), B1 = bigrams(y);
  if (!A1.size || !B1.size) return 0;
  let inter = 0;
  for (const g of A1) if (B1.has(g)) inter++;
  return (2 * inter) / (A1.size + B1.size);
}
const DUP_THRESHOLD = 0.6;

// ── 미리보기 ──────────────────────────────────────────────────────────
function previewParsed(parsed, actBySlug) {
  const { activities, items, notes } = parsed;

  if (activities.length) {
    console.log(`\n${A.bold}새 활동 ${activities.length}건${A.reset}`);
    console.log(table(
      ['slug', '이름', '주최', '상태', '주기'],
      activities.map((a) => [
        `${hex('#7A6A78')}${a.slug}${A.reset}`, truncate(a.name, 28),
        truncate(a.org ?? '-', 18), a.status ?? '-', truncate(a.cadence ?? '-', 24),
      ])));
  }

  console.log(`\n${A.bold}일정 ${items.length}건${A.reset}`);
  if (!items.length) {
    console.log(`${A.gray}  (없음)${A.reset}`);
  } else {
    console.log(table(
      ['활동', '제목', '마감', '종류', '필수', '충돌'],
      items.map((i) => {
        const act = actBySlug.get(i.activity_slug);
        const label = act ? act.name : (i.activity_slug ?? '?');
        const c = act ? hex(act.color) : A.gray;
        const alba = hitsAlba(i.due_at);
        const why = i.conflict_why || (alba ? '알바 시간대(수·금 17–22시)' : '');
        return [
          `${c}${truncate(label, 20)}${A.reset}`,
          truncate(i.title, 30),
          i.due_at ? fmtDue(i.due_at, i.all_day) : `${A.yellow}미정${A.reset}`,
          i.kind ?? '-',
          i.required ? `${A.red}필수${A.reset}` : `${A.gray}선택${A.reset}`,
          why ? `${A.yellow}${truncate(why, 26)}${A.reset}` : '',
        ];
      }),
    ));
  }

  if (notes.length) {
    console.log(`\n${A.bold}${A.yellow}확인 필요${A.reset}`);
    for (const n of notes) console.log(`  ${A.yellow}·${A.reset} ${n}`);
  }
}

// ── 저장 ──────────────────────────────────────────────────────────────
const EMPTYISH = (v) => v === null || v === undefined || v === '' ||
  (typeof v === 'string' && v.includes('미정')) ||
  (Array.isArray(v) && v.length === 0);

async function persist(parsed, { rawText, source, assumeYes }) {
  const sb = db();
  const existing = await listActivities();
  const bySlug = new Map(existing.map((a) => [a.slug, a]));

  // 1) 활동 — 새 것은 insert, 기존은 비어있는 칸만 채운다 (기존 값 덮어쓰지 않음)
  let created = 0, enriched = 0;
  for (const a of parsed.activities) {
    const prev = bySlug.get(a.slug);
    if (!prev) {
      const row = {
        slug: a.slug, name: a.name, org: a.org, status: a.status,
        start_date: a.start_date, end_date: a.end_date, cadence: a.cadence,
        channels: a.channels, completion: a.completion, reward: a.reward,
        sort_order: (existing.length + created + 1) * 10 + 100,
      };
      const { data, error } = await sb.from('sp_activity').insert(row).select().single();
      if (error) throw error;
      bySlug.set(a.slug, data); created++;
    } else {
      const patch = {};
      for (const k of ['org', 'start_date', 'end_date', 'cadence', 'channels', 'completion', 'reward']) {
        if (EMPTYISH(prev[k]) && !EMPTYISH(a[k])) patch[k] = a[k];
      }
      if (Object.keys(patch).length) {
        const { data, error } = await sb.from('sp_activity').update(patch).eq('id', prev.id).select().single();
        if (error) throw error;
        bySlug.set(a.slug, data); enriched++;
      }
    }
  }

  // 2) 일정 — 중복 확인 후 insert
  const rows = [];
  let skipped = 0;
  for (const i of parsed.items) {
    const act = i.activity_slug ? bySlug.get(i.activity_slug) : null;
    if (i.activity_slug && !act) {
      console.log(warn(`활동 '${i.activity_slug}' 을(를) 찾을 수 없어 활동 없이 넣습니다: ${i.title}`));
    }
    const activity_id = act?.id ?? null;

    if (activity_id) {
      const sameDay = i.due_at ? await itemsOnDate(activity_id, seoulYMD(i.due_at)) : [];
      const hit = sameDay.find((e) => similar(e.title, i.title) >= DUP_THRESHOLD);
      if (hit) {
        const line = `${A.yellow}이미 비슷한 게 있습니다${A.reset}\n` +
          `    기존: ${hit.title} (${fmtDue(hit.due_at)})\n` +
          `    신규: ${i.title} (${fmtDue(i.due_at, i.all_day)})`;
        console.log(`\n  ${line}`);
        const a2 = assumeYes ? '' : await ask('  건너뛸까요? [Y/n] ', '');
        if (a2.toLowerCase() !== 'n') { skipped++; continue; }
      }
    }

    const alba = hitsAlba(i.due_at);
    const why = i.conflict_why || (alba ? '알바 시간대(수·금 17–22시)와 겹침' : null);
    rows.push({
      activity_id, title: i.title, kind: i.kind, due_at: i.due_at, due_end: i.due_end,
      all_day: i.all_day, stage: i.stage, required: i.required,
      conflict: Boolean(why), conflict_why: why, memo: i.memo, source,
    });
  }

  let inserted = 0;
  if (rows.length) {
    const { data, error } = await sb.from('sp_item').insert(rows).select('id');
    if (error) throw error;
    inserted = data.length;
  }

  // 3) 원문 + 파싱 결과 보관
  const { error: ingErr } = await sb.from('sp_ingest').insert({
    raw_text: rawText, parsed, item_count: inserted, source,
  });
  if (ingErr) console.log(warn(`sp_ingest 기록 실패(무시): ${ingErr.message}`));

  return { created, enriched, inserted, skipped };
}

// ── 명령: add ─────────────────────────────────────────────────────────
async function cmdAdd(opts) {
  const rawText = (await getRawText(opts)).trim();
  if (!rawText) { console.log(warn('원문이 비어 있습니다. 취소했습니다.')); return 0; }

  const activities = await listActivities();
  const actBySlug = new Map(activities.map((a) => [a.slug, a]));
  if (opts.activity && !actBySlug.has(opts.activity)) {
    console.log(warn(`--activity ${opts.activity} 는 등록된 slug 가 아닙니다. 힌트로만 씁니다.`));
  }

  const prompt = buildPrompt({ rawText, activities, activityHint: opts.activity });
  process.stdout.write(`${A.gray}claude 로 파싱 중… (최대 120초)${A.reset}`);

  let result;
  while (true) {
    try {
      result = await parseWithClaude(prompt);
      process.stdout.write(`\r${' '.repeat(40)}\r`);
      break;
    } catch (e) {
      process.stdout.write(`\r${' '.repeat(40)}\r`);
      if (e instanceof ClaudeMissingError) { console.error(err(e.message)); return 1; }
      console.error(err(e.message));
      if (e instanceof JsonExtractError && e.raw) {
        console.error(`\n${A.gray}--- claude 원문 응답 ---${A.reset}\n${e.raw.trim()}\n${A.gray}---${A.reset}`);
      }
      const again = opts.assumeYes ? 'n' : await ask('다시 시도할까요? [Y/n] ', 'n');
      if (again.toLowerCase() === 'n') return 1;
      process.stdout.write(`${A.gray}다시 파싱 중…${A.reset}`);
    }
  }

  let parsed = result.parsed;
  // 새로 생기는 활동도 미리보기에서 이름이 보이도록
  const previewMap = new Map(actBySlug);
  for (const a of parsed.activities) if (!previewMap.has(a.slug)) previewMap.set(a.slug, a);
  previewParsed(parsed, previewMap);

  if (opts.dryRun) { console.log(`\n${A.gray}--dry-run — 저장하지 않고 종료합니다.${A.reset}`); return 0; }

  while (true) {
    const choice = opts.assumeYes ? '' : await ask(`\n${A.bold}[Enter] 저장  [e] 수정  [q] 취소${A.reset} › `, 'q');
    const c = (choice ?? '').toLowerCase();
    if (c === 'q') { console.log('취소했습니다.'); return 0; }
    if (c === 'e') {
      try {
        parsed = normalize(JSON.parse(editorText(JSON.stringify(parsed, null, 2))));
      } catch (e) { console.log(err(`JSON 을 읽지 못했습니다: ${e.message}`)); continue; }
      const m2 = new Map(actBySlug);
      for (const a of parsed.activities) if (!m2.has(a.slug)) m2.set(a.slug, a);
      previewParsed(parsed, m2);
      continue;
    }
    break;
  }

  const r = await persist(parsed, { rawText, source: 'cli', assumeYes: opts.assumeYes });
  console.log('\n' + ok(
    `일정 ${r.inserted}건 저장` +
    (r.skipped ? `, ${r.skipped}건 건너뜀` : '') +
    (r.created ? `, 새 활동 ${r.created}개` : '') +
    (r.enriched ? `, 활동 정보 ${r.enriched}개 보완` : '')));
  return 0;
}

// ── 명령: save ────────────────────────────────────────────────────────
async function cmdSave(file, opts) {
  if (!file) { console.error(err('사용법: zun save <parsed.json>')); return 1; }
  const text = readFileSync(file, 'utf8');
  let parsed;
  try { parsed = normalize(JSON.parse(text)); }
  catch (e) { console.error(err(`JSON 파싱 실패: ${e.message}`)); return 1; }

  const activities = await listActivities();
  const map = new Map(activities.map((a) => [a.slug, a]));
  for (const a of parsed.activities) if (!map.has(a.slug)) map.set(a.slug, a);
  previewParsed(parsed, map);

  if (opts.dryRun) { console.log(`\n${A.gray}--dry-run — 저장하지 않고 종료합니다.${A.reset}`); return 0; }
  if (!opts.assumeYes) {
    const c = await ask(`\n${A.bold}[Enter] 저장  [q] 취소${A.reset} › `, 'q');
    if ((c ?? '').toLowerCase() === 'q') { console.log('취소했습니다.'); return 0; }
  }

  const r = await persist(parsed, {
    rawText: opts.rawText || text, source: opts.source || 'skill', assumeYes: true,
  });
  console.log('\n' + ok(
    `일정 ${r.inserted}건 저장` +
    (r.skipped ? `, ${r.skipped}건 건너뜀` : '') +
    (r.created ? `, 새 활동 ${r.created}개` : '') +
    (r.enriched ? `, 활동 정보 ${r.enriched}개 보완` : '')));
  return 0;
}

// ── 명령: ls ──────────────────────────────────────────────────────────
async function cmdLs(opts) {
  const days = opts.days ?? 30;
  const items = await listUpcoming({ days, includeDone: opts.all });
  const today = seoulYMD();
  console.log(`${A.bold}다가오는 ${days}일 일정${A.reset} ${A.gray}(오늘 ${today} ${seoulDow(new Date())})${A.reset}\n`);

  if (!items.length) { console.log(`${A.gray}  일정이 없습니다.${A.reset}`); return 0; }

  let curDate = null;
  for (const i of items) {
    const d = seoulYMD(i.due_at);
    if (d !== curDate) {
      curDate = d;
      const isToday = d === today;
      const dow = seoulDow(i.due_at);
      const albaDay = dow === '수' || dow === '금';
      const head = `${d} (${dow})  ${ddayLabel(i.due_at)}`;
      console.log(`${isToday ? A.bold + A.green : A.bold}${head}${A.reset}` +
        (albaDay ? ` ${A.gray}· 알바 17–22시${A.reset}` : ''));
    }
    const act = i.activity;
    const c = act ? hex(act.color) : A.gray;
    const badge = `${c}█${A.reset} ${c}${truncate(act?.name ?? '-', 18)}${A.reset}`;
    const time = i.all_day ? `${A.gray}종일${A.reset}` : i.due_at.slice(0, 1) && fmtDue(i.due_at).split(' ')[1];
    const flags = [
      i.done ? `${A.green}완료${A.reset}` : '',
      i.required ? `${A.red}필수${A.reset}` : '',
      i.conflict ? `${A.yellow}⚠ ${truncate(i.conflict_why ?? '충돌', 30)}${A.reset}` : '',
    ].filter(Boolean).join(' ');
    console.log(`  ${time ?? '    '}  ${badge}  ${truncate(i.title, 36)} ${flags}`);
  }

  const conflicts = items.filter((i) => i.conflict).length;
  console.log(`\n${A.gray}총 ${items.length}건${conflicts ? ` · 충돌 ${conflicts}건` : ''}${A.reset}`);
  return 0;
}

// ── 명령: done ────────────────────────────────────────────────────────
async function cmdDone(term, opts) {
  if (!term) { console.error(err('사용법: zun done <검색어>')); return 1; }
  const hits = await searchItems(term);
  if (!hits.length) { console.log(warn(`'${term}' 와(과) 일치하는 일정이 없습니다.`)); return 1; }

  let target = hits[0];
  if (hits.length > 1) {
    console.log(`${A.bold}'${term}' 검색 결과${A.reset}`);
    hits.forEach((h, n) => {
      const c = h.activity ? hex(h.activity.color) : A.gray;
      console.log(`  ${A.bold}${n + 1}${A.reset}) ${c}${truncate(h.activity?.name ?? '-', 16)}${A.reset}  ` +
        `${truncate(h.title, 34)}  ${fmtDue(h.due_at, h.all_day)}  ${h.done ? A.green + '완료' + A.reset : ''}`);
    });
    const pick = opts.assumeYes ? '1' : await ask(`\n번호 선택 [1-${hits.length}] (Enter=1, q=취소) › `, 'q');
    if ((pick ?? '').toLowerCase() === 'q') { console.log('취소했습니다.'); return 0; }
    const n = pick.trim() === '' ? 1 : Number(pick);
    if (!Number.isInteger(n) || n < 1 || n > hits.length) { console.error(err('잘못된 번호입니다.')); return 1; }
    target = hits[n - 1];
  }

  const next = !target.done;
  const { error } = await db().from('sp_item')
    .update({ done: next, done_at: next ? new Date().toISOString() : null })
    .eq('id', target.id);
  if (error) throw error;
  console.log(ok(`${next ? '완료 처리' : '완료 해제'}: ${target.title} ${A.gray}(${fmtDue(target.due_at, target.all_day)})${A.reset}`));
  return 0;
}

// ── 명령: open ────────────────────────────────────────────────────────
function cmdOpen() {
  loadEnv();
  const url = process.env.ZUN_DASHBOARD_URL;
  if (!url) {
    console.error(err('.env 에 ZUN_DASHBOARD_URL 이 없습니다. 배포한 Cloudflare Pages 주소를 넣으세요.'));
    return 1;
  }
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  const child = spawn(cmd, [url], { stdio: 'ignore', detached: true });
  child.on('error', () => console.log(`브라우저를 열지 못했습니다. 직접 여세요: ${A.underline}${url}${A.reset}`));
  child.unref();
  console.log(ok(`대시보드를 엽니다: ${A.underline}${url}${A.reset}`));
  return 0;
}

// ── 인자 파싱 ─────────────────────────────────────────────────────────
const HELP = `${A.bold}zun${A.reset} — 서포터즈·대외활동 관리 CLI

${A.bold}사용법${A.reset}
  zun add                       $EDITOR 를 열어 원문 작성 → 파싱
  zun add "9/18 금 10시 OT"      인자로 바로
  cat 공지.txt | zun add          파이프
  zun add -f 가이드북.txt          파일에서
  zun add --activity teazr       활동 힌트 (선택)
  zun save parsed.json          파싱 건너뛰고 JSON 직접 삽입
  zun ls [일수]                  다가오는 마감 (기본 30일)
  zun done <검색어>              제목 부분일치로 찾아 완료 토글
  zun open                      배포된 대시보드 열기

${A.bold}옵션${A.reset}
  -f, --file <경로>     원문 파일
      --activity <slug> 활동 힌트
  -y, --yes             확인 없이 진행
      --dry-run         파싱·미리보기만 하고 저장하지 않음
      --all             (ls) 완료된 일정도 표시
  -h, --help            이 도움말
`;

function parseArgs(argv) {
  const o = { _: [], dryRun: false, assumeYes: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-f' || a === '--file') o.file = argv[++i];
    else if (a === '--activity') o.activity = argv[++i];
    else if (a === '--source') o.source = argv[++i];
    else if (a === '-y' || a === '--yes') o.assumeYes = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--all') o.all = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else o._.push(a);
  }
  return o;
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  const cmd = opts._[0];

  if (opts.help || !cmd || cmd === 'help') { console.log(HELP); return 0; }

  switch (cmd) {
    case 'add': {
      opts.text = opts._.slice(1).join(' ') || undefined;
      return cmdAdd(opts);
    }
    case 'save': return cmdSave(opts._[1], opts);
    case 'ls': {
      const n = Number(opts._[1]);
      if (Number.isFinite(n) && n > 0) opts.days = n;
      return cmdLs(opts);
    }
    case 'done': return cmdDone(opts._.slice(1).join(' '), opts);
    case 'open': return cmdOpen();
    default:
      console.error(err(`알 수 없는 명령: ${cmd}`));
      console.log(HELP);
      return 1;
  }
}

main()
  .then((code) => { closeRl(); process.exit(code ?? 0); })
  .catch((e) => {
    closeRl();
    if (e instanceof ConfigError) console.error(err(e.message));
    else if (e instanceof ClaudeMissingError) console.error(err(e.message));
    else if (e instanceof ClaudeRunError) console.error(err(e.message));
    else if (e?.message?.includes('Host not in allowlist')) {
      console.error(err(`Supabase 에 연결하지 못했습니다: ${e.message}`));
    } else console.error(err(e?.message ?? String(e)));
    process.exit(1);
  });
