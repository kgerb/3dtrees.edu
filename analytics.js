// ForestVerse analytics: PostHog (EU servers). Other scripts call fvTrack(event, props) at any time; events wait
// in a queue until PostHog has loaded. With no key set below, nothing loads and nothing is sent.
//
// Privacy: without consent PostHog counts visits cookieless (no cookies, nothing stored in the browser, a
// daily-rotating hash on PostHog's side). Only a visitor who taps "Yes" on the small notice gets a PostHog
// cookie and session replays (mouse and clicks, not the 3D canvas). The choice is kept in localStorage.
(function () {
  var POSTHOG_KEY = 'phc_vNw7fK9nL2QGmaUtnQbb7now5WxRKygGE6uag7FfgmuW'; // project API key (phc_...): public by design, safe in client code
  var POSTHOG_HOST = 'https://eu.i.posthog.com';
  var queue = [];
  window.fvTrack = function (event, props) { if (queue) queue.push([event, props || {}]); else if (window.posthog) window.posthog.capture(event, props || {}); };
  // ?notrack sends nothing; automated browsers (test runs) send nothing unless ?track=1
  if (!POSTHOG_KEY || /[?&]notrack\b/.test(location.search) || (navigator.webdriver && !/[?&]track=1\b/.test(location.search))) { queue = null; window.fvTrack = function () {}; return; }

  var CONSENT_KEY = 'fv-consent', consent = null;
  try { consent = localStorage.getItem(CONSENT_KEY); } catch (e) {}

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
      opt_out_capturing_by_default: consent !== 'yes',
      capture_pageview: false,               // tabs are hashes: site.js sends one $pageview per tab
      capture_pageleave: true,
      autocapture: true,
      capture_performance: true,             // page load timings (web vitals)
      session_recording: { maskAllInputs: true },
      disable_session_recording: consent !== 'yes'
    });
    if (consent === 'yes') ph.opt_in_capturing();
    var q = queue; queue = null;
    q.forEach(function (e) { ph.capture(e[0], e[1]); });
  };
  document.head.appendChild(s);

  // The consent notice: small, bottom left, after a few seconds, once.
  if (consent) return;
  setTimeout(function () {
    var de = document.documentElement.lang !== 'en';
    var box = document.createElement('div');
    box.className = 'consent';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', de ? 'Einwilligung' : 'Consent');
    box.innerHTML = '<p>' + (de
      ? 'Dürfen wir deinen Besuch anonym aufzeichnen, damit wir ForestVerse verbessern können? Ohne Zustimmung zählen wir nur ohne Cookies.'
      : 'May we record your visit anonymously to improve ForestVerse? Without consent we only count, without cookies.') + '</p>' +
      '<button type="button" data-c="yes">' + (de ? 'Ja' : 'Yes') + '</button><button type="button" data-c="no">' + (de ? 'Nein' : 'No') + '</button>';
    box.addEventListener('click', function (e) {
      var c = e.target && e.target.dataset && e.target.dataset.c; if (!c) return;
      try { localStorage.setItem(CONSENT_KEY, c); } catch (err) {}
      var ph = window.posthog;
      if (ph && ph.__loaded) {
        if (c === 'yes') { ph.opt_in_capturing(); ph.set_config({ disable_session_recording: false }); ph.startSessionRecording && ph.startSessionRecording(); }
        else ph.opt_out_capturing();
      } else consent = c;
      box.remove();
    });
    document.body.appendChild(box);
  }, 4000);
})();
