// 브라우저와 Node 가 같은 파일을 쓴다. 실제 구현은 public/lib/dates.mjs 에 있다.
// Cloudflare Pages 가 public/ 을 그대로 서빙하므로 대시보드도 import 할 수 있고,
// 빌드 스텝 없이 원본이 하나로 유지된다.
export * from '../../public/lib/dates.mjs';
