/* OneUp backend — Node built-ins only (http, node:sqlite, node:crypto).
   Serves the static site AND a JSON API, persisting to oneup.db. */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DB = new DatabaseSync(path.join(ROOT, 'oneup.db'));

// --- schema -----------------------------------------------------------------
DB.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  name TEXT,
  email TEXT NOT NULL,
  pass TEXT NOT NULL,
  created_at TEXT,
  plan TEXT DEFAULT 'Commuter',
  km_used REAL DEFAULT 0,
  qualified INTEGER DEFAULT 0,
  veh_make TEXT,
  veh_year INTEGER,
  docs TEXT DEFAULT '[]',
  inspection INTEGER DEFAULT 0,
  background INTEGER DEFAULT 0,
  earnings_today INTEGER DEFAULT 0,
  tier TEXT DEFAULT 'Gold'
);
CREATE UNIQUE INDEX IF NOT EXISTS u_email_role ON users(email, role);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER, created_at TEXT
);
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, role TEXT, from_loc TEXT, to_loc TEXT,
  km REAL, amount INTEGER, created_at TEXT
);
CREATE TABLE IF NOT EXISTS admin_sessions ( token TEXT PRIMARY KEY, created_at TEXT );
`);

// migrate: add columns if an older oneup.db is missing them
function hasCol(t, c) { return DB.prepare(`PRAGMA table_info(${t})`).all().some(r => r.name === c); }
function ensureCol(t, c, def) { if (!hasCol(t, c)) DB.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); }
ensureCol('users', 'status', "TEXT DEFAULT 'incomplete'");  // incomplete | pending | approved | rejected
ensureCol('users', 'reject_reason', 'TEXT');
ensureCol('users', 'submitted_at', 'TEXT');

const ADMIN_KEY = process.env.ADMIN_KEY || 'oneup-admin';

const PLANS = {
  Lite:     { km: 280,  rate: 143, price: 40000,  used: 60 },
  Commuter: { km: 620,  rate: 129, price: 80000,  used: 93 },
  Pro:      { km: 1300, rate: 115, price: 150000, used: 160 }
};
const DOC_COUNT = 5;
const DRIVER_RATE = 120; // naira per km, 0% commission

// --- helpers ----------------------------------------------------------------
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(String(pw), salt, 64).toString('hex');
}
function verifyPw(pw, stored) {
  const [salt, h] = String(stored).split(':');
  const h2 = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  const a = Buffer.from(h, 'hex'), b = Buffer.from(h2, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function now() { return new Date().toISOString(); }

function clientUser(u) {
  const plan = PLANS[u.plan] || PLANS.Commuter;
  const docs = JSON.parse(u.docs || '[]');
  return {
    id: u.id, role: u.role, name: u.name, email: u.email,
    plan: u.plan, planKm: plan.km, rate: plan.rate, price: plan.price,
    kmUsed: u.km_used, kmLeft: Math.max(0, plan.km - u.km_used),
    qualified: !!u.qualified,
    vehicle: { make: u.veh_make || '', year: u.veh_year || null },
    docs: docs,
    docsDone: docs.length >= DOC_COUNT,
    inspection: !!u.inspection,
    background: !!u.background,
    earningsToday: u.earnings_today,
    tier: u.tier,
    status: u.status || 'incomplete',
    rejectReason: u.reject_reason || ''
  };
}
function adminDriver(u) {
  return {
    id: u.id, name: u.name, email: u.email, status: u.status || 'incomplete',
    vehicle: { make: u.veh_make || '', year: u.veh_year || null },
    eligible: !!(u.veh_year && u.veh_year >= 2018),
    docsCount: JSON.parse(u.docs || '[]').length, docsTotal: DOC_COUNT,
    inspection: !!u.inspection, background: !!u.background,
    submittedAt: u.submitted_at || null, rejectReason: u.reject_reason || '',
    qualified: !!u.qualified, earningsToday: u.earnings_today
  };
}
function authAdmin(req) {
  const t = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  return t && DB.prepare('SELECT token FROM admin_sessions WHERE token=?').get(t);
}
function getUser(id) { return DB.prepare('SELECT * FROM users WHERE id=?').get(id); }
function authUser(req) {
  const h = req.headers['authorization'] || '';
  const t = h.replace(/^Bearer\s+/i, '');
  if (!t) return null;
  const s = DB.prepare('SELECT user_id FROM sessions WHERE token=?').get(t);
  return s ? getUser(s.user_id) : null;
}
function makeSession(userId) {
  const t = newToken();
  DB.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(t, userId, now());
  return t;
}

// --- JSON responses ---------------------------------------------------------
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}

// --- API --------------------------------------------------------------------
async function api(req, res, url) {
  const p = url.pathname.replace(/^\/api/, '');
  const body = (req.method === 'POST') ? await readBody(req) : {};

  if (p === '/signup' && req.method === 'POST') {
    const { role, name, email, password, plan } = body;
    if (!role || !email || !password) return send(res, 400, { error: 'Missing fields.' });
    const exists = DB.prepare('SELECT id FROM users WHERE email=? AND role=?').get(email, role);
    if (exists) return send(res, 409, { error: 'An account with this email already exists for that role. Try signing in.' });
    const chosen = PLANS[plan] ? plan : 'Commuter';
    const info = DB.prepare(
      'INSERT INTO users(role,name,email,pass,created_at,plan,km_used) VALUES(?,?,?,?,?,?,?)'
    ).run(role, name || '', email, hashPw(password), now(), chosen, role === 'rider' ? PLANS[chosen].used : 0);
    const u = getUser(info.lastInsertRowid);
    return send(res, 200, { token: makeSession(u.id), user: clientUser(u) });
  }

  if (p === '/login' && req.method === 'POST') {
    const { role, email, password } = body;
    if (!role || !email || !password) return send(res, 400, { error: 'Missing fields.' });
    let u = DB.prepare('SELECT * FROM users WHERE email=? AND role=?').get(email, role);
    if (u) {
      if (!verifyPw(password, u.pass)) return send(res, 401, { error: 'Wrong password.' });
    } else {
      // Demo convenience: create the account on first sign-in.
      if (role === 'driver') {
        const info = DB.prepare(`INSERT INTO users(role,name,email,pass,created_at,qualified,veh_make,veh_year,docs,inspection,background,earnings_today,tier)
          VALUES(?,?,?,?,?,1,?,?,?,1,1,?,?)`).run('driver', 'Emeka Obi', email, hashPw(password), now(),
          'Toyota Corolla', 2020, JSON.stringify(['Driver\'s licence','Vehicle registration','Insurance certificate','Roadworthiness certificate','Proof the car is yours']), 18400, 'Gold');
        DB.prepare("UPDATE users SET status='approved' WHERE id=?").run(info.lastInsertRowid);
        u = getUser(info.lastInsertRowid);
      } else {
        const info = DB.prepare('INSERT INTO users(role,name,email,pass,created_at,plan,km_used) VALUES(?,?,?,?,?,?,?)')
          .run('rider', 'Ada Okeke', email, hashPw(password), now(), 'Commuter', PLANS.Commuter.used);
        u = getUser(info.lastInsertRowid);
      }
    }
    return send(res, 200, { token: makeSession(u.id), user: clientUser(u) });
  }

  // ---- admin ----
  if (p === '/admin/login' && req.method === 'POST') {
    if (String(body.key) !== ADMIN_KEY) return send(res, 401, { error: 'Wrong admin key.' });
    const t = newToken();
    DB.prepare('INSERT INTO admin_sessions(token,created_at) VALUES(?,?)').run(t, now());
    return send(res, 200, { token: t });
  }
  if (p.indexOf('/admin') === 0) {
    if (!authAdmin(req)) return send(res, 401, { error: 'Admin sign-in required.' });
    if (p === '/admin/drivers' && req.method === 'GET') {
      const rows = DB.prepare(`SELECT * FROM users WHERE role='driver'
        ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END,
        submitted_at DESC, id DESC`).all();
      return send(res, 200, { drivers: rows.map(adminDriver) });
    }
    if (p === '/admin/decision' && req.method === 'POST') {
      const u = DB.prepare("SELECT * FROM users WHERE id=? AND role='driver'").get(body.id);
      if (!u) return send(res, 404, { error: 'Driver not found.' });
      if (body.decision === 'approve') {
        DB.prepare("UPDATE users SET status='approved', qualified=1, reject_reason=NULL WHERE id=?").run(u.id);
      } else if (body.decision === 'reject') {
        DB.prepare("UPDATE users SET status='rejected', qualified=0, reject_reason=? WHERE id=?")
          .run(String(body.reason || 'Application did not meet requirements.'), u.id);
      } else return send(res, 400, { error: 'Unknown decision.' });
      return send(res, 200, { driver: adminDriver(getUser(u.id)) });
    }
    return send(res, 404, { error: 'Unknown admin endpoint.' });
  }

  // everything below requires auth
  const me = authUser(req);
  if (!me) return send(res, 401, { error: 'Not signed in.' });

  if (p === '/me' && req.method === 'GET') return send(res, 200, { user: clientUser(me) });

  if (p === '/plan' && req.method === 'POST') {
    if (me.role !== 'rider') return send(res, 403, { error: 'Riders only.' });
    const plan = PLANS[body.plan] ? body.plan : null;
    if (!plan) return send(res, 400, { error: 'Unknown plan.' });
    const used = Math.min(me.km_used, PLANS[plan].km);
    DB.prepare('UPDATE users SET plan=?, km_used=? WHERE id=?').run(plan, used, me.id);
    return send(res, 200, { user: clientUser(getUser(me.id)) });
  }

  if (p === '/qualification' && req.method === 'POST') {
    if (me.role !== 'driver') return send(res, 403, { error: 'Drivers only.' });
    const a = body.action;
    if (a === 'vehicle') {
      const year = parseInt(body.year, 10);
      if (!year) return send(res, 400, { error: 'Select a model year.' });
      if (year < 2018) return send(res, 400, { error: `A ${year} vehicle isn't eligible. OneUp requires 2018 or newer.` });
      DB.prepare('UPDATE users SET veh_make=?, veh_year=? WHERE id=?').run(String(body.make || 'Your car'), year, me.id);
    } else if (a === 'doc') {
      const docs = JSON.parse(me.docs || '[]');
      if (body.name && docs.indexOf(body.name) === -1) docs.push(body.name);
      DB.prepare('UPDATE users SET docs=? WHERE id=?').run(JSON.stringify(docs), me.id);
    } else if (a === 'inspection') {
      DB.prepare('UPDATE users SET inspection=1 WHERE id=?').run(me.id);
    } else if (a === 'background') {
      DB.prepare('UPDATE users SET background=1 WHERE id=?').run(me.id);
    } else if (a === 'submit') {
      const u = getUser(me.id);
      const ok = u.veh_year >= 2018 && JSON.parse(u.docs || '[]').length >= DOC_COUNT && u.inspection && u.background;
      if (!ok) return send(res, 400, { error: 'Finish all four checks first.' });
      // goes to an admin for review — not auto-approved
      DB.prepare("UPDATE users SET status='pending', submitted_at=?, reject_reason=NULL WHERE id=?").run(now(), me.id);
    } else {
      return send(res, 400, { error: 'Unknown action.' });
    }
    return send(res, 200, { user: clientUser(getUser(me.id)) });
  }

  if (p === '/trips' && req.method === 'GET') {
    const rows = DB.prepare('SELECT from_loc,to_loc,km,amount,created_at FROM trips WHERE user_id=? ORDER BY id DESC LIMIT 50').all(me.id);
    return send(res, 200, { trips: rows });
  }

  if (p === '/trips' && req.method === 'POST') {
    const km = Math.max(0.1, Number(body.km) || 9.2);
    const from = String(body.from || 'Pickup'), to = String(body.to || 'Destination');
    let amount = 0;
    if (me.role === 'driver') {
      if (!me.qualified) return send(res, 403, { error: 'Not qualified to take jobs yet.' });
      amount = Math.round(km * DRIVER_RATE);
      DB.prepare('UPDATE users SET earnings_today = earnings_today + ? WHERE id=?').run(amount, me.id);
    } else {
      DB.prepare('UPDATE users SET km_used = km_used + ? WHERE id=?').run(km, me.id);
    }
    DB.prepare('INSERT INTO trips(user_id,role,from_loc,to_loc,km,amount,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(me.id, me.role, from, to, km, amount, now());
    return send(res, 200, { user: clientUser(getUser(me.id)), trip: { from_loc: from, to_loc: to, km, amount } });
  }

  return send(res, 404, { error: 'Unknown endpoint.' });
}

// --- static files -----------------------------------------------------------
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const STATIC = new Set(['/index.html', '/styles.css', '/app.js', '/favicon.ico']);
function serveStatic(req, res, url) {
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!STATIC.has(file)) { res.writeHead(404); return res.end('Not found'); }
  const full = path.join(ROOT, file);
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
}

// --- server -----------------------------------------------------------------
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  if (url.pathname.startsWith('/api')) {
    api(req, res, url).catch(e => { console.error(e); send(res, 500, { error: 'Server error.' }); });
  } else {
    serveStatic(req, res, url);
  }
}).listen(PORT, () => {
  console.log(`OneUp running → http://localhost:${PORT}`);
});
