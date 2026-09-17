// Supabase 클라이언트 (service_role) — CLI 전용. 브라우저로 절대 보내지 말 것.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** 의존성 없이 .env 파싱 (KEY=VALUE, #주석, 따옴표 허용). 이미 있는 env는 덮어쓰지 않음. */
export function loadEnv(file = join(ROOT, '.env')) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^(['"]).*\1$/s.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '').trim();
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

export class ConfigError extends Error {}

let _client = null;

export function db() {
  if (_client) return _client;
  loadEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new ConfigError(
      '.env 에 SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.\n' +
      '  1) cp .env.example .env\n' +
      '  2) Supabase 대시보드 → zungong → Settings → API → service_role 키 복사\n' +
      '  3) .env 의 SUPABASE_SERVICE_ROLE_KEY= 뒤에 붙여넣기'
    );
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

/** 활동 전체 (sort_order 순). 프롬프트 주입과 ls 에서 함께 사용. */
export async function listActivities() {
  const { data, error } = await db()
    .from('sp_activity')
    .select('*')
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** 다가오는 일정. days 일치, 완료 포함 여부 선택. */
export async function listUpcoming({ days = 30, includeDone = false } = {}) {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + days * 86400000);
  let q = db()
    .from('sp_item')
    .select('*, activity:sp_activity(slug, name, color)')
    .gte('due_at', from.toISOString())
    .lte('due_at', to.toISOString())
    .order('due_at', { ascending: true });
  if (!includeDone) q = q.eq('done', false);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** 제목 부분일치 검색 (완료 토글용). */
export async function searchItems(term, { limit = 20 } = {}) {
  const { data, error } = await db()
    .from('sp_item')
    .select('*, activity:sp_activity(slug, name, color)')
    .ilike('title', `%${term}%`)
    .order('due_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** 같은 활동 + 같은 날짜의 기존 일정 (중복 검사용). */
export async function itemsOnDate(activityId, isoDate) {
  const { data, error } = await db()
    .from('sp_item')
    .select('id, title, due_at, kind')
    .eq('activity_id', activityId)
    .gte('due_at', `${isoDate}T00:00:00+09:00`)
    .lte('due_at', `${isoDate}T23:59:59+09:00`);
  if (error) throw error;
  return data ?? [];
}
