# Analytics proxy

Ad blockers (uBlock Origin, Brave, Firefox strict mode) block PostHog's own hosts, which hides a large share of
visitors. This Cloudflare Worker forwards PostHog traffic from a neutral address that blockers don't list.

## Setup (about 5 minutes, free)

1. Sign in at https://dash.cloudflare.com (a free account is enough).
2. **Workers & Pages → Create → Create Worker.** Pick a neutral name without "posthog", "analytics" or
   "track" in it, for example `forest-data`. Deploy the hello-world worker.
3. **Edit code**, replace everything with the contents of `worker.js`, then **Deploy**.
4. Copy the worker's address, for example `https://forest-data.<your-subdomain>.workers.dev`.
5. In `analytics.js`, set `var PROXY = 'https://forest-data.<your-subdomain>.workers.dev';` (no trailing
   slash), bump the `?v=` in `index.html`, and deploy the site.

Check: open the site, then in the browser's network tab, requests should go to the worker address and return 200.
