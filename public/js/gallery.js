(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.body.dataset.page;   // "videos" | "photos" | "home"
    const grid = document.getElementById('grid');
    if (!grid) return;

    const params = new URLSearchParams(window.location.search);
    const state = {
      type: page === 'photos' ? 'photo' : page === 'videos' ? 'video' : null,
      q: params.get('q') || '',
      category: params.get('category') || ''
    };

    const categoryBar = document.getElementById('categories');
    const searchInput = document.getElementById('page-search');

    if (searchInput) {
      searchInput.value = state.q;
      let timer = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          state.q = searchInput.value.trim();
          load();
        }, 280);
      });
    }

    function buildQuery() {
      const q = new URLSearchParams();
      if (state.type) q.set('type', state.type);
      if (state.q) q.set('q', state.q);
      if (state.category) q.set('category', state.category);
      q.set('limit', page === 'home' ? '12' : '60');
      return q.toString();
    }

    async function loadCategories() {
      if (!categoryBar) return;
      try {
        const data = await App.api('/api/categories' + (state.type ? '?type=' + state.type : ''));
        const cats = data.categories || [];
        const all = document.createElement('button');
        all.className = 'chip' + (state.category ? '' : ' active');
        all.textContent = 'All';
        all.addEventListener('click', () => { state.category = ''; load(); });

        categoryBar.innerHTML = '';
        categoryBar.appendChild(all);

        cats.forEach((cat) => {
          const btn = document.createElement('button');
          btn.className = 'chip' + (state.category === cat ? ' active' : '');
          btn.textContent = cat;
          btn.addEventListener('click', () => { state.category = cat; load(); });
          categoryBar.appendChild(btn);
        });
      } catch (_) { /* ignore */ }
    }

    async function load() {
      App.skeletonGrid(grid, page === 'home' ? 6 : 9);
      try {
        const data = await App.api('/api/media?' + buildQuery());
        App.renderGrid(
          grid,
          data.items,
          state.q ? 'No results for "' + state.q + '".' : 'No media published yet.'
        );
        if (categoryBar) {
          categoryBar.querySelectorAll('.chip').forEach((chip) => {
            const label = chip.textContent;
            chip.classList.toggle(
              'active',
              (label === 'All' && !state.category) || label === state.category
            );
          });
        }
      } catch (err) {
        grid.innerHTML = '<div class="empty">' + App.escapeHtml(err.message) + '</div>';
      }
    }

    loadCategories();
    load();
  });
})();