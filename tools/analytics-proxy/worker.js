// Cloudflare Worker: forwards the site's analytics to PostHog EU from a neutral address, so ad blockers
// that block PostHog's own hosts don't drop visits. Free plan is enough. Setup: README.md next to this file.
const API_HOST = 'eu.i.posthog.com';
const ASSET_HOST = 'eu-assets.i.posthog.com';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname + url.search;
    if (url.pathname.startsWith('/static/') || url.pathname.startsWith('/array/')) {
      // the library and its config: cached at the edge
      let res = await caches.default.match(request);
      if (!res) {
        res = await fetch('https://' + ASSET_HOST + path);
        if (res.ok) ctx.waitUntil(caches.default.put(request, res.clone()));
      }
      return res;
    }
    // events and replays: forwarded without cookies; the visitor's IP is passed on so countries still work
    const headers = new Headers(request.headers);
    headers.delete('cookie');
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) headers.set('X-Forwarded-For', ip);
    return fetch('https://' + API_HOST + path, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual'
    });
  }
};
