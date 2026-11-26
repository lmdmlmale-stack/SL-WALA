'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

const ROOT = __dirname;
const DB_DIR = path.join(ROOT, 'database');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const VIDEO_DIR = path.join(UPLOADS_DIR, 'videos');
const PHOTO_DIR = path.join(UPLOADS_DIR, 'photos');
const THUMB_DIR = path.join(UPLOADS_DIR, 'thumbnails');
const PUBLIC_DIR = path.join(ROOT, 'public');

for (const dir of [DB_DIR, VIDEO_DIR, PHOTO_DIR, THUMB_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const MAX_VIDEO_BYTES = 512 * 1024 * 1024; // 512 MB
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;  // 25 MB

/* ------------------------------------------------------------------ */
/* Database                                                            */
/* ------------------------------------------------------------------ */

const db = new Database(path.join(DB_DIR, 'media.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS admin (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS media (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL CHECK (type IN ('video','photo')),
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT 'Uncategorised',
    file_path   TEXT NOT NULL,
    thumb_path  TEXT,
    mime        TEXT,
    size        INTEGER NOT NULL DEFAULT 0,
    published   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_media_public
    ON media (published, type, created_at DESC);

  CREATE TABLE IF NOT EXISTS sessions (
    sid    TEXT PRIMARY KEY,
    sess   TEXT NOT NULL,
    expire INTEGER NOT NULL
  );
`);

/* ------------------------------------------------------------------ */
/* First-run admin bootstrap                                           */
/* ------------------------------------------------------------------ */

function bootstrapAdmin() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM admin').get();
  if (c > 0) return;

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const hash = bcrypt.hashSync(password, 12);

  db.prepare('INSERT INTO admin (username, password_hash) VALUES (?, ?)').run(username, hash);

  console.log('\n========================================================');
  console.log('  ADMIN ACCOUNT CREATED (shown only once)');
  console.log('  Username: ' + username);
  console.log('  Password: ' + password);
  console.log('  Change it any time with:  npm run create-admin');
  console.log('========================================================\n');
}
bootstrapAdmin();

/* ------------------------------------------------------------------ */
/* Session secret persisted to disk so logins survive restarts         */
/* ------------------------------------------------------------------ */

const SECRET_FILE = path.join(DB_DIR, '.session-secret');
let SESSION_SECRET;
if (fs.existsSync(SECRET_FILE)) {
  SESSION_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
} else {
  SESSION_SECRET = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, SESSION_SECRET, { mode: 0o600 });
}

/* ------------------------------------------------------------------ */
/* SQLite-backed session store                                         */
/* ------------------------------------------------------------------ */

class SqliteStore extends session.Store {
  constructor(database) {
    super();
    this.db = database;
    this.stmtGet = database.prepare('SELECT sess FROM sessions WHERE sid = ? AND expire > ?');
    this.stmtSet = database.prepare(
      'INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?) ' +
      'ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire'
    );
    this.stmtDel = database.prepare('DELETE FROM sessions WHERE sid = ?');
    this.stmtTouch = database.prepare('UPDATE sessions SET expire = ? WHERE sid = ?');
    this.stmtClean = database.prepare('DELETE FROM sessions WHERE expire <= ?');

    const timer = setInterval(() => {
      try { this.stmtClean.run(Date.now()); } catch (_) { /* ignore */ }
    }, 15 * 60 * 1000);
    timer.unref();
  }

  get(sid, cb) {
    try {
      const row = this.stmtGet.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (err) { cb(err); }
  }

  set(sid, sess, cb) {
    try {
      const maxAge = (sess.cookie && sess.cookie.maxAge) || 86400000;
      this.stmtSet.run(sid, JSON.stringify(sess), Date.now() + maxAge);
      cb(null);
    } catch (err) { cb(err); }
  }

  destroy(sid, cb) {
    try { this.stmtDel.run(sid); cb(null); } catch (err) { cb(err); }
  }

  touch(sid, sess, cb) {
    try {
      const maxAge = (sess.cookie && sess.cookie.maxAge) || 86400000;
      this.stmtTouch.run(Date.now() + maxAge, sid);
      cb(null);
    } catch (err) { cb(err); }
  }
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

const app = express();
app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  store: new SqliteStore(db),
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,          // localhost over http
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

const isAgeConfirmed = (req) => req.session && req.session.ageVerified === true;
const isAdmin = (req) => !!(req.session && req.session.adminId);

function requireAgePage(req, res, next) {
  if (isAgeConfirmed(req)) return next();
  return res.redirect('/age-gate');
}

function requireAgeAsset(req, res, next) {
  if (isAgeConfirmed(req)) return next();
  return res.status(403).json({ error: 'Age confirmation required.' });
}

function requireAdminPage(req, res, next) {
  if (isAdmin(req)) return next();
  return res.redirect('/admin');
}

function requireAdminApi(req, res, next) {
  if (isAdmin(req)) return next();
  return res.status(401).json({ error: 'Not authenticated.' });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function serialize(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    category: row.category,
    size: row.size,
    mime: row.mime,
    published: !!row.published,
    createdAt: row.created_at,
    fileUrl: '/uploads/' + row.file_path,
    thumbUrl: row.thumb_path
      ? '/uploads/' + row.thumb_path
      : (row.type === 'photo' ? '/uploads/' + row.file_path : null)
  };
}

function unlinkUpload(relPath) {
  if (!relPath) return;
  const abs = path.resolve(UPLOADS_DIR, relPath);
  const base = path.resolve(UPLOADS_DIR) + path.sep;
  if (!abs.startsWith(base)) return; // traversal guard
  fs.promises.unlink(abs).catch(() => {});
}

function removeUploadedFiles(files) {
  if (!files) return;
  Object.values(files).flat().forEach((f) => {
    if (f && f.path) fs.promises.unlink(f.path).catch(() => {});
  });
}

function cleanText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/* ------------------------------------------------------------------ */
/* Upload configuration                                                */
/* ------------------------------------------------------------------ */

const VIDEO_EXT = new Set(['.mp4', '.webm', '.ogv', '.mov', '.m4v', '.mkv']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

function safeExt(originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '';
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    if (file.fieldname === 'video') return cb(null, VIDEO_DIR);
    if (file.fieldname === 'thumbnail') return cb(null, THUMB_DIR);
    return cb(null, PHOTO_DIR);
  },
  filename(req, file, cb) {
    const ext = safeExt(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_VIDEO_BYTES, files: 40, fields: 200 },
  fileFilter(req, file, cb) {
    const ext = safeExt(file.originalname);
    const mime = String(file.mimetype || '').toLowerCase();

    if (file.fieldname === 'video') {
      if (VIDEO_EXT.has(ext) && mime.startsWith('video/')) return cb(null, true);
      return cb(new Error('Unsupported video format. Allowed: ' + [...VIDEO_EXT].join(', ')));
    }

    if (IMAGE_EXT.has(ext) && mime.startsWith('image/')) return cb(null, true);
    return cb(new Error('Unsupported image format. Allowed: ' + [...IMAGE_EXT].join(', ')));
  }
});

function runUpload(fields) {
  const handler = upload.fields(fields);
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      removeUploadedFiles(req.files);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'One of the files is too large.' });
      }
      return res.status(400).json({ error: err.message || 'Upload failed.' });
    });
  };
}

/* ------------------------------------------------------------------ */
/* Static assets                                                       */
/* ------------------------------------------------------------------ */

app.use('/css', express.static(path.join(PUBLIC_DIR, 'css')));
app.use('/js', express.static(path.join(PUBLIC_DIR, 'js')));
app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets')));

app.use(
  '/uploads',
  requireAgeAsset,
  express.static(UPLOADS_DIR, {
    index: false,
    dotfiles: 'deny',
    fallthrough: false,
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
  })
);

/* ------------------------------------------------------------------ */
/* Age gate                                                            */
/* ------------------------------------------------------------------ */

app.post('/api/age/confirm', (req, res) => {
  const adult = req.body && req.body.adult === true;
  req.session.ageVerified = adult;
  res.json({ confirmed: adult });
});

app.get('/api/age/status', (req, res) => {
  res.json({ confirmed: isAgeConfirmed(req) });
});

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

app.get('/api/media', requireAgeAsset, (req, res) => {
  const type = req.query.type;
  const category = cleanText(req.query.category, 80);
  const q = cleanText(req.query.q, 120);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const where = ['published = 1'];
  const whereParams = {};

  if (type === 'video' || type === 'photo') {
    where.push('type = @type');
    whereParams.type = type;
  }
  if (category) {
    where.push('category = @category');
    whereParams.category = category;
  }
  if (q) {
    where.push('(title LIKE @q OR description LIKE @q)');
    whereParams.q = `%${q}%`;
  }

  const clause = where.join(' AND ');
  const rows = db.prepare(
    `SELECT * FROM media WHERE ${clause}
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT @limit OFFSET @offset`
  ).all({ ...whereParams, limit, offset });

  const { c: total } = db.prepare(
    `SELECT COUNT(*) AS c FROM media WHERE ${clause}`
  ).get(whereParams);

  res.json({ items: rows.map(serialize), total });
});

app.get('/api/categories', requireAgeAsset, (req, res) => {
  const type = req.query.type;
  const rows = (type === 'video' || type === 'photo')
    ? db.prepare('SELECT DISTINCT category FROM media WHERE published = 1 AND type = ?').all(type)
    : db.prepare('SELECT DISTINCT category FROM media WHERE published = 1').all();

  const categories = rows.map((r) => r.category).filter(Boolean).sort();
  res.json({ categories });
});

app.get('/api/media/:id', requireAgeAsset, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });

  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  if (!row.published && !isAdmin(req)) return res.status(404).json({ error: 'Not found.' });

  res.json(serialize(row));
});

/* ------------------------------------------------------------------ */
/* Admin auth                                                          */
/* ------------------------------------------------------------------ */

const loginAttempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.first > WINDOW_MS) {
    loginAttempts.set(ip, { first: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip || 'local';
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }

  const username = cleanText(req.body && req.body.username, 60);
  const password = String((req.body && req.body.password) || '');

  const admin = db.prepare('SELECT * FROM admin WHERE username = ?').get(username);
  const ok = admin && bcrypt.compareSync(password, admin.password_hash);

  if (!ok) return res.status(401).json({ error: 'Invalid username or password.' });

  const keepAge = isAgeConfirmed(req);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error.' });
    req.session.adminId = admin.id;
    req.session.username = admin.username;
    if (keepAge) req.session.ageVerified = true;
    res.json({ ok: true, username: admin.username });
  });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/session', (req, res) => {
  res.json({ authenticated: isAdmin(req), username: req.session.username || null });
});

/* ------------------------------------------------------------------ */
/* Admin media management                                              */
/* ------------------------------------------------------------------ */

app.get('/api/admin/media', requireAdminApi, (req, res) => {
  const type = req.query.type;
  const rows = (type === 'video' || type === 'photo')
    ? db.prepare('SELECT * FROM media WHERE type = ? ORDER BY datetime(created_at) DESC, id DESC').all(type)
    : db.prepare('SELECT * FROM media ORDER BY datetime(created_at) DESC, id DESC').all();

  res.json({ items: rows.map(serialize) });
});

app.post(
  '/api/admin/media/video',
  requireAdminApi,
  runUpload([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]),
  (req, res) => {
    const videoFile = req.files && req.files.video && req.files.video[0];
    const thumbFile = req.files && req.files.thumbnail && req.files.thumbnail[0];

    if (!videoFile) {
      removeUploadedFiles(req.files);
      return res.status(400).json({ error: 'A video file is required.' });
    }
    if (videoFile.size > MAX_VIDEO_BYTES) {
      removeUploadedFiles(req.files);
      return res.status(413).json({ error: 'Video exceeds the size limit.' });
    }

    const title = cleanText(req.body.title, 200);
    if (!title) {
      removeUploadedFiles(req.files);
      return res.status(400).json({ error: 'A title is required.' });
    }

    const description = cleanText(req.body.description, 4000);
    const category = cleanText(req.body.category, 80) || 'Uncategorised';
    const published = req.body.published === 'false' ? 0 : 1;

    const info = db.prepare(
      `INSERT INTO media (type, title, description, category, file_path, thumb_path, mime, size, published)
       VALUES ('video', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      title,
      description,
      category,
      path.join('videos', videoFile.filename),
      thumbFile ? path.join('thumbnails', thumbFile.filename) : null,
      videoFile.mimetype,
      videoFile.size,
      published
    );

    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ item: serialize(row) });
  }
);

app.post(
  '/api/admin/media/photos',
  requireAdminApi,
  runUpload([{ name: 'photos', maxCount: 20 }]),
  (req, res) => {
    const files = (req.files && req.files.photos) || [];

    if (files.length === 0) {
      removeUploadedFiles(req.files);
      return res.status(400).json({ error: 'At least one photo is required.' });
    }

    const oversized = files.find((f) => f.size > MAX_IMAGE_BYTES);
    if (oversized) {
      removeUploadedFiles(req.files);
      return res.status(413).json({ error: 'A photo exceeds the size limit.' });
    }

    const insert = db.prepare(
      `INSERT INTO media (type, title, description, category, file_path, thumb_path, mime, size, published)
       VALUES ('photo', ?, ?, ?, ?, NULL, ?, ?, ?)`
    );

    const created = [];
    const insertAll = db.transaction(() => {
      files.forEach((file, index) => {
        const title = cleanText(req.body['title_' + index], 200) || file.originalname;
        const description = cleanText(req.body['description_' + index], 4000);
        const category = cleanText(req.body['category_' + index], 80) || 'Uncategorised';
        const published = req.body['published_' + index] === 'false' ? 0 : 1;

        const info = insert.run(
          title,
          description,
          category,
          path.join('photos', file.filename),
          file.mimetype,
          file.size,
          published
        );
        created.push(info.lastInsertRowid);
      });
    });

    try {
      insertAll();
    } catch (err) {
      removeUploadedFiles(req.files);
      return res.status(500).json({ error: 'Could not save the photos.' });
    }

    const items = created.map((id) => serialize(db.prepare('SELECT * FROM media WHERE id = ?').get(id)));
    res.status(201).json({ items });
  }
);

app.patch('/api/admin/media/:id', requireAdminApi, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found.' });

  const title = req.body.title !== undefined ? cleanText(req.body.title, 200) : row.title;
  if (!title) return res.status(400).json({ error: 'A title is required.' });

  const description = req.body.description !== undefined
    ? cleanText(req.body.description, 4000)
    : row.description;

  const category = req.body.category !== undefined
    ? (cleanText(req.body.category, 80) || 'Uncategorised')
    : row.category;

  const published = req.body.published !== undefined
    ? (req.body.published ? 1 : 0)
    : row.published;

  db.prepare('UPDATE media SET title = ?, description = ?, category = ?, published = ? WHERE id = ?')
    .run(title, description, category, published, id);

  res.json({ item: serialize(db.prepare('SELECT * FROM media WHERE id = ?').get(id)) });
});

app.delete('/api/admin/media/:id', requireAdminApi, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found.' });

  db.prepare('DELETE FROM media WHERE id = ?').run(id);
  unlinkUpload(row.file_path);
  unlinkUpload(row.thumb_path);

  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

app.get('/age-gate', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'age-gate.html'));
});

app.get('/', requireAgePage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/videos', requireAgePage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'videos.html'));
});

app.get('/photos', requireAgePage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'photos.html'));
});

app.get('/viewer', requireAgePage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'viewer.html'));
});

app.get('/admin', (req, res) => {
  if (isAdmin(req)) return res.redirect('/admin/dashboard');
  res.sendFile(path.join(PUBLIC_DIR, 'admin', 'login.html'));
});

app.get('/admin/dashboard', requireAdminPage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin', 'dashboard.html'));
});

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

app.use((req, res) => {
  res.status(404).send('Not found');
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Server error.' });
});

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Site:  http://localhost:${PORT}`);
  console.log(`  Admin: http://localhost:${PORT}/admin\n`);
});