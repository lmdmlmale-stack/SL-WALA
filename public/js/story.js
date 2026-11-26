(function () {
  'use strict';

  const hero = document.getElementById('hero');
  const meta = document.getElementById('meta');
  const bodyEl = document.getElementById('body');

  const id = new URLSearchParams(location.search).get('id');

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  if (!id) {
    bodyEl.innerHTML = '<div class="empty">No story selected.</div>';
    return;
  }

  fetch('stories.json')
    .then((r) => r.json())
    .then((all) => {
      const s = all.find((x) => x.slug === id);
      if (!s) {
        bodyEl.innerHTML = '<div class="empty">Story not found.</div>';
        return;
      }

      document.title = s.title;

      if (s.thumb) hero.innerHTML = '<img src="' + escapeHtml(s.thumb) + '" alt="">';

      meta.innerHTML =
        '<h1>' + escapeHtml(s.title) + '</h1>' +
        '<p class="card-meta"><span>' + escapeHtml(s.category || '') + '</span>' +
        '<span>&middot;</span><span>' + escapeHtml(s.date || '') + '</span></p>';

      bodyEl.innerHTML = String(s.body || '')
        .split(/\n{2,}/)
        .map((p) => '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>')
        .join('');
    })
    .catch(() => {
      bodyEl.innerHTML = '<div class="empty">Could not load story.</div>';
    });
})();