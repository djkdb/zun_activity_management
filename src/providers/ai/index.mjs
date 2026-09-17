// 파싱 provider. 지금은 claude CLI 하나뿐이고, 실패하면 규칙 기반으로 내려간다.
// 비즈니스 로직은 이 인터페이스만 보므로 provider 가 바뀌어도 위쪽이 안 깨진다.
import { parseWithClaude, ClaudeMissingError, ClaudeRunError, JsonExtractError, normalize } from '../../parse.mjs';
import { fallbackParse } from './fallback.mjs';

/**
 * @returns {{ parsed, raw, provider: 'claude'|'fallback', degraded: boolean, reason?: string }}
 */
export async function parseText({ prompt, rawText, activitySlug = null, now = new Date(), allowFallback = true }) {
  try {
    const { raw, parsed } = await parseWithClaude(prompt);
    return { parsed, raw, provider: 'claude', degraded: false };
  } catch (e) {
    const recoverable = e instanceof ClaudeMissingError
      || e instanceof ClaudeRunError
      || e instanceof JsonExtractError;
    if (!allowFallback || !recoverable) throw e;

    // AI 가 죽어도 CLI 전체가 멈추지는 않게 한다.
    const parsed = normalize(fallbackParse(rawText, { activitySlug, now }));
    return { parsed, raw: e.raw ?? '', provider: 'fallback', degraded: true, reason: e.message };
  }
}

export { ClaudeMissingError, ClaudeRunError, JsonExtractError };
