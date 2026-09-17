// 대시보드와 Pages Function 이 같은 값을 쓴다.
// anon 키는 RLS 로 보호되며 클라이언트에 공개되는 것이 정상이다.
export const SUPABASE_URL = 'https://rlisxmxytrvapkgcqkgf.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJsaXN4bXh5dHJ2YXBrZ2Nxa2dmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2MjEzOTUsImV4cCI6MjEwMzE5NzM5NX0.y0H7DDxHn70s79XzIUT2hqcy31jbJwzqRIabn3EmaDQ';

/** supabase-js 없이 REST 로 읽는다 (Workers 에서 번들 없이 쓰기 위해). */
export async function rest(path, { url = SUPABASE_URL, key = SUPABASE_ANON_KEY } = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
