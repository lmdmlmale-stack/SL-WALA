(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Login page                                                          */
  /* ------------------------------------------------------------------ */

  function initLogin() {
    const form = document.getElementById('login-form');
    const alertBox = document.getElementById('alert');
    if (!form) return;

    App.api('/api/admin/session')
      .then((data) => { if (data.authenticated) window.location.href = '/admin/dashboard'; })
      .catch(() => {});

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.className = 'alert';

      const username = form.username.value.trim();
      const password = form.password.value;

      if (!username || !password) {
        alertBox.textContent = 'Enter a username and password.';
        alertBox.className = 'alert error show';
        return;
      }

      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Signing in…';

      try {
        await App.api('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        window.location.href = '/admin/dashboard';
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.className = 'alert error show';
        button.disabled = false;
        button.textContent = 'Sign in';
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Dashboard                                                           */
  /* ------------------------------------------------------------------ */

  function uploadWithProgress(url, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.withCredentials = true;
      xhr.responseType = 'json';

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      xhr.addEventListener('load', () => {
        const body = xhr.response || {};
        if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
        reject(new Error(body.error || 'Upload failed (' + xhr.status + ')'));
      });

      xhr.addEventListener('error', () => reject(new Error('Network error during upload.')));
      xhr.addEventListener('abort', () => reject(new Error('Upload cancelled.')));

      xhr.send(formData);
    });
  }

  function showAlert(el, message, kind) {
    el.textContent = message;
    el.className = 'alert ' + kind + ' show';
    if (kind === 'ok') {
      clearTimeout(el._timer);
      el._timer = setTimeout(() => { el.className = 'alert'; }, 4500);
    }
  }

  function initDashboard() {
    if (!document.getElementById('dashboard')) return;

    const alertBox = document.getElementById('alert');

    /* ---- Logout ---- */
    document.getElementById('logout-btn').addEventListener('click', async () => {
      try { await App.api('/api/admin/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
      window.location.href = '/admin';
    });

    /* ---- Tabs ---- */
    const tabs = Array.from(document.querySelectorAll('.tab-btn'));
    const panels = Array.from(document.querySelectorAll('.tab-panel'));

    function activateTab(name) {
      tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
      panels.forEach((p) => { p.style.display = p.dataset.panel === name ? '' : 'none'; });
      if (name === 'library') loadLibrary();
    }

    tabs.forEach((t) => t.addEventListener('click', () => activateTab(t.dataset.tab)));
    activateTab('video');

    /* ------------------------------------------------------------------ */
    /* Video upload                                                        */
    /* ------------------------------------------------------------------ */

    const videoForm = document.getElementById('video-form');
    const videoProgress = document.getElementById('video-progress');
    const videoProgressBar = videoProgress.querySelector('span');

    videoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.className = 'alert';

      const fileInput = videoForm.querySelector('input[name="video"]');
      const file = fileInput.files[0];

      if (!file) {
        showAlert(alertBox, 'Select a video file first.', 'error');
        return;
      }
      if (!videoForm.title.value.trim()) {
        showAlert(alertBox, 'A title is required.', 'error');
        return;
      }

      const fd = new FormData();
      fd.append('video', file);
      const thumb = videoForm.querySelector('input[name="thumbnail"]').files[0];
      if (thumb) fd.append('thumbnail', thumb);
      fd.append('title', videoForm.title.value.trim());
      fd.append('description', videoForm.description.value.trim());
      fd.append('category', videoForm.category.value.trim() || 'Uncategorised');
      fd.append('published', videoForm.published.checked ? 'true' : 'false');

      const button = videoForm.querySelector('button[type="submit"]');
      button.disabled = true;
      videoProgress.classList.add('show');
      videoProgressBar.style.width = '0%';

      try {
        const result = await uploadWithProgress('/api/admin/media/video', fd, (pct) => {
          videoProgressBar.style.width = pct + '%';
        });
        showAlert(alertBox, 'Video published: ' + result.item.title, 'ok');
        videoForm.reset();
      } catch (err) {
        showAlert(alertBox, err.message, 'error');
      } finally {
        button.disabled = false;
        setTimeout(() => {
          videoProgress.classList.remove('show');
          videoProgressBar.style.width = '0%';
        }, 700);
      }
    });

    /* ------------------------------------------------------------------ */
    /* Photo upload                                                        */
    /* ------------------------------------------------------------------ */

    const photoForm = document.getElementById('photo-form');
    const photoInput = document.getElementById('photo-input');
    const photoList = document.getElementById('photo-list');
    const photoProgress = document.getElementById('photo-progress');
    const photoProgressBar = photoProgress.querySelector('span');
    let selectedPhotos = [];

    function renderPhotoRows() {
      photoList.innerHTML = selectedPhotos.map((entry, i) =>
        '<div class="photo-row">' +
          '<img class="preview" src="' + entry.url + '" alt="">' +
          '<div class="fields">' +
            '<input class="input" data-idx="' + i + '" data-key="title" ' +
              'placeholder="Title" value="' + App.escapeHtml(entry.title) + '">' +
            '<input class="input" data-idx="' + i + '" data-key="category" ' +
              'placeholder="Category" value="' + App.escapeHtml(entry.category) + '">' +
            '<input class="input" data-idx="' + i + '" data-key="description" ' +
              'placeholder="Description (optional)" value="' + App.escapeHtml(entry.description) + '">' +
          '</div>' +
        '</div>'
      ).join('');

      photoList.querySelectorAll('input').forEach((input) => {
        input.addEventListener('input', () => {
          const idx = Number(input.dataset.idx);
          selectedPhotos[idx][input.dataset.key] = input.value;
        });
      });
    }

    photoInput.addEventListener('change', () => {
      selectedPhotos = Array.from(photoInput.files).map((file) => ({
        file,
        url: URL.createObjectURL(file),
        title: file.name.replace(/\.[^.]+$/, ''),
        category: '',
        description: ''
      }));
      renderPhotoRows();
    });

    photoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.className = 'alert';

      if (selectedPhotos.length === 0) {
        showAlert(alertBox, 'Select at least one photo.', 'error');
        return;
      }

      const defaultCategory = photoForm.category.value.trim();
      const fd = new FormData();

      selectedPhotos.forEach((entry, i) => {
        fd.append('photos', entry.file);
        fd.append('title_' + i, entry.title || entry.file.name);
        fd.append('description_' + i, entry.description || '');
        fd.append('category_' + i, entry.category || defaultCategory || 'Uncategorised');
        fd.append('published_' + i, photoForm.published.checked ? 'true' : 'false');
      });

      const button = photoForm.querySelector('button[type="submit"]');
      button.disabled = true;
      photoProgress.classList.add('show');
      photoProgressBar.style.width = '0%';

      try {
        const result = await uploadWithProgress('/api/admin/media/photos', fd, (pct) => {
          photoProgressBar.style.width = pct + '%';
        });
        showAlert(alertBox, result.items.length + ' photo(s) published.', 'ok');
        photoForm.reset();
        selectedPhotos = [];
        photoList.innerHTML = '';
      } catch (err) {
        showAlert(alertBox, err.message, 'error');
      } finally {
        button.disabled = false;
        setTimeout(() => {
          photoProgress.classList.remove('show');
          photoProgressBar.style.width = '0%';
        }, 700);
      }
    });

    /* ------------------------------------------------------------------ */
    /* Library                                                             */
    /* ------------------------------------------------------------------ */

    const tbody = document.getElementById('media-rows');
    const editDialog = document.getElementById('edit-dialog');
    const editForm = document.getElementById('edit-form');
    let library = [];

    async function loadLibrary() {
      tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted);padding:22px">Loading…</td></tr>';
      try {
        const data = await App.api('/api/admin/media');
        library = data.items || [];
        renderLibrary();
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding:22px">' + App.escapeHtml(err.message) + '</td></tr>';
      }
    }

    function renderLibrary() {
      if (library.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted);padding:26px">No media yet.</td></tr>';
        return;
      }

      tbody.innerHTML = library.map((item) =>
        '<tr data-id="' + item.id + '">' +
          '<td><img class="thumb-cell" src="' +
            App.escapeHtml(item.thumbUrl || App.placeholder(item.type)) + '" alt=""></td>' +
          '<td>' + App.escapeHtml(item.title) + '</td>' +
          '<td style="text-transform:capitalize;color:var(--muted)">' + item.type + '</td>' +
          '<td>' + App.escapeHtml(item.category) + '</td>' +
          '<td><span class="pill ' + (item.published ? 'on' : 'off') + '">' +
            (item.published ? 'Published' : 'Draft') + '</span></td>' +
          '<td><div class="row-actions">' +
            '<button data-act="toggle">' + (item.published ? 'Unpublish' : 'Publish') + '</button>' +
            '<button data-act="edit">Edit</button>' +
            '<button data-act="delete" class="del">Delete</button>' +
          '</div></td>' +
        '</tr>'
      ).join('');
    }

    tbody.addEventListener('click', async (e) => {
      const button = e.target.closest('button[data-act]');
      if (!button) return;

      const row = button.closest('tr');
      const id = Number(row.dataset.id);
      const item = library.find((m) => m.id === id);
      if (!item) return;

      const act = button.dataset.act;

      if (act === 'toggle') {
        button.disabled = true;
        try {
          await App.api('/api/admin/media/' + id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ published: !item.published })
          });
          showAlert(alertBox, 'Updated "' + item.title + '".', 'ok');
          loadLibrary();
        } catch (err) {
          showAlert(alertBox, err.message, 'error');
          button.disabled = false;
        }
      }

      if (act === 'delete') {
        if (!window.confirm('Delete "' + item.title + '" permanently? The file will be removed from disk.')) return;
        button.disabled = true;
        try {
          await App.api('/api/admin/media/' + id, { method: 'DELETE' });
          showAlert(alertBox, 'Deleted "' + item.title + '".', 'ok');
          loadLibrary();
        } catch (err) {
          showAlert(alertBox, err.message, 'error');
          button.disabled = false;
        }
      }

      if (act === 'edit') {
        editForm.dataset.id = String(id);
        editForm.e_title.value = item.title;
        editForm.e_description.value = item.description;
        editForm.e_category.value = item.category;
        editForm.e_published.checked = item.published;
        editDialog.showModal();
      }
    });

    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = editForm.dataset.id;
      const button = editForm.querySelector('button[type="submit"]');
      button.disabled = true;

      try {
        await App.api('/api/admin/media/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: editForm.e_title.value.trim(),
            description: editForm.e_description.value.trim(),
            category: editForm.e_category.value.trim() || 'Uncategorised',
            published: editForm.e_published.checked
          })
        });
        editDialog.close();
        showAlert(alertBox, 'Changes saved.', 'ok');
        loadLibrary();
      } catch (err) {
        showAlert(alertBox, err.message, 'error');
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById('edit-cancel').addEventListener('click', () => editDialog.close());
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page === 'admin-login') initLogin();
    if (document.body.dataset.page === 'admin-dashboard') initDashboard();
  });
})();