(function () {
  'use strict';

  const App = {};

  const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  App.escapeHtml = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
  };

  App.formatDate = function (iso) {
    if (!iso) return '';
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  App.formatSize = function (bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
    return n.toFixed(n >= 10 || i === 0 ? 0 : 1) + ' ' + units[i];
  };

  App.api = async function (url, options) {
    const opts = Object.assign({ credentials: 'same-origin' }, options || {});
    opts.headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});

    const res = await fetch(url, opts);

    if (res.status === 403) {
      window.location.href = '/age-gate';
      throw new Error('Age confirmation required.');
    }

    let data = {};
    try { data = await res.json(); } catch (_) { /* empty body */ }

    if (!res.ok) {
      const err = new Error(data.error || 'Request failed (' + res.status + ')');
      err.status = res.status;
      throw err;
    }
    return data;
  };

  App.placeholder = function (label) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">' +
      '<rect width="100%" height="100%" fill="#161622"/>' +
      '<text x="50%" y="50%" fill="#4a4a66" font-family="sans-serif" font-size="14" ' +
      'text-anchor="middle" dominant-baseline="middle">' + App.escapeHtml(label) + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };

  App.card = function (item) {
    const isVideo = item.type === 'video';
    const thumb = item.thumbUrl || App.placeholder(isVideo ? 'No thumbnail' : 'No image');
    const href = '/viewer?id=' + encodeURIComponent(item.id);

    return (
      '<a class="card" href="' + href + '">' +
        '<div class="card-thumb">' +
          '<img src="' + App.escapeHtml(thumb) + '" alt="" loading="lazy">' +
          '<span class="badge">' + (isVideo ? 'Video' : 'Photo') + '</span>' +
          (isVideo ? '<span class="play-mark">&#9654;</span>' : '') +
        '</div>' +
        '<div class="card-body">' +
          '<h3 class="card-title">' + App.escapeHtml(item.title) + '</h3>' +
          '<p class="card-meta">' +
            '<span>' + App.escapeHtml(item.category) + '</span>' +
            '<span>&middot;</span>' +
            '<span>' + App.escapeHtml(App.formatDate(item.createdAt)) + '</span>' +
          '</p>' +
        '</div>' +
      '</a>'
    );
  };

  App.renderGrid = function (container, items, emptyMessage) {
    if (!container) return;
    if (!items || items.length === 0) {
      container.innerHTML = '<div class="empty">' + App.escapeHtml(emptyMessage || 'Nothing here yet.') + '</div>';
      return;
    }
    container.innerHTML = items.map(App.card).join('');
  };

  App.skeletonGrid = function (container, count) {
    if (!container) return;
    container.innerHTML = new Array(count || 8).fill('<div class="skeleton"></div>').join('');
  };

  App.initHeader = function () {
    const path = window.location.pathname;
    document.querySelectorAll('.nav a').forEach((link) => {
      if (link.getAttribute('href') === path) link.classList.add('active');
    });

    const search = document.querySelector('[data-global-search]');
    if (search) {
      search.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const q = search.value.trim();
        const target = path === '/photos' ? '/photos' : path === '/videos' ? '/videos' : '/videos';
        window.location.href = target + (q ? '?q=' + encodeURIComponent(q) : '');
      });
    }
  };

  window.App = App;
  document.addEventListener('DOMContentLoaded', App.initHeader);
})();