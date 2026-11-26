// ForestVerse analytics: PostHog (EU servers). Other scripts call fvTrack(event, props) at any time; events wait
// in a queue until PostHog has loaded. With no key set below, nothing loads and nothing is sent.
//
// Privacy: PostHog counts visits cookieless (no cookies, nothing stored in the browser, a daily-rotating hash
// on PostHog's side), so no consent notice is needed. Session replays would need consent and stay off for
// visitors. Opening the site once with ?rec=1 turns replays on in that browser (for the team's own visits;
// it is remembered), ?rec=0 turns them off again.
(function () {
  var POSTHOG_KEY = 'phc_vNw7fK9nL2QGmaUtnQbb7now5WxRKygGE6uag7FfgmuW'; // project API key (phc_...): public by design, safe in client code
  var POSTHOG_HOST = 'https://eu.i.posthog.com';
  var queue = [];
  window.fvTrack = function (event, props) { if (queue) queue.push([event, props || {}]); else if (window.posthog) window.posthog.capture(event, props || {}); };
  // ?notrack sends nothing; automated browsers (test runs) send nothing unless ?track=1
  if (!POSTHOG_KEY || /[?&]notrack\b/.test(location.search) || (navigator.webdriver && !/[?&]track=1\b/.test(location.search))) { queue = null; window.fvTrack = function () {}; return; }

  var rec = false, m = /[?&]rec=([01])\b/.exec(location.search);
  try { if (m) { if (m[1] === '1') localStorage.setItem('fv-rec', '1'); else localStorage.removeItem('fv-rec'); } rec = localStorage.getItem('fv-rec') === '1'; } catch (e) { rec = !!m && m[1] === '1'; }

  var s = document.createElement('script');
  s.async = true; s.crossOrigin = 'anonymous';
  s.src = POSTHOG_HOST.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js';
  s.onload = function () {
    var ph = window.posthog; if (!ph || !ph.init) return;
    ph.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      opt_out_useragent_filter: !!navigator.webdriver, // only reached with ?track=1, for testing
      defaults: '2025-05-24',
      cookieless_mode: 'on_reject',          // no consent: count without cookies
      opt_out_capturing_by_default: !rec,    // visitors stay cookieless; ?rec=1 opts this browser in
      capture_pageview: false,               // tabs are hashes: site.js sends one $pageview per tab
      capture_pageleave: true,
      autocapture: true,
      capture_performance: true,             // page load timings (web vitals)
      session_recording: { maskAllInputs: true },
      disable_session_recording: !rec
    });
    if (rec) { ph.opt_in_capturing(); ph.register({ team_visit: true }); if (ph.startSessionRecording) ph.startSessionRecording(); }
    var q = queue; queue = null;
    q.forEach(function (e) { ph.capture(e[0], e[1]); });
  };
  document.head.appendChild(s);

})();
