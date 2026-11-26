// Inline editing of blog posts, only inside the claude.ai preview of this site.
// On GitHub Pages window.claude does not exist, so nothing here runs.
// Edits are saved to post-edits.json (key -> {from, html}); Claude bakes them into index.html.
(function () {
  if (!window.claude || typeof window.claude.use !== 'function') return;
  var FILE = 'post-edits.json';
  var SEL = 'h2 > span[lang], h3 > span[lang], p:not(.post-meta), h4';
  var L = {
    de: { edit: 'Beitrag bearbeiten', save: 'Speichern', cancel: 'Abbrechen', saving: 'Speichert …', saved: 'Gespeichert.', ro: 'Nur Lesezugriff: Bearbeiten ist hier nicht möglich.', fail: 'Speichern hat nicht geklappt. Bitte noch einmal versuchen.', none: 'Keine Änderungen.' },
    en: { edit: 'Edit post', save: 'Save', cancel: 'Cancel', saving: 'Saving …', saved: 'Saved.', ro: 'Read-only: editing is not possible here.', fail: 'Saving failed. Please try again.', none: 'No changes.' }
  };
  function t(k) { return L[document.documentElement.lang === 'en' ? 'en' : 'de'][k]; }
  function fields(post) {
    return Array.prototype.map.call(post.querySelectorAll(SEL), function (el, i) {
      return { el: el, key: post.id + ':' + i };
    });
  }

  // Keep only text, links and simple emphasis.
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function clean(node) {
    var out = '';
    node.childNodes.forEach(function (n) {
      if (n.nodeType === 3) { out += esc(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName.toLowerCase(), inner = clean(n);
      if (tag === 'br') out += '<br>';
      else if (tag === 'a') {
        var href = n.getAttribute('href') || '';
        out += /^(https:\/\/|mailto:|#)/.test(href) ? '<a href="' + esc(href) + '">' + inner + '</a>' : inner;
      }
      else if (tag === 'strong' || tag === 'b') out += '<strong>' + inner + '</strong>';
      else if (tag === 'em' || tag === 'i') out += '<em>' + inner + '</em>';
      else if (tag === 'div' || tag === 'p') out += (out ? '<br>' : '') + inner;
      else out += inner;
    });
    return out;
  }

  var edits = {}, artifact = null;

  function apply() {
    document.querySelectorAll('.post[id]').forEach(function (post) {
      fields(post).forEach(function (f) {
        var e = edits[f.key];
        if (e && f.el.innerHTML === e.from) { f.el.dataset.orig = e.from; f.el.innerHTML = e.html; }
      });
    });
  }

  function setup(post) {
    var bar = document.createElement('div');
    bar.className = 'post-edit-bar';
    var edit = document.createElement('button'), save = document.createElement('button'), cancel = document.createElement('button'), msg = document.createElement('span');
    edit.type = save.type = cancel.type = 'button';
    edit.className = 'post-edit-btn'; save.className = 'post-edit-btn primary'; cancel.className = 'post-edit-btn';
    msg.className = 'post-edit-msg'; msg.setAttribute('role', 'status');
    bar.append(edit, save, cancel, msg);
    post.insertBefore(bar, post.firstChild);
    var snapshot = null;

    function labels() { edit.textContent = t('edit'); save.textContent = t('save'); cancel.textContent = t('cancel'); }
    function mode(on) {
      post.classList.toggle('is-editing', on);
      edit.hidden = on; save.hidden = cancel.hidden = !on;
      fields(post).forEach(function (f) {
        if (on) { f.el.setAttribute('contenteditable', 'true'); } else { f.el.removeAttribute('contenteditable'); }
      });
    }
    labels();
    document.querySelectorAll('[data-set-lang]').forEach(function (b) { b.addEventListener('click', labels); });
    mode(false);

    edit.addEventListener('click', function () {
      msg.textContent = '';
      snapshot = fields(post).map(function (f) { return f.el.innerHTML; });
      mode(true);
      var first = post.querySelector('[contenteditable]:not([hidden])');
      if (first) first.focus();
    });
    cancel.addEventListener('click', function () {
      fields(post).forEach(function (f, i) { f.el.innerHTML = snapshot[i]; });
      mode(false); msg.textContent = '';
    });
    post.addEventListener('paste', function (e) {
      if (!post.classList.contains('is-editing')) return;
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
    });
    post.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.closest && e.target.closest('h2, h3, h4')) e.preventDefault();
    });

    save.addEventListener('click', function () {
      var next = Object.assign({}, edits), changed = 0;
      fields(post).forEach(function (f, i) {
        if (f.el.innerHTML === snapshot[i]) return;
        var html = clean(f.el), from = f.el.dataset.orig || snapshot[i];
        f.el.innerHTML = html;
        next[f.key] = { from: from, html: html };
        f.el.dataset.orig = from;
        changed++;
      });
      if (!changed) { mode(false); msg.textContent = t('none'); return; }
      save.disabled = cancel.disabled = true; msg.textContent = t('saving');
      var files = {}; files[FILE] = JSON.stringify(next, null, 1) + '\n';
      artifact.publish(files).then(function () {
        edits = next; mode(false); msg.textContent = t('saved');
      }).catch(function (err) {
        var code = err && err.code;
        if (code === 'conflict') return; // the view reloads to the newer version
        if (code === 'not_writer' || code === 'not_granted' || code === 'consent_required' || code === 'not_declared' || code === 'capability_disabled' || code === 'capability_removed') {
          mode(false); edit.disabled = true; msg.textContent = t('ro');
        } else { msg.textContent = t('fail'); }
      }).then(function () { save.disabled = cancel.disabled = false; });
    });
  }

  window.claude.use('artifact').then(function (a) {
    if (!a) return;
    artifact = a;
    return fetch(FILE, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (data) {
      edits = data && typeof data === 'object' ? data : {};
      apply();
      document.querySelectorAll('.post[id]').forEach(setup);
    });
  });
})();
