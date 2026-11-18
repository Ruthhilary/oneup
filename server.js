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
// DB_PATH lets a host mount a persistent disk (e.g. /data/oneup.db) so data survives restarts.
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'oneup.db');
const DB = new DatabaseSync(DB_PATH);
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

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
  tier TEXT DEFAULT 'Bronze'
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
ensureCol('users', 'veh_fuel', "TEXT DEFAULT 'petrol'");    // cng | hybrid | petrol
ensureCol('users', 'week_earn', 'INTEGER DEFAULT 0');       // ₦ paid to driver this week
ensureCol('users', 'trips_week', 'INTEGER DEFAULT 0');      // completed trips this week
ensureCol('users', 'accept_pct', 'INTEGER DEFAULT 0');      // % of offered trips accepted
ensureCol('users', 'online_hrs', 'INTEGER DEFAULT 0');      // hours online this week
ensureCol('users', 'queue_pos', 'INTEGER DEFAULT 0');      // fair-dispatch queue position when online
DB.exec('CREATE TABLE IF NOT EXISTS shift_bookings (slot_id TEXT, user_id INTEGER)');
DB.exec(`CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, reference TEXT, amount INTEGER,
  plan TEXT, status TEXT DEFAULT 'pending', created_at TEXT
)`);
ensureCol('users', 'phone', 'TEXT');
ensureCol('users', 'verified', 'INTEGER DEFAULT 0');       // email/phone verified
ensureCol('users', 'verify_code', 'TEXT');
ensureCol('users', 'verify_exp', 'TEXT');
ensureCol('users', 'reset_code', 'TEXT');
ensureCol('users', 'reset_exp', 'TEXT');
ensureCol('users', 'plan_expires', 'TEXT');                // when the paid cycle ends
ensureCol('users', 'bank_code', 'TEXT');                   // driver payout bank
ensureCol('users', 'account_number', 'TEXT');
ensureCol('users', 'account_name', 'TEXT');
ensureCol('users', 'recipient_code', 'TEXT');              // Paystack transfer recipient

const ADMIN_KEY = process.env.ADMIN_KEY || 'oneup-admin';
if (process.env.NODE_ENV === 'production' && ADMIN_KEY === 'oneup-admin') {
  console.error('FATAL: set a strong ADMIN_KEY environment variable before deploying to production.');
  process.exit(1);
}

const PLANS = {
  Starter:  { km: 120,  rate: 167, price: 20000,  used: 25 },
  Lite:     { km: 350,  rate: 163, price: 57000,  used: 70 },
  Commuter: { km: 700,  rate: 160, price: 112000, used: 120 },
  Pro:      { km: 1400, rate: 160, price: 224000, used: 240 },
  Max:      { km: 2000, rate: 155, price: 310000, used: 360 }
};
const LADDER = ['Starter', 'Lite', 'Commuter', 'Pro', 'Max']; // ascending by size
const TOP_RATE = 155; // ₦/km for usage beyond the biggest plan (Max's own rate — never a penalty)

// Auto-upgrade: the bill follows actual usage UP the ladder — no overflow cliff.
// A member who crosses their plan is rolled to the tier that covers them for the
// cycle and billed that tier's price; past Max, extra km bill at Max's own rate.
function effectiveBill(planName, kmUsed) {
  let chosen = LADDER.indexOf(planName); if (chosen < 0) chosen = 2;
  let idx = chosen;
  for (let i = chosen; i < LADDER.length; i++) { idx = i; if (PLANS[LADDER[i]].km >= kmUsed) break; }
  const maxTier = PLANS[LADDER[LADDER.length - 1]];
  let price = PLANS[LADDER[idx]].price, overflowKm = 0, overflowDue = 0;
  if (kmUsed > maxTier.km) { overflowKm = kmUsed - maxTier.km; overflowDue = Math.round(overflowKm * TOP_RATE); price = maxTier.price + overflowDue; }
  return { tier: LADDER[idx], price, upgraded: idx > chosen, overflowKm, overflowDue };
}
const DOC_COUNT = 5;
const DRIVER_MIN = 700;     // per-trip floor so short/slow trips stay fair to drivers

// Fuel-aware driver pay. Lagos petrol ~₦1,380/l ≈ ₦153/km fuel, so a thirsty petrol
// car leaves the driver underwater. OneUp gives EFFICIENT VEHICLES PRIORITY: hybrids
// (petrol, no special refuelling) roughly halve fuel to ~₦70/km, and CNG is cheaper
// still where refuelling exists. Thirsty petrol drivers get a higher interim rate so
// no one drives at a loss — and are steered to an efficient/hybrid car.
const FUEL = {
  cng:    { rate: 120, fuelPerKm: 45,  label: 'CNG' },
  hybrid: { rate: 143, fuelPerKm: 70,  label: 'Hybrid' },
  petrol: { rate: 170, fuelPerKm: 153, label: 'Petrol' }
};
const MAINT_PER_KM = 18;    // rough vehicle maintenance per km
function fuelOf(u) { return FUEL[u && u.veh_fuel] || FUEL.petrol; }

// Driver earnings model. Base pay is PURE pay-per-trip (no trip, no pay), so no one
// is paid to idle. A weekly guaranteed FLOOR is a conditional top-up offered only to
// drivers who commit hours, stay available and accept enough trips — it protects a
// driver against OneUp failing to supply rides, never against choosing not to work.
// Tiers are earned by performance and unlock a higher floor + a per-km bonus.
const TIERS = {
  Bronze:   { floor: 0,      bonus: 0,  minHrs: 0,  minAccept: 0,  minTrips: 0 },
  Silver:   { floor: 70000,  bonus: 5,  minHrs: 30, minAccept: 80, minTrips: 25 },
  Gold:     { floor: 95000,  bonus: 10, minHrs: 40, minAccept: 80, minTrips: 45 },
  Platinum: { floor: 120000, bonus: 15, minHrs: 45, minAccept: 85, minTrips: 70 }
};
function driverRate(u) { return fuelOf(u).rate + (TIERS[u && u.tier] || TIERS.Bronze).bonus; }
// Shift booking: drivers reserve demand slots; caps keep each slot busy so supply
// matches demand (no idle crowding). Fair dispatch rotates rides to whoever has
// waited longest. Peak demand is met by pulling more drivers in, not by rider surge.
const SHIFTS = [
  { id: 'lekki-am', zone: 'Lekki / VI', window: 'Morning peak · 6–10am', hrs: 4, demand: 'High',   cap: 12, base: 7 },
  { id: 'lekki-pm', zone: 'Lekki / VI', window: 'Evening peak · 4–8pm',  hrs: 4, demand: 'High',   cap: 14, base: 9 },
  { id: 'main-am',  zone: 'Mainland',   window: 'Morning peak · 6–10am', hrs: 4, demand: 'High',   cap: 12, base: 8 },
  { id: 'main-mid', zone: 'Mainland',   window: 'Midday · 10am–4pm',     hrs: 6, demand: 'Low',    cap: 6,  base: 5 },
  { id: 'ikeja-pm', zone: 'Ikeja',      window: 'Evening peak · 4–8pm',  hrs: 4, demand: 'Medium', cap: 8,  base: 4 },
  { id: 'night',    zone: 'All zones',  window: 'Night · 8pm–12am',      hrs: 4, demand: 'Medium', cap: 8,  base: 3 }
];
const SHIFT_BY_ID = {}; SHIFTS.forEach(s => { SHIFT_BY_ID[s.id] = s; });
function shiftList(userId) {
  return SHIFTS.map(s => {
    const mine = !!DB.prepare('SELECT 1 FROM shift_bookings WHERE slot_id=? AND user_id=?').get(s.id, userId);
    const others = DB.prepare('SELECT COUNT(*) c FROM shift_bookings WHERE slot_id=?').get(s.id).c;
    const booked = s.base + others;
    return { id: s.id, zone: s.zone, window: s.window, hrs: s.hrs, demand: s.demand, cap: s.cap, booked: booked, spotsLeft: Math.max(0, s.cap - booked), full: booked >= s.cap && !mine, mine: mine };
  });
}
function committedHrs(userId) {
  return DB.prepare('SELECT slot_id FROM shift_bookings WHERE user_id=?').all(userId)
    .reduce((a, r) => a + ((SHIFT_BY_ID[r.slot_id] || { hrs: 0 }).hrs), 0);
}
function dispatchZone(userId) {
  const r = DB.prepare('SELECT slot_id FROM shift_bookings WHERE user_id=? LIMIT 1').get(userId);
  return r ? SHIFT_BY_ID[r.slot_id].zone : 'Lekki / VI';
}
function onlineCount(zone) { return ({ 'Lekki / VI': 7, 'Mainland': 8, 'Ikeja': 5, 'All zones': 6 })[zone] || 6; }
function dispatchState(userId) {
  const u = getUser(userId), zone = dispatchZone(userId), online = onlineCount(zone);
  const pos = Math.min(Math.max(u.queue_pos || online, 1), online);
  return { zone: zone, online: online, position: pos, etaMin: Math.max(1, (pos - 1) * 2), next: pos <= 1 };
}
function driverEarnings(u) {
  const t = TIERS[u.tier] || TIERS.Bronze;
  const hrs = u.online_hrs || 0, acc = u.accept_pct || 0, trips = u.trips_week || 0, earn = u.week_earn || 0;
  const met = { hours: hrs >= t.minHrs, accept: acc >= t.minAccept, trips: trips >= t.minTrips };
  const eligible = u.tier !== 'Bronze' && met.hours && met.accept && met.trips;
  const topUp = eligible ? Math.max(0, t.floor - earn) : 0;
  return {
    tier: u.tier || 'Bronze', floor: t.floor, bonusPerKm: t.bonus,
    weekEarnings: earn, tripsWeek: trips, acceptPct: acc, onlineHrs: hrs,
    need: { minHrs: t.minHrs, minAccept: t.minAccept, minTrips: t.minTrips },
    met: met, floorEligible: eligible, floorTopUp: topUp, weekGuaranteed: earn + topUp
  };
}

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
function sixDigit() { return String(crypto.randomInt(100000, 1000000)); }
function plusMinutes(m) { return new Date(Date.now() + m * 60000).toISOString(); }
function plusDays(d) { return new Date(Date.now() + d * 86400000).toISOString(); }
function normEmail(e) { return String(e || '').trim().toLowerCase(); }

// --- third-party integrations (all optional; switch on when keys are present) ---
const CFG = {
  paystackSecret: process.env.PAYSTACK_SECRET_KEY || '',
  paystackPublic: process.env.PAYSTACK_PUBLIC_KEY || '',
  mapsServer:     process.env.GOOGLE_MAPS_SERVER_KEY || '',
  mapsBrowser:    process.env.GOOGLE_MAPS_BROWSER_KEY || '',
  resendKey:      process.env.RESEND_API_KEY || '',
  mailFrom:       process.env.MAIL_FROM || 'OneUp <onboarding@resend.dev>',
  termiiKey:      process.env.TERMII_API_KEY || '',
  termiiSender:   process.env.TERMII_SENDER || 'OneUp',
  appUrl:         (process.env.APP_URL || '').replace(/\/$/, '')
};
const FEAT = { payments: !!CFG.paystackSecret, maps: !!CFG.mapsServer, email: !!CFG.resendKey, sms: !!CFG.termiiKey };

async function httpJSON(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: r.ok, status: r.status, data };
}
function paystack(p, method, body) {
  return httpJSON('https://api.paystack.co' + p, {
    method: method,
    headers: { Authorization: 'Bearer ' + CFG.paystackSecret, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
}
async function measureKm(origin, dest) {
  const u = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  u.searchParams.set('origins', origin); u.searchParams.set('destinations', dest);
  u.searchParams.set('units', 'metric'); u.searchParams.set('key', CFG.mapsServer);
  const r = await httpJSON(u.toString());
  const el = r.data && r.data.rows && r.data.rows[0] && r.data.rows[0].elements && r.data.rows[0].elements[0];
  if (!el || el.status !== 'OK') throw new Error('Could not measure that route — check the addresses.');
  return { km: Math.round((el.distance.value / 1000) * 10) / 10, mins: Math.round(el.duration.value / 60), text: el.distance.text };
}
async function sendEmail(to, subject, html) {
  if (!FEAT.email) return false;
  const r = await httpJSON('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + CFG.resendKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: CFG.mailFrom, to: [to], subject, html })
  });
  if (!r.ok) console.error('email send failed', r.status, r.data);
  return r.ok;
}
async function sendSMS(to, text) {
  if (!FEAT.sms || !to) return false;
  const r = await httpJSON('https://api.ng.termii.com/api/sms/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: to, from: CFG.termiiSender, sms: text, type: 'plain', channel: 'generic', api_key: CFG.termiiKey })
  });
  return r.ok;
}
// send a verification code by whatever channel is configured
async function sendVerification(u) {
  if (!FEAT.email && !FEAT.sms) return false;
  const code = sixDigit();
  DB.prepare('UPDATE users SET verify_code=?, verify_exp=? WHERE id=?').run(code, plusMinutes(30), u.id);
  const msg = 'Your OneUp verification code is ' + code + '. It expires in 30 minutes.';
  if (FEAT.email) await sendEmail(u.email, 'Verify your OneUp account', '<p>' + msg + '</p>');
  if (FEAT.sms && u.phone) await sendSMS(u.phone, msg);
  return true;
}
// mark a payment paid and activate the rider's plan for a 30-day cycle
function activatePayment(reference) {
  const pay = DB.prepare('SELECT * FROM payments WHERE reference=?').get(reference);
  if (!pay || pay.status === 'success') return;
  DB.prepare("UPDATE payments SET status='success' WHERE reference=?").run(reference);
  DB.prepare('UPDATE users SET plan=?, km_used=0, plan_expires=? WHERE id=?').run(pay.plan, plusDays(30), pay.user_id);
}
function validEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }
function validPhone(p) { return !p || /^[0-9+][0-9\s-]{6,}$/.test(String(p)); }

function clientUser(u) {
  const plan = PLANS[u.plan] || PLANS.Commuter;
  const eb = effectiveBill(u.plan in PLANS ? u.plan : 'Commuter', u.km_used);
  const docs = JSON.parse(u.docs || '[]');
  return {
    id: u.id, role: u.role, name: u.name, email: u.email,
    plan: u.plan, planKm: plan.km, rate: plan.rate, price: plan.price,
    kmUsed: u.km_used, kmLeft: Math.max(0, plan.km - u.km_used),
    billPlan: eb.tier, billNow: eb.price, autoUpgraded: eb.upgraded,
    overflowKm: eb.overflowKm, overflowDue: eb.overflowDue, topRate: TOP_RATE,
    qualified: !!u.qualified,
    vehicle: { make: u.veh_make || '', year: u.veh_year || null, fuel: u.veh_fuel || 'petrol' },
    fuelLabel: fuelOf(u).label,
    payPerKm: fuelOf(u).rate,
    fuelPerKm: fuelOf(u).fuelPerKm,
    netPerKm: fuelOf(u).rate - fuelOf(u).fuelPerKm - MAINT_PER_KM,
    docs: docs,
    docsDone: docs.length >= DOC_COUNT,
    inspection: !!u.inspection,
    background: !!u.background,
    earningsToday: u.earnings_today,
    tier: u.tier,
    tierInfo: u.role === 'driver' ? driverEarnings(u) : null,
    status: u.status || 'incomplete',
    rejectReason: u.reject_reason || '',
    verified: !!u.verified,
    planExpires: u.plan_expires || null,
    hasBank: !!u.recipient_code,
    accountName: u.account_name || ''
  };
}
function adminDriver(u) {
  return {
    id: u.id, name: u.name, email: u.email, status: u.status || 'incomplete',
    vehicle: { make: u.veh_make || '', year: u.veh_year || null, fuel: u.veh_fuel || 'petrol' },
    eligible: !!(u.veh_year && u.veh_year >= 2018),
    docsCount: JSON.parse(u.docs || '[]').length, docsTotal: DOC_COUNT,
    inspection: !!u.inspection, background: !!u.background,
    submittedAt: u.submitted_at || null, rejectReason: u.reject_reason || '',
    qualified: !!u.qualified, earningsToday: u.earnings_today
  };
}
// Access-control model — three separate tiers, enforced below:
//   • rider  — own account, plans, payments, own trips (no driver or admin routes)
//   • driver — own account, qualification, shifts/dispatch, payouts, own jobs (no rider plan/pay, no admin)
//   • admin  — approve/reject drivers, trigger payouts; separate token, never a user token
// Sessions expire so stale tokens can't live forever.
const SESSION_TTL_MS = 30 * 86400000; // riders/drivers: 30 days
const ADMIN_TTL_MS = 1 * 86400000;    // admin: 1 day (more sensitive)
function expired(createdAt, ttl) { return !createdAt || (Date.now() - new Date(createdAt).getTime() > ttl); }
function authAdmin(req) {
  const t = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!t) return null;
  const s = DB.prepare('SELECT token, created_at FROM admin_sessions WHERE token=?').get(t);
  if (!s) return null;
  if (expired(s.created_at, ADMIN_TTL_MS)) { DB.prepare('DELETE FROM admin_sessions WHERE token=?').run(t); return null; }
  return s;
}
function getUser(id) { return DB.prepare('SELECT * FROM users WHERE id=?').get(id); }
function authUser(req) {
  const t = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!t) return null;
  const s = DB.prepare('SELECT user_id, created_at FROM sessions WHERE token=?').get(t);
  if (!s) return null;
  if (expired(s.created_at, SESSION_TTL_MS)) { DB.prepare('DELETE FROM sessions WHERE token=?').run(t); return null; }
  return getUser(s.user_id);
}
// enforce a role on an endpoint; returns true and sends 403 if the caller isn't allowed
function denyRole(me, res, role) {
  if (me.role !== role) { send(res, 403, { error: role === 'driver' ? 'Drivers only.' : 'Riders only.' }); return true; }
  return false;
}
function makeSession(userId) {
  const t = newToken();
  DB.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(t, userId, now());
  return t;
}

// --- JSON responses ---------------------------------------------------------
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, SECURITY_HEADERS));
  res.end(body);
}
function readRaw(req) {
  return new Promise((resolve) => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(d));
  });
}

// --- API --------------------------------------------------------------------
async function api(req, res, url) {
  const p = url.pathname.replace(/^\/api/, '');
  let raw = '', body = {};
  if (req.method === 'POST') { raw = await readRaw(req); try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; } }

  // public: what integrations are live (so the client adapts)
  if (p === '/config' && req.method === 'GET') {
    return send(res, 200, { payments: FEAT.payments, maps: FEAT.maps, email: FEAT.email, sms: FEAT.sms, paystackPublic: CFG.paystackPublic, mapsBrowser: CFG.mapsBrowser });
  }

  // Paystack webhook (no auth; verified by signature over the RAW body)
  if (p === '/paystack/webhook' && req.method === 'POST') {
    if (!FEAT.payments) return send(res, 200, { ok: true });
    const sig = req.headers['x-paystack-signature'] || '';
    const expected = crypto.createHmac('sha512', CFG.paystackSecret).update(raw).digest('hex');
    if (sig !== expected) return send(res, 401, { error: 'bad signature' });
    try {
      const ev = JSON.parse(raw);
      if (ev.event === 'charge.success' && ev.data && ev.data.reference) activatePayment(ev.data.reference, ev.data);
    } catch {}
    return send(res, 200, { ok: true });
  }

  if (p === '/signup' && req.method === 'POST') {
    const role = body.role, name = String(body.name || '').trim(), email = normEmail(body.email);
    const password = String(body.password || ''), phone = String(body.phone || '').trim(), plan = body.plan;
    if (role !== 'rider' && role !== 'driver') return send(res, 400, { error: 'Choose rider or driver.' });
    if (name.length < 2) return send(res, 400, { error: 'Please enter your full name.' });
    if (!validEmail(email)) return send(res, 400, { error: 'Enter a valid email address.' });
    if (!validPhone(phone)) return send(res, 400, { error: 'Enter a valid phone number.' });
    if (password.length < 8) return send(res, 400, { error: 'Password must be at least 8 characters.' });
    const exists = DB.prepare('SELECT id FROM users WHERE email=? AND role=?').get(email, role);
    if (exists) return send(res, 409, { error: 'An account with this email already exists for that role. Please sign in.' });
    // Riders start on a plan they chose (billing is gated until payment is live); drivers start
    // unqualified and must pass the checks + admin approval before taking any job.
    const chosen = PLANS[plan] ? plan : 'Starter';
    const info = DB.prepare(
      'INSERT INTO users(role,name,email,phone,pass,created_at,plan,km_used,tier) VALUES(?,?,?,?,?,?,?,?,?)'
    ).run(role, name, email, phone || null, hashPw(password), now(), role === 'rider' ? chosen : 'Starter', 0, 'Bronze');
    const u = getUser(info.lastInsertRowid);
    if (FEAT.email || FEAT.sms) sendVerification(u).catch(() => {});
    return send(res, 200, { token: makeSession(u.id), user: clientUser(u) });
  }

  if (p === '/login' && req.method === 'POST') {
    const role = body.role, email = normEmail(body.email), password = String(body.password || '');
    if (!role || !email || !password) return send(res, 400, { error: 'Enter your email and password.' });
    const u = DB.prepare('SELECT * FROM users WHERE email=? AND role=?').get(email, role);
    if (!u || !verifyPw(password, u.pass)) return send(res, 401, { error: 'No account found, or wrong password. Check your details or sign up.' });
    return send(res, 200, { token: makeSession(u.id), user: clientUser(u) });
  }

  // ---- password reset (public) ----
  if (p === '/reset/request' && req.method === 'POST') {
    const role = body.role, email = normEmail(body.email);
    const u = (role && email) ? DB.prepare('SELECT * FROM users WHERE email=? AND role=?').get(email, role) : null;
    if (u && FEAT.email) {
      const code = sixDigit();
      DB.prepare('UPDATE users SET reset_code=?, reset_exp=? WHERE id=?').run(code, plusMinutes(30), u.id);
      sendEmail(u.email, 'Reset your OneUp password',
        '<p>Your OneUp password reset code is <b>' + code + '</b>. It expires in 30 minutes. If you didn\'t request this, ignore this email.</p>').catch(() => {});
    }
    return send(res, 200, { ok: true, emailConfigured: FEAT.email }); // never reveal whether the account exists
  }
  if (p === '/reset/confirm' && req.method === 'POST') {
    const role = body.role, email = normEmail(body.email), code = String(body.code || ''), np = String(body.newPassword || '');
    if (np.length < 8) return send(res, 400, { error: 'New password must be at least 8 characters.' });
    const u = DB.prepare('SELECT * FROM users WHERE email=? AND role=?').get(email, role);
    if (!u || !u.reset_code || u.reset_code !== code || !u.reset_exp || u.reset_exp < now()) return send(res, 400, { error: 'Invalid or expired code.' });
    DB.prepare('UPDATE users SET pass=?, reset_code=NULL, reset_exp=NULL WHERE id=?').run(hashPw(np), u.id);
    return send(res, 200, { ok: true });
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
    if (p === '/admin/payout' && req.method === 'POST') {
      if (!FEAT.payments) return send(res, 400, { error: 'Payouts are not set up yet.' });
      const u = DB.prepare("SELECT * FROM users WHERE id=? AND role='driver'").get(body.id);
      if (!u) return send(res, 404, { error: 'Driver not found.' });
      if (!u.recipient_code) return send(res, 400, { error: 'Driver has not added a payout account.' });
      const amount = Math.max(0, Math.round(u.week_earn || 0));
      if (amount <= 0) return send(res, 400, { error: 'Nothing to pay out.' });
      const t = await paystack('/transfer', 'POST', { source: 'balance', amount: amount * 100, recipient: u.recipient_code, reason: 'OneUp driver earnings' });
      if (!t.ok || !t.data.status) return send(res, 502, { error: (t.data && t.data.message) || 'Transfer failed — is Paystack Transfers enabled and the balance funded?' });
      DB.prepare('UPDATE users SET week_earn=0 WHERE id=?').run(u.id);
      return send(res, 200, { ok: true, amount: amount });
    }
    return send(res, 404, { error: 'Unknown admin endpoint.' });
  }

  // everything below requires auth
  const me = authUser(req);
  if (!me) return send(res, 401, { error: 'Not signed in.' });

  if (p === '/me' && req.method === 'GET') return send(res, 200, { user: clientUser(me) });

  if (p === '/logout' && req.method === 'POST') {
    const t = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    DB.prepare('DELETE FROM sessions WHERE token=?').run(t);
    return send(res, 200, { ok: true });
  }

  // ---- account verification ----
  if (p === '/verify/confirm' && req.method === 'POST') {
    const u = getUser(me.id);
    if (u.verified) return send(res, 200, { user: clientUser(u) });
    const code = String(body.code || '');
    if (!u.verify_code || u.verify_code !== code || !u.verify_exp || u.verify_exp < now()) return send(res, 400, { error: 'Invalid or expired code.' });
    DB.prepare('UPDATE users SET verified=1, verify_code=NULL, verify_exp=NULL WHERE id=?').run(me.id);
    return send(res, 200, { user: clientUser(getUser(me.id)) });
  }
  if (p === '/verify/resend' && req.method === 'POST') {
    if (!FEAT.email && !FEAT.sms) return send(res, 400, { error: 'Verification is not set up yet.' });
    await sendVerification(getUser(me.id));
    return send(res, 200, { ok: true });
  }

  // ---- payments (rider subscriptions via Paystack) ----
  if (p === '/pay/init' && req.method === 'POST') {
    if (me.role !== 'rider') return send(res, 403, { error: 'Riders only.' });
    if (!FEAT.payments) return send(res, 400, { error: 'Payments are not set up yet.' });
    const plan = PLANS[body.plan] ? body.plan : null;
    if (!plan) return send(res, 400, { error: 'Unknown plan.' });
    const reference = 'oneup_' + newToken().slice(0, 20);
    const amount = PLANS[plan].price * 100; // in kobo
    DB.prepare('INSERT INTO payments(user_id,reference,amount,plan,status,created_at) VALUES(?,?,?,?,?,?)').run(me.id, reference, amount, plan, 'pending', now());
    const r = await paystack('/transaction/initialize', 'POST', {
      email: me.email, amount: amount, reference: reference,
      callback_url: (CFG.appUrl || ('http://localhost:' + PORT)) + '/?pay=' + reference,
      metadata: { userId: me.id, plan: plan }
    });
    if (!r.ok || !r.data.status) return send(res, 502, { error: (r.data && r.data.message) || 'Could not start payment.' });
    return send(res, 200, { authorizationUrl: r.data.data.authorization_url, reference: reference });
  }
  if (p === '/pay/verify' && req.method === 'POST') {
    if (!FEAT.payments) return send(res, 400, { error: 'Payments are not set up yet.' });
    const reference = String(body.reference || '');
    const pay = DB.prepare('SELECT * FROM payments WHERE reference=? AND user_id=?').get(reference, me.id);
    if (!pay) return send(res, 404, { error: 'Payment not found.' });
    const r = await paystack('/transaction/verify/' + encodeURIComponent(reference), 'GET');
    if (r.ok && r.data.data && r.data.data.status === 'success' && r.data.data.amount >= pay.amount) {
      activatePayment(reference);
      return send(res, 200, { paid: true, user: clientUser(getUser(me.id)) });
    }
    return send(res, 200, { paid: false, user: clientUser(getUser(me.id)) });
  }

  // ---- real distance (Google) ----
  if (p === '/distance' && req.method === 'POST') {
    if (!FEAT.maps) return send(res, 400, { error: 'Maps are not set up yet.' });
    const origin = String(body.origin || '').trim(), dest = String(body.dest || '').trim();
    if (!origin || !dest) return send(res, 400, { error: 'Enter pickup and destination.' });
    try { return send(res, 200, await measureKm(origin, dest)); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }

  if (p === '/banks' && req.method === 'GET') {
    if (!FEAT.payments) return send(res, 200, { banks: [] });
    const r = await paystack('/bank?currency=NGN&perPage=100', 'GET');
    const banks = (r.ok && r.data.data) ? r.data.data.map(b => ({ name: b.name, code: b.code })) : [];
    return send(res, 200, { banks: banks });
  }

  // ---- driver payout bank (Paystack transfer recipient) ----
  if (p === '/bank' && req.method === 'POST') {
    if (me.role !== 'driver') return send(res, 403, { error: 'Drivers only.' });
    if (!FEAT.payments) return send(res, 400, { error: 'Payouts are not set up yet.' });
    const bankCode = String(body.bankCode || ''), acct = String(body.accountNumber || '');
    if (!bankCode || !/^\d{10}$/.test(acct)) return send(res, 400, { error: 'Enter your bank and 10-digit account number.' });
    const resolved = await paystack('/bank/resolve?account_number=' + acct + '&bank_code=' + bankCode, 'GET');
    if (!resolved.ok || !resolved.data.status) return send(res, 400, { error: 'Could not verify that account.' });
    const name = resolved.data.data.account_name;
    const rec = await paystack('/transferrecipient', 'POST', { type: 'nuban', name: name, account_number: acct, bank_code: bankCode, currency: 'NGN' });
    if (!rec.ok || !rec.data.status) return send(res, 400, { error: 'Could not save payout account.' });
    DB.prepare('UPDATE users SET bank_code=?, account_number=?, account_name=?, recipient_code=? WHERE id=?').run(bankCode, acct, name, rec.data.data.recipient_code, me.id);
    return send(res, 200, { user: clientUser(getUser(me.id)) });
  }

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
      const fuel = FUEL[body.fuel] ? body.fuel : 'petrol';
      DB.prepare('UPDATE users SET veh_make=?, veh_year=?, veh_fuel=? WHERE id=?').run(String(body.make || 'Your car'), year, fuel, me.id);
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

  if (p === '/shifts' && req.method === 'GET') {
    if (me.role !== 'driver') return send(res, 403, { error: 'Drivers only.' });
    return send(res, 200, { shifts: shiftList(me.id), committedHrs: committedHrs(me.id) });
  }
  if (p === '/shifts' && req.method === 'POST') {
    if (me.role !== 'driver') return send(res, 403, { error: 'Drivers only.' });
    const s = SHIFT_BY_ID[body.slotId]; if (!s) return send(res, 400, { error: 'Unknown shift.' });
    const mine = !!DB.prepare('SELECT 1 FROM shift_bookings WHERE slot_id=? AND user_id=?').get(s.id, me.id);
    if (body.action === 'cancel') {
      DB.prepare('DELETE FROM shift_bookings WHERE slot_id=? AND user_id=?').run(s.id, me.id);
    } else if (!mine) {
      const others = DB.prepare('SELECT COUNT(*) c FROM shift_bookings WHERE slot_id=?').get(s.id).c;
      if (s.base + others >= s.cap) return send(res, 409, { error: 'That shift is full — the cap keeps demand and pay high. Pick another slot.' });
      DB.prepare('INSERT INTO shift_bookings(slot_id,user_id) VALUES(?,?)').run(s.id, me.id);
    }
    return send(res, 200, { shifts: shiftList(me.id), committedHrs: committedHrs(me.id) });
  }
  if (p === '/online' && req.method === 'POST') {
    if (me.role !== 'driver') return send(res, 403, { error: 'Drivers only.' });
    DB.prepare('UPDATE users SET queue_pos=? WHERE id=?').run(onlineCount(dispatchZone(me.id)), me.id); // join at the back
    return send(res, 200, dispatchState(me.id));
  }
  if (p === '/dispatch' && req.method === 'GET') {
    if (me.role !== 'driver') return send(res, 403, { error: 'Drivers only.' });
    let pos = me.queue_pos || 0;                 // the line moves: drivers ahead get rides
    if (pos > 1) DB.prepare('UPDATE users SET queue_pos=? WHERE id=?').run(pos - 1, me.id);
    return send(res, 200, dispatchState(me.id));
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
      amount = Math.max(DRIVER_MIN, Math.round(km * driverRate(me)));
      DB.prepare('UPDATE users SET earnings_today = earnings_today + ?, week_earn = week_earn + ?, trips_week = trips_week + 1, queue_pos = ? WHERE id=?')
        .run(amount, amount, onlineCount(dispatchZone(me.id)), me.id); // fair rotation: back of the queue after a ride
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
    res.writeHead(200, Object.assign({ 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, SECURITY_HEADERS));
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
