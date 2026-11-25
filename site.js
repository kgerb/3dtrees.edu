// ForestVerse: tabs via URL hash, DE/EN switch. No build step, no dependencies.
(function () {
  var TABS = ['project', 'education', 'about'];
  var root = document.documentElement;

  // ---- Language ----
  function setLang(lang, save) {
    root.lang = lang;
    document.querySelectorAll('[data-set-lang]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.setLang === lang));
    });
    // SVG text and other attribute-translated nodes
    document.querySelectorAll('[data-de][data-en]').forEach(function (el) {
      el.textContent = el.dataset[lang];
    });
    var nav = document.querySelector('.tabs');
    if (nav) nav.setAttribute('aria-label', lang === 'de' ? 'Hauptnavigation' : 'Main navigation');
    if (save) { try { localStorage.setItem('fv-lang', lang); } catch (e) {} }
    setTitle();
  }
  document.querySelectorAll('[data-set-lang]').forEach(function (b) {
    b.addEventListener('click', function () { setLang(b.dataset.setLang, true); });
  });

  // ---- Tabs ----
  var TITLES = {
    de: { project: 'ForestVerse – Jeder Wald, nur ein Klick entfernt', education: 'Bildung · ForestVerse', about: 'Über uns · ForestVerse' },
    en: { project: 'ForestVerse – Every forest, just one click away', education: 'Education · ForestVerse', about: 'About · ForestVerse' }
  };
  var current = 'project';
  function setTitle() { document.title = TITLES[root.lang === 'en' ? 'en' : 'de'][current]; }

  function showTab(id, focus) {
    if (TABS.indexOf(id) < 0) id = 'project';
    current = id;
    document.querySelectorAll('[data-tab]').forEach(function (p) { p.hidden = p.dataset.tab !== id; });
    document.querySelectorAll('.tabs [data-tab-link]').forEach(function (a) {
      if (a.dataset.tabLink === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    setTitle();
    if (focus) window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', function () { showTab(location.hash.slice(1), true); });

  // Hide image slots whose file is not there yet, so placeholders show instead.
  document.querySelectorAll('.shot img, .avatar img').forEach(function (img) {
    function miss() { img.classList.add('missing'); }
    if (img.complete && img.naturalWidth === 0) miss();
    img.addEventListener('error', miss);
  });

  setLang(root.lang === 'en' ? 'en' : 'de', false);
  showTab(location.hash.slice(1), false);
})();
