const express = require('express');
const path = require('path');
const session = require('express-session');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

const db = new Database(path.join(__dirname, 'data', 'faitout.db'));
db.pragma('journal_mode = WAL');

const uploadDir = path.join(__dirname, 'public', 'images', 'uploads');
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    cb(null, allowed.includes(file.mimetype));
  }
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'faitout-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 3600000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

initDatabase();

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS menu_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price REAL NOT NULL,
      is_menu_du_jour INTEGER DEFAULT 0,
      visible INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (category_id) REFERENCES menu_categories(id)
    );

    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      label TEXT DEFAULT '',
      image TEXT DEFAULT '',
      date TEXT DEFAULT (date('now')),
      visible INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const adminExists = db.prepare('SELECT COUNT(*) as c FROM admin').get();
  if (adminExists.c === 0) {
    const hash = bcrypt.hashSync('admin', 10);
    db.prepare('INSERT INTO admin (username, password) VALUES (?, ?)').run('admin', hash);
  }

  const catCount = db.prepare('SELECT COUNT(*) as c FROM menu_categories').get();
  if (catCount.c === 0) {
    const insertCat = db.prepare('INSERT INTO menu_categories (name, sort_order) VALUES (?, ?)');
    insertCat.run('Entrées', 1);
    insertCat.run('Plats', 2);
    insertCat.run('Desserts', 3);

    const insertItem = db.prepare(
      'INSERT INTO menu_items (category_id, name, description, price, is_menu_du_jour, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    );
    // Entrées — 5 €
    insertItem.run(1, 'Crème de fèves, falafel et sauce sésame', '', 5, 0, 1);
    insertItem.run(1, 'Pâté croûte du Faitout', '', 5, 0, 2);
    insertItem.run(1, 'Soupe de pot-au-feu', '', 5, 0, 3);
    // Plats — 13 €
    insertItem.run(2, 'Bouchée feuilletée au veau du Tonton', '', 13, 0, 1);
    insertItem.run(2, 'Œuf cocotte aux morilles du coin', '', 13, 0, 2);
    // Desserts — 5 €
    insertItem.run(3, 'Panier croquant de pommes confites, amandes et crème fouettée', '', 5, 0, 1);
    insertItem.run(3, 'Brownie aux noix, crème fouettée', '', 5, 0, 2);
    insertItem.run(3, 'Riz au lait, caramel, amandes', '', 5, 0, 3);
  }

  const newsCount = db.prepare('SELECT COUNT(*) as c FROM news').get();
  if (newsCount.c === 0) {
    db.prepare(
      'INSERT INTO news (title, content, label, image, date) VALUES (?, ?, ?, ?, ?)'
    ).run(
      'Cadavres Exquises — Vernissage & Concert',
      'Samedi 21 mars 2026. Vernissage de Aneth à 19h, concert « Polyphonies pour femmes mortes » à 20h. Apéro offert à 19h, petite restau sur place.',
      'Événement',
      '/images/uploads/cadavres-exquises.png',
      '2026-03-21'
    );
  }
}

// --- PUBLIC API ---

app.get('/api/menu', (req, res) => {
  const categories = db.prepare('SELECT * FROM menu_categories ORDER BY sort_order').all();
  const items = db.prepare('SELECT * FROM menu_items WHERE visible = 1 ORDER BY sort_order').all();
  const menuDuJour = items.filter(i => i.is_menu_du_jour);
  const byCategory = categories.map(cat => ({
    ...cat,
    items: items.filter(i => i.category_id === cat.id && !i.is_menu_du_jour)
  }));
  res.json({ categories: byCategory, menuDuJour });
});

app.get('/api/news', (req, res) => {
  const news = db.prepare('SELECT * FROM news WHERE visible = 1 ORDER BY date DESC LIMIT 6').all();
  res.json(news);
});

app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

// --- AUTH ---

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Non autorisé' });
}

app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admin WHERE username = ?').get(username);
  if (admin && bcrypt.compareSync(password, admin.password)) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Identifiants incorrects' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/auth/check', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

// --- ADMIN API ---

app.get('/api/admin/menu', requireAuth, (req, res) => {
  const categories = db.prepare('SELECT * FROM menu_categories ORDER BY sort_order').all();
  const items = db.prepare('SELECT * FROM menu_items ORDER BY sort_order').all();
  res.json({ categories, items });
});

app.post('/api/admin/menu/item', requireAuth, (req, res) => {
  const { category_id, name, description, price, is_menu_du_jour, sort_order } = req.body;
  const result = db.prepare(
    'INSERT INTO menu_items (category_id, name, description, price, is_menu_du_jour, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(category_id, name, description || '', price, is_menu_du_jour ? 1 : 0, sort_order || 0);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/admin/menu/item/:id', requireAuth, (req, res) => {
  const { category_id, name, description, price, is_menu_du_jour, visible, sort_order } = req.body;
  db.prepare(
    'UPDATE menu_items SET category_id=?, name=?, description=?, price=?, is_menu_du_jour=?, visible=?, sort_order=? WHERE id=?'
  ).run(category_id, name, description || '', price, is_menu_du_jour ? 1 : 0, visible ? 1 : 0, sort_order || 0, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/menu/item/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/menu/category', requireAuth, (req, res) => {
  const { name, sort_order } = req.body;
  const result = db.prepare('INSERT INTO menu_categories (name, sort_order) VALUES (?, ?)').run(name, sort_order || 0);
  res.json({ id: result.lastInsertRowid });
});

app.delete('/api/admin/menu/category/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM menu_items WHERE category_id = ?').run(req.params.id);
  db.prepare('DELETE FROM menu_categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/menu/replace', requireAuth, (req, res) => {
  const { categories: cats } = req.body;
  if (!Array.isArray(cats)) return res.status(400).json({ error: 'Format invalide' });

  const replaceAll = db.transaction(() => {
    db.prepare('DELETE FROM menu_items').run();
    db.prepare('DELETE FROM menu_categories').run();

    const insertCat = db.prepare('INSERT INTO menu_categories (name, sort_order) VALUES (?, ?)');
    const insertItem = db.prepare(
      'INSERT INTO menu_items (category_id, name, description, price, sort_order) VALUES (?, ?, ?, ?, ?)'
    );

    cats.forEach((cat, ci) => {
      const { lastInsertRowid: catId } = insertCat.run(cat.name, ci + 1);
      if (Array.isArray(cat.items)) {
        cat.items.forEach((item, ii) => {
          insertItem.run(catId, item.name, item.description || '', item.price, ii + 1);
        });
      }
    });
  });

  replaceAll();
  res.json({ ok: true });
});

// News CRUD
app.get('/api/admin/news', requireAuth, (req, res) => {
  const news = db.prepare('SELECT * FROM news ORDER BY date DESC').all();
  res.json(news);
});

app.post('/api/admin/news', requireAuth, (req, res) => {
  const { title, content, label, image, date } = req.body;
  const result = db.prepare(
    'INSERT INTO news (title, content, label, image, date) VALUES (?, ?, ?, ?, ?)'
  ).run(title, content, label || '', image || '', date || new Date().toISOString().split('T')[0]);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/admin/news/:id', requireAuth, (req, res) => {
  const { title, content, label, image, date, visible } = req.body;
  db.prepare(
    'UPDATE news SET title=?, content=?, label=?, image=?, date=?, visible=? WHERE id=?'
  ).run(title, content, label || '', image || '', date, visible ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/news/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM news WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Password change
app.post('/api/admin/password', requireAuth, (req, res) => {
  const { current, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 8 caractères.' });
  }
  const admin = db.prepare('SELECT * FROM admin LIMIT 1').get();
  if (!bcrypt.compareSync(current, admin.password)) {
    return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE admin SET password = ? WHERE id = ?').run(hash, admin.id);
  res.json({ ok: true });
});

// Upload image
app.post('/api/admin/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucune image valide' });
  res.json({ url: `/images/uploads/${req.file.filename}` });
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Le Faitout - serveur démarré sur http://localhost:${PORT}`);
});
