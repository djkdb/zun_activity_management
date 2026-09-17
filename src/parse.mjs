// claude CLI 서브프로세스 호출 + 출력에서 JSON 추출.
// API 종량과금을 쓰지 않기 위해 반드시 구독 기반 `claude` CLI 를 통해 파싱한다.
import { spawn } from 'node:child_process';

export class ClaudeMissingError extends Error {}
export class ClaudeRunError extends Error {
  constructor(msg, raw) { super(msg); this.raw = raw; }
}
export class JsonExtractError extends Error {
  constructor(msg, raw) { super(msg); this.raw = raw; }
}

const TIMEOUT_MS = 120_000;

/** `claude -p <prompt> --output-format text` 실행. stdout 만 수집한다. */
export function runClaude(prompt, { timeout = TIMEOUT_MS, bin = process.env.ZUN_CLAUDE_BIN || 'claude' } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, ['-p', prompt, '--output-format', 'text'], {
        stdio: ['ignore', 'pipe', 'pipe'], // stdin 상속 금지 — TTY 프롬프트를 뺏기지 않도록
      });
    } catch (e) {
      return reject(new ClaudeMissingError(claudeMissingMsg(bin)));
    }

    let out = '', errOut = '', settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref();
      reject(new ClaudeRunError(`claude 응답이 ${timeout / 1000}초 안에 오지 않았습니다. 원문을 줄여서 다시 시도해 보세요.`, out));
    }, timeout);

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { errOut += d; });

    child.on('error', (e) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(e.code === 'ENOENT' ? new ClaudeMissingError(claudeMissingMsg(bin))
        : new ClaudeRunError(`claude 실행 실패: ${e.message}`, out));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        return reject(new ClaudeRunError(
          `claude 가 종료 코드 ${code} 로 끝났습니다.${errOut.trim() ? `\n${errOut.trim()}` : ''}`, out));
      }
      resolve(out);
    });
  });
}

function claudeMissingMsg(bin) {
  return `\`${bin}\` 를 PATH 에서 찾을 수 없습니다.\n` +
    '  · Claude Code CLI 가 설치돼 있는지 확인: which claude\n' +
    '  · 없으면 설치: npm i -g @anthropic-ai/claude-code\n' +
    '  · 다른 경로에 있으면 .env 에 ZUN_CLAUDE_BIN=/path/to/claude 를 넣으세요.';
}

/** 출력에서 첫 ```json 블록을 꺼낸다. 없으면 첫 { ~ 마지막 } 로 폴백. */
export function extractJson(text) {
  const fenced = text.match(/```json\s*\n([\s\S]*?)```/i) || text.match(/```\s*\n(\{[\s\S]*?)```/);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  const first = text.indexOf('{'), last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  let lastErr = null;
  for (const c of candidates) {
    try { return JSON.parse(c); } catch (e) { lastErr = e; }
  }
  throw new JsonExtractError(
    `응답에서 JSON 을 읽지 못했습니다${lastErr ? ` (${lastErr.message})` : ''}.`, text);
}

/** 파싱 결과를 DB 에 넣기 좋은 모양으로 정규화. */
export function normalize(parsed) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    activities: arr(parsed?.activities).filter((a) => a && a.slug).map((a) => ({
      slug: String(a.slug).trim().toLowerCase(),
      name: a.name ?? a.slug,
      org: a.org ?? null,
      status: a.status ?? '시작예정',
      start_date: a.start_date || null,
      end_date: a.end_date || null,
      cadence: a.cadence ?? null,
      channels: arr(a.channels).map(String),
      completion: a.completion ?? null,
      reward: a.reward ?? null,
    })),
    items: arr(parsed?.items).filter((i) => i && i.title).map((i) => ({
      activity_slug: i.activity_slug ? String(i.activity_slug).trim().toLowerCase() : null,
      title: String(i.title).trim(),
      kind: i.kind ?? '마감',
      due_at: i.due_at || null,
      due_end: i.due_end || null,
      all_day: Boolean(i.all_day),
      stage: i.stage ?? '기획',
      required: i.required === undefined ? true : Boolean(i.required),
      memo: i.memo ?? null,
      conflict_why: i.conflict_why || null,
    })),
    notes: arr(parsed?.notes).map(String),
  };
}

/** 프롬프트 → claude → JSON. */
export async function parseWithClaude(prompt, opts = {}) {
  const raw = await runClaude(prompt, opts);
  return { raw, parsed: normalize(extractJson(raw)) };
}
