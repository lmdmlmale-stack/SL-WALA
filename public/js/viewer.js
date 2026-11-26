(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', async () => {
    const stage = document.getElementById('stage');
    const meta = document.getElementById('meta');
    const sideList = document.getElementById('side-list');
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');

    if (!id) {
      stage.innerHTML = '<div class="empty">No media selected.</div>';
      return;
    }

    let item;
    try {
      item = await App.api('/api/media/' + encodeURIComponent(id));
    } catch (err) {
      stage.innerHTML = '<div class="empty">' + App.escapeHtml(err.message) + '</div>';
      return;
    }

    if (item.type === 'video') {
      const poster = item.thumbUrl ? ' poster="' + App.escapeHtml(item.thumbUrl) + '"' : '';
      stage.innerHTML =
        '<video controls autoplay playsinline' + poster + '>' +
        '<source src="' + App.escapeHtml(item.fileUrl) + '" type="' + App.escapeHtml(item.mime || 'video/mp4') + '">' +
        'Your browser cannot play this video.' +
        '</video>';
    } else {
      stage.innerHTML =
        '<img src="' + App.escapeHtml(item.fileUrl) + '" alt="' + App.escapeHtml(item.title) + '">';
    }

    document.title = item.title + ' — Gallery';

    meta.innerHTML =
      '<h1>' + App.escapeHtml(item.title) + '</h1>' +
      '<p class="card-meta" style="margin-bottom:14px">' +
        '<span>' + App.escapeHtml(item.category) + '</span>' +
        '<span>&middot;</span>' +
        '<span>' + App.escapeHtml(App.formatDate(item.createdAt)) + '</span>' +
        '<span>&middot;</span>' +
        '<span>' + App.escapeHtml(App.formatSize(item.size)) + '</span>' +
      '</p>' +
      (item.description
        ? '<p>' + App.escapeHtml(item.description) + '</p>'
        : '<p style="color:var(--muted)">No description.</p>');

    try {
      const related = await App.api(
        '/api/media?type=' + item.type + '&limit=8'
      );
      const others = (related.items || []).filter((m) => m.id !== item.id).slice(0, 6);
      sideList.innerHTML = others.length
        ? others.map((m) =>
            '<a class="side-item" href="/viewer?id=' + m.id + '">' +
              '<div class="thumb"><img src="' +
                App.escapeHtml(m.thumbUrl || App.placeholder('No image')) +
              '" alt="" loading="lazy"></div>' +
              '<div>' +
                '<h4>' + App.escapeHtml(m.title) + '</h4>' +
                '<span>' + App.escapeHtml(m.category) + '</span>' +
              '</div>' +
            '</a>'
          ).join('')
        : '<div class="empty" style="padding:28px 14px">Nothing else yet.</div>';
    } catch (_) { /* ignore */ }
  });
})();