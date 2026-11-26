(function () {
  'use strict';

  const grid = document.getElementById('grid');
  const searchInput = document.getElementById('search');
  const categoryBar = document.getElementById('categories');

  let all = [];
  let query = '';
  let category = '';

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function card(s) {
    const thumb = s.thumb || '';
    return (
      '<a class="card" href="story.html?id=' + encodeURIComponent(s.slug) + '">' +
        '<div class="card-thumb">' +
          (thumb ? '<img src="' + escapeHtml(thumb) + '" alt="" loading="lazy">' : '') +
          '<span class="badge">' + escapeHtml(s.category || 'Story') + '</span>' +
        '</div>' +
        '<div class="card-body">' +
          '<h3 class="card-title">' + escapeHtml(s.title) + '</h3>' +
          '<p class="card-meta"><span>' + escapeHtml(s.date || '') + '</span></p>' +
        '</div>' +
      '</a>'
    );
  }

  function render() {
    const q = query.toLowerCase();
    const list = all.filter((s) => {
      const matchesCat = !category || s.category === category;
      const matchesQ = !q || (s.title + ' ' + (s.excerpt || '') + ' ' + (s.body || ''))
        .toLowerCase().includes(q);
      return matchesCat && matchesQ;
    });

    grid.innerHTML = list.length
      ? list.map(card).join('')
      : '<div class="empty">No stories match.</div>';
  }

  function buildCategories() {
    const cats = [...new Set(all.map((s) => s.category).filter(Boolean))].sort();
    categoryBar.innerHTML = '';

    const mk = (label, value) => {
      const b = document.createElement('button');
      b.className = 'chip' + (category === value ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', () => { category = value; buildCategories(); render(); });
      categoryBar.appendChild(b);
    };

    mk('All', '');
    cats.forEach((c) => mk(c, c));
  }

  searchInput.addEventListener('input', () => { query = searchInput.value.trim(); render(); });

  fetch('stories.json')
    .then((r) => r.json())
    .then((data) => {
      all = data.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      buildCategories();
      render();
    })
    .catch(() => {
      grid.innerHTML = '<div class="empty">Could not load stories.json.</div>';
    });
})();