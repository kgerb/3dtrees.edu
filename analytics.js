// ForestVerse analytics: PostHog (EU servers). Other scripts call fvTrack(event, props) at any time; events wait
// in a queue until PostHog has loaded. With no key set below, nothing loads and nothing is sent.
//
// Privacy: every visit is captured with session replay (inputs masked; the 3D canvas is not recorded), as
// Kilian decided on 2026-11-26. PostHog keeps its ids in memory only: no cookies and nothing stored in the
// browser, so a visit ends when the tab closes. No consent notice is shown.
(function () {
  var POSTHOG_KEY = 'phc_vNw7fK9nL2QGmaUtnQbb7now5WxRKygGE6uag7FfgmuW'; // project API key (phc_...): public by design, safe in client code
  // Ad blockers block PostHog's own hosts. A proxy on a neutral address (tools/analytics-proxy) gets past
  // them: put its URL here, without a trailing slash. Empty = talk to PostHog directly.
  var PROXY = 'https://forest-data.ak-c-data-proxy.workers.dev';
  var POSTHOG_HOST = PROXY || 'https://eu.i.posthog.com';
  var queue = [];
  window.fvTrack = function (event, props) { if (queue) queue.push([event, props || {}]); else if (window.posthog) window.posthog.capture(event, props || {}); };
  // ?notrack sends nothing; automated browsers (test runs) send nothing unless ?track=1
  if (!POSTHOG_KEY || /[?&]notrack\b/.test(location.search) || (navigator.webdriver && !/[?&]track=1\b/.test(location.search))) { queue = null; window.fvTrack = function () {}; return; }

  var s = document.createElement('script');
  s.async = true; s.crossOrigin = 'anonymous';
  s.src = (PROXY || 'https://eu-assets.i.posthog.com') + '/static/array.js';
  s.onload = function () {
    var ph = window.posthog; if (!ph || !ph.init) return;
    ph.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      ui_host: 'https://eu.posthog.com',
      opt_out_useragent_filter: !!navigator.webdriver, // only reached with ?track=1, for testing
      defaults: '2025-05-24',
      persistence: 'memory',                 // no cookies, nothing written to the browser
      capture_pageview: false,               // tabs are hashes: site.js sends one $pageview per tab
      capture_pageleave: true,
      autocapture: true,
      capture_performance: true,             // page load timings (web vitals)
      session_recording: { maskAllInputs: true },
      disable_session_recording: false
    });
    var q = queue; queue = null;
    q.forEach(function (e) { ph.capture(e[0], e[1]); });
  };
  (document.head || document.documentElement).appendChild(s);

})();
