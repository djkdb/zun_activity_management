// Cloudflare Workers(Static Assets) 진입점.
//
// Pages 는 functions/ 디렉터리를 알아서 잡지만 Workers 는 그렇지 않다.
// 구현은 functions/calendar.ics.js 하나로 두고 여기서 불러 쓴다
// — 나중에 Pages 로 옮겨도 양쪽 다 그대로 돈다.
import { onRequestGet } from '../functions/calendar.ics.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/calendar.ics') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      }
      const res = await onRequestGet({ request, env });
      // HEAD 는 본문 없이 (아이폰이 구독 전 헤더만 확인할 때가 있다)
      return request.method === 'HEAD'
        ? new Response(null, { status: res.status, headers: res.headers })
        : res;
    }

    // 나머지는 정적 파일
    return env.ASSETS.fetch(request);
  },
};
