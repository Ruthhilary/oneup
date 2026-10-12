/* OneUp front-end — talks to the backend (server.js). Vanilla JS. */
(function () {
  'use strict';

  var TOKEN_KEY = 'oneup_token';
  var state = { role: 'rider', mode: 'create', pendingPlan: null, user: null, trips: [], inspectionBooked: false, bgRunning: false };
  var DOCS = ["Driver's licence", "Vehicle registration", "Insurance certificate", "Roadworthiness certificate", "Proof the car is yours"];
  var QSTEPS = [
    { id: 'vehicle', title: 'Your vehicle', desc: 'Must be a 2018 or newer car that you own and drive.' },
    { id: 'docs', title: 'Documents', desc: 'Upload your licence and the car’s papers.' },
    { id: 'inspection', title: 'Vehicle inspection', desc: 'Book and pass a safety & condition check.' },
    { id: 'background', title: 'Background check', desc: 'Identity and driving-history verification.' }
  ];

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var money = function (n) { return '₦' + Number(n).toLocaleString(); };
  var reduce = function () { return matchMedia('(prefers-reduced-motion:reduce)').matches; };
  var timer = null;
  function delay(fn, ms) { if (timer) clearTimeout(timer); timer = setTimeout(fn, reduce() ? 500 : ms); }

  // ------------------------------------------------------------ API client
  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
  function api(pathname, method, body) {
    return fetch('/api' + pathname, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { var e = new Error(data.error || 'Request failed'); e.status = res.status; throw e; }
        return data;
      });
    });
  }
  var toastT = null;
  function toast(msg) {
    var el = $('#toast'); if (!el) return;
    el.textContent = msg; el.classList.add('on');
    if (toastT) clearTimeout(toastT);
    toastT = setTimeout(function () { el.classList.remove('on'); }, 3800);
  }

  // --------------------------------------------------------------- router
  var pages = { landing: $('#page-landing'), auth: $('#page-auth'), app: $('#page-app') };
  var nav = $('#nav');
  function showPage(name) {
    Object.keys(pages).forEach(function (k) { var on = k === name; pages[k].classList.toggle('on', on); pages[k].hidden = !on; });
    nav.hidden = (name !== 'landing');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // ------------------------------------------------------------------ auth
  var titleEl = $('#auth-title'), submitEl = $('#authsubmit'), fName = $('#f-name');
  function syncAuth() {
    $$('[data-role-pick]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.rolePick === state.role); });
    $$('[data-mode]').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.mode === state.mode); });
    fName.style.display = state.mode === 'create' ? 'block' : 'none';
    var noun = state.role === 'rider' ? 'rider' : 'driver';
    titleEl.textContent = state.mode === 'create' ? 'Create your account' : 'Welcome back';
    submitEl.textContent = state.mode === 'create' ? 'Create ' + noun + ' account' : 'Sign in as ' + noun;
  }
  function openAuth(m, r, plan) { state.mode = m || 'create'; if (r) state.role = r; if (plan) state.pendingPlan = plan; syncAuth(); showPage('auth'); }
  $$('[data-role-pick]').forEach(function (b) { b.addEventListener('click', function () { state.role = b.dataset.rolePick; syncAuth(); }); });
  $$('[data-mode]').forEach(function (b) { b.addEventListener('click', function () { state.mode = b.dataset.mode; syncAuth(); }); });
  $('#authform').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('#a-email').value.trim(), pass = $('#a-pass').value, name = $('#a-name').value.trim();
    if (!email || !pass) { toast('Enter an email and password.'); return; }
    submitEl.disabled = true;
    var req = state.mode === 'create'
      ? api('/signup', 'POST', { role: state.role, name: name, email: email, password: pass, plan: state.pendingPlan || 'Commuter' })
      : api('/login', 'POST', { role: state.role, email: email, password: pass });
    req.then(function (data) { setToken(data.token); state.user = data.user; return enterApp(); })
      .catch(function (e) { toast(e.message || 'Could not sign in.'); })
      .then(function () { submitEl.disabled = false; });
  });

  // ------------------------------------------------------------- enter app
  function enterApp() {
    var u = state.user, driver = u.role === 'driver';
    state.role = u.role;
    showPage('app');
    $('#app-role').textContent = driver ? 'Driver' : 'Rider';
    $('#sb-role').textContent = driver ? 'OneUp · Driver' : 'OneUp · Rider';
    $('#tabs-rider').classList.toggle('on', !driver);
    $('#tabs-driver').classList.toggle('on', driver);
    updateTabLocks();
    if (!driver) renderRiderHome();
    return loadTrips().then(function () {
      if (!driver) show('r-home');
      else show(u.qualified ? 'dv-home' : 'dv-qualify');
    });
  }
  function loadTrips() {
    return api('/trips').then(function (r) { state.trips = r.trips || []; }).catch(function () { state.trips = []; }).then(renderTripLists);
  }

  // --------------------------------------------------------- screens + tabs
  var VIEW_TAB = {
    'r-home': 'home', 'r-book': 'book', 'r-matching': 'book', 'r-matched': 'book', 'r-trip': 'book', 'r-complete': 'book',
    'r-plans': 'plan', 'r-trips': 'trips', 'r-plan': 'plan', 'r-account': 'account',
    'dv-qualify': 'home', 'dv-home': 'home', 'dv-jobs': 'jobs', 'dv-online': 'jobs', 'dv-request': 'jobs',
    'dv-enroute': 'jobs', 'dv-trip': 'jobs', 'dv-done': 'jobs', 'dv-trips': 'trips', 'dv-vehicle': 'vehicle', 'dv-account': 'account'
  };
  var GUIDE = {
    'r-home': 'Your home tab. Tap <b>Book a ride</b>, or explore the tabs below.',
    'r-book': 'Pickup & destination are set. Tap <b>Confirm pickup</b>.',
    'r-matching': 'Finding your driver…', 'r-matched': 'Tap <b>Driver’s here — get in</b>.',
    'r-trip': 'Tap <b>Arrive at destination</b> — the trip saves to your account.', 'r-complete': 'Saved. Tap <b>Done</b>.',
    'r-trips': 'Your saved rides.', 'r-plan': 'Tap another plan to switch — it’s saved.', 'r-account': 'Your profile & billing.',
    'dv-qualify': 'Complete all 4 checks to start earning. Progress is saved as you go.',
    'dv-home': 'You’re qualified. Tap the <b>Jobs</b> tab to go online.',
    'dv-jobs': 'Slide the switch to go online.', 'dv-online': 'Tap <b>A ride request comes in</b>.',
    'dv-request': 'You’re cleared to drive — tap <b>Accept</b>.', 'dv-enroute': 'Tap <b>Arrived · start trip</b>.',
    'dv-trip': 'Tap <b>Complete trip</b> — the payout saves to your account.', 'dv-done': 'Tap <b>Back online</b>.',
    'dv-trips': 'Your saved jobs & payouts.', 'dv-vehicle': 'Your car and its documents.', 'dv-account': 'Your profile.'
  };
  var gtext = $('#guide .g-text');

  function show(view) {
    var scr = $('[data-screen="' + view + '"]'); if (!scr) return;
    $$('.app-screen').forEach(function (s) { s.classList.remove('on'); });
    scr.classList.add('on');
    var v = $('#page-app .view'); if (v) v.scrollTop = 0;
    if (GUIDE[view]) gtext.innerHTML = GUIDE[view];
    var tab = VIEW_TAB[view];
    var bar = state.role === 'driver' ? $('#tabs-driver') : $('#tabs-rider');
    $$('button', bar).forEach(function (b) { b.setAttribute('aria-current', b.dataset.tab === tab ? 'true' : 'false'); });
    if (view === 'dv-qualify') renderQual();
    if (view === 'dv-vehicle') renderVehicle();
    if (view === 'dv-home') renderDriverHome();
    if (view === 'dv-jobs') renderDriverJobs();
    if (view === 'r-home') renderRiderHome();
    if (view === 'r-plan') renderPlanView();
    if (view === 'r-matching') delay(function () { show('r-matched'); }, 1800);
  }
  function qualified() { return state.user && state.user.qualified; }

  function updateTabLocks() {
    var bar = $('#tabs-driver');
    $$('button', bar).forEach(function (b) {
      var locked = !qualified() && (b.dataset.tab === 'jobs' || b.dataset.tab === 'trips');
      b.classList.toggle('locked', locked);
      var lk = $('.lockdot', b); if (lk) lk.hidden = !locked;
    });
  }
  function clickTab(tab) {
    if (state.role === 'driver') {
      if (!qualified() && (tab === 'jobs' || tab === 'trips')) {
        gtext.innerHTML = 'Finish <b>qualification</b> first — you can’t take jobs until your car is verified.';
        show('dv-qualify'); return;
      }
      var map = { home: qualified() ? 'dv-home' : 'dv-qualify', jobs: 'dv-jobs', trips: 'dv-trips', vehicle: 'dv-vehicle', account: 'dv-account' };
      show(map[tab]);
    } else {
      show({ home: 'r-home', book: 'r-book', trips: 'r-trips', plan: 'r-plan', account: 'r-account' }[tab]);
    }
  }
  $$('.tabbar').forEach(function (bar) { bar.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) clickTab(b.dataset.tab); }); });

  // --------------------------------------------------------------- RIDER
  function renderRiderHome() {
    var u = state.user; if (!u || u.role !== 'rider') return;
    $('#r-planbadge').textContent = u.plan;
    $('#r-kmleft').textContent = Math.round(u.kmLeft).toLocaleString();
    $('#r-kmtotal').textContent = 'of ' + u.planKm.toLocaleString() + ' km';
    $('#r-rate').textContent = 'Flat ₦' + u.rate + '/km · no surge';
    $('#r-ring').style.setProperty('--p', Math.round(u.kmLeft / u.planKm * 100));
    $('#r-spend').textContent = money(u.price);
    $('#r-used').textContent = Math.round(u.kmUsed) + ' km';
  }
  function renderPlanView() {
    var u = state.user; if (!u) return;
    $$('#r-plan [data-planopt]').forEach(function (c) {
      var cur = c.dataset.planopt === u.plan, btn = $('.planopt-btn', c);
      c.classList.toggle('fill', cur);
      btn.textContent = cur ? 'Current plan' : 'Switch to ' + c.dataset.planopt;
      btn.disabled = cur;
    });
  }
  function fmtWhen(iso) {
    try { var d = new Date(iso); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function renderTripLists() {
    var rider = state.role === 'rider';
    var list = state.trips;
    function rowsHtml(items, driver) {
      if (!items.length) return '<p class="sm muted" style="padding:14px 0;text-align:center">No trips yet — ' + (driver ? 'complete a job' : 'book a ride') + ' and it’ll show here.</p>';
      return items.map(function (t) {
        var right = driver ? '<span class="num good">+₦' + Number(t.amount).toLocaleString() + '</span>' : '<span class="num muted">' + t.km + ' km</span>';
        return '<div class="listrow"><div><div class="lt">' + t.from_loc + ' → ' + t.to_loc + '</div><div class="ls">' + fmtWhen(t.created_at) + (driver ? ' · ' + t.km + ' km' : '') + '</div></div>' + right + '</div>';
      }).join('');
    }
    if (rider) {
      var rl = $('#r-trips-list'); if (rl) rl.innerHTML = rowsHtml(list, false);
      var rec = $('#r-recent'); if (rec) rec.innerHTML = list.length ? rowsHtml(list.slice(0, 2), false) : '<p class="sm muted" style="padding:10px 0;text-align:center">Book your first ride to see it here.</p>';
    } else {
      var dl = $('#dv-trips-list'); if (dl) dl.innerHTML = rowsHtml(list, true);
    }
  }
  function completeRide() {
    api('/trips', 'POST', { from: 'Lekki Phase 1', to: 'Victoria Island', km: 9.2 })
      .then(function (r) { state.user = r.user; state.trips.unshift(r.trip); renderTripLists(); renderRiderHome(); $('#r-after').textContent = Math.round(state.user.kmLeft * 10) / 10 + ' km'; })
      .catch(function (e) { toast(e.message); })
      .then(function () { show('r-complete'); });
  }
  function switchPlan(plan) {
    api('/plan', 'POST', { plan: plan })
      .then(function (r) { state.user = r.user; renderRiderHome(); renderPlanView(); toast('Plan updated to ' + plan + '.'); show('r-home'); })
      .catch(function (e) { toast(e.message); });
  }

  // --------------------------------------------------------------- DRIVER
  function stepDone(id) {
    var u = state.user;
    if (id === 'vehicle') return !!(u.vehicle && u.vehicle.year);
    if (id === 'docs') return u.docs.length >= DOCS.length;
    if (id === 'inspection') return !!u.inspection;
    if (id === 'background') return !!u.background;
    return false;
  }
  function qualProgress() { return QSTEPS.filter(function (s) { return stepDone(s.id); }).length; }
  function activeStep() { for (var i = 0; i < QSTEPS.length; i++) if (!stepDone(QSTEPS[i].id)) return QSTEPS[i].id; return null; }
  function renderQual() {
    var host = $('#qual-steps'); if (!host || !state.user) return;
    var done = qualProgress(), active = activeStep();
    $('#qual-bar').style.width = (done / QSTEPS.length * 100) + '%';
    $('#qual-count').textContent = done + ' of ' + QSTEPS.length + ' complete';
    host.innerHTML = QSTEPS.map(function (s, i) {
      var isDone = stepDone(s.id), isActive = s.id === active, cls = isDone ? 'done' : (isActive ? 'active' : 'locked');
      var h = '<div class="qstep ' + cls + '"><div class="qhead"><span class="qnum">' + (isDone ? '✓' : (i + 1)) + '</span><div style="flex:1">';
      h += '<div class="row"><span class="qtitle">' + s.title + '</span>' + statusPill(isDone, isActive) + '</div><p class="qdesc">' + s.desc + '</p>';
      if (isDone) h += '<p class="qdesc good" style="margin-top:6px">' + doneSummary(s.id) + '</p>';
      h += '</div></div>';
      if (isActive) h += '<div class="qbody">' + stepBody(s.id) + '</div>';
      return h + '</div>';
    }).join('');
    $('#qual-final').hidden = !(done === QSTEPS.length && !state.user.qualified);
  }
  function statusPill(done, active) { return done ? '<span class="pill good">Verified</span>' : (active ? '<span class="pill warn">In progress</span>' : '<span class="pill">Locked</span>'); }
  function doneSummary(id) {
    var u = state.user;
    if (id === 'vehicle') return u.vehicle.make + ' · ' + u.vehicle.year + ' — eligible';
    if (id === 'docs') return 'All ' + DOCS.length + ' documents uploaded';
    if (id === 'inspection') return 'Inspection passed';
    if (id === 'background') return 'Identity & history cleared';
    return '';
  }
  function stepBody(id) {
    if (id === 'vehicle') {
      var years = ''; for (var y = 2024; y >= 2014; y--) years += '<option value="' + y + '">' + y + (y < 2018 ? ' — not eligible' : '') + '</option>';
      return '<div class="field app"><label>Make & model</label><input id="q-make" value="Toyota Corolla"></div>' +
        '<div class="field app"><label>Model year</label><select id="q-year"><option value="">Select year…</option>' + years + '</select></div>' +
        '<p class="xs muted" style="margin-bottom:10px">You drive your own car. OneUp only accepts vehicles from <b>2018 or newer</b>.</p>' +
        '<div id="q-vehicle-err"></div><button class="btn solid block" data-q="vehicle">Save vehicle</button>';
    }
    if (id === 'docs') {
      var rows = DOCS.map(function (d) {
        var up = state.user.docs.indexOf(d) !== -1;
        return '<div class="docrow"><span class="dn">' + d + '</span>' + (up ? '<span class="pill good">Uploaded</span>' : '<button class="btn line sm" data-doc="' + d + '">Upload</button>') + '</div>';
      }).join('');
      var n = state.user.docs.length;
      return rows + '<p class="xs muted" style="margin-top:10px;text-align:center">' + n + ' of ' + DOCS.length + ' uploaded' + (n >= DOCS.length ? ' — complete' : '') + '</p>';
    }
    if (id === 'inspection') {
      if (!state.inspectionBooked) return '<p class="qdesc" style="margin-bottom:10px">Book a 20-minute inspection at a OneUp centre. We check brakes, tyres, lights, AC and cleanliness.</p><button class="btn solid block" data-q="book-inspection">Book inspection</button>';
      return '<div class="banner ok" style="margin-bottom:10px"><span>Booked for tomorrow, 10:00 — Lekki centre.</span></div><button class="btn solid block" data-q="inspection">Mark inspection passed (demo)</button>';
    }
    if (id === 'background') {
      if (state.bgRunning) return '<div class="center-stack" style="padding:14px 0"><div class="spin"></div><p>Running check…</p></div>';
      return '<p class="qdesc" style="margin-bottom:10px">We verify your identity (NIN) and driving history. Usually under 24 hours.</p><button class="btn solid block" data-q="background">Run background check</button>';
    }
    return '';
  }
  function renderVehicle() {
    var u = state.user, host = $('#dv-vehicle-body'); if (!host || !u) return;
    var v = u.vehicle.year ? (u.vehicle.make + ' · ' + u.vehicle.year) : 'Not added yet';
    var eligible = u.vehicle.year && u.vehicle.year >= 2018;
    var docRows = DOCS.map(function (d) {
      var up = u.docs.indexOf(d) !== -1;
      return '<div class="listrow"><span class="lt">' + d + '</span>' + (up ? '<span class="pill good">Verified</span>' : '<span class="pill warn">Pending</span>') + '</div>';
    }).join('');
    host.innerHTML =
      '<div class="card"><p class="xs muted" style="text-transform:uppercase;letter-spacing:.08em;font-weight:700">Your car</p><p style="font-size:19px;font-weight:700;margin-top:4px">' + v + '</p>' +
      '<div class="row" style="margin-top:8px"><span class="sm muted">2018+ requirement</span>' + (eligible ? '<span class="pill good">Met</span>' : '<span class="pill warn">Not met</span>') + '</div>' +
      '<p class="xs muted" style="margin-top:10px">You own and drive this vehicle. OneUp inspects it and helps you keep it to standard — and funds a newer one as you rank up.</p></div>' +
      '<div class="card"><p class="xs muted" style="text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:6px">Documents</p>' + docRows + '</div>' +
      '<div class="card"><div class="row"><span class="sm">Inspection</span>' + (u.inspection ? '<span class="pill good">Passed</span>' : '<span class="pill warn">Pending</span>') + '</div>' +
      '<div class="row" style="margin-top:8px"><span class="sm">Background check</span>' + (u.background ? '<span class="pill good">Cleared</span>' : '<span class="pill warn">Pending</span>') + '</div></div>';
  }
  function renderDriverHome() { var u = state.user; if (!u) return; $('#dv-qbanner').hidden = !u.qualified; $('#dv-today').textContent = money(u.earningsToday); }
  function renderDriverJobs() { var u = state.user; if (u) $('#dv-jobs-today').textContent = money(u.earningsToday); }

  function qualAction(action, extra) {
    var payload = { action: action };
    if (extra) for (var k in extra) payload[k] = extra[k];
    return api('/qualification', 'POST', payload).then(function (r) { state.user = r.user; updateTabLocks(); return r.user; });
  }
  function completeJob() {
    var amt = 1104, total = null;
    api('/trips', 'POST', { from: 'Lekki Phase 1', to: 'Victoria Island', km: 9.2 })
      .then(function (r) { state.user = r.user; state.trips.unshift(r.trip); amt = r.trip.amount; total = r.user.earningsToday; renderTripLists(); })
      .catch(function (e) { toast(e.message); })
      .then(function () { show('dv-done'); $('#dv-done-amt').textContent = '+₦' + amt.toLocaleString(); if (total != null) $('#dv-done-total').textContent = money(total); });
  }

  // online toggle
  var tog = $('#d-toggle');
  function goOnline() { tog.classList.add('on'); tog.setAttribute('aria-checked', 'true'); $('#d-status').textContent = "You're online"; show('dv-online'); }
  tog.addEventListener('click', goOnline);
  tog.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); goOnline(); } });

  // reset / start over
  $('#reset').addEventListener('click', function () {
    if (state.role === 'rider') show('r-home');
    else { tog.classList.remove('on'); tog.setAttribute('aria-checked', 'false'); $('#d-status').textContent = "You're offline"; show(qualified() ? 'dv-home' : 'dv-qualify'); }
  });

  // ---------------------------------------------------- global click router
  document.addEventListener('click', function (e) {
    var out = e.target.closest('[data-logout]');
    if (out) { setToken(''); state.user = null; state.trips = []; showPage('landing'); return; }
    var home = e.target.closest('[data-home]'); if (home) { showPage('landing'); return; }
    var sc = e.target.closest('[data-scroll]');
    if (sc) { var t = $('#' + sc.dataset.scroll); if (pages.landing.classList.contains('on') && t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } else showPage('landing'); return; }
    var au = e.target.closest('[data-auth]'); if (au) { openAuth(au.dataset.auth, au.dataset.role, au.dataset.plan); return; }

    // qualification
    var q = e.target.closest('[data-q]');
    if (q) {
      var act = q.dataset.q;
      if (act === 'vehicle') {
        var yr = parseInt(($('#q-year') || {}).value, 10), make = ($('#q-make') || {}).value || 'Your car';
        if (!yr) { $('#q-vehicle-err').innerHTML = '<p class="err">Please select your car’s model year.</p>'; return; }
        if (yr < 2018) { $('#q-vehicle-err').innerHTML = '<p class="err">Sorry — a ' + yr + ' vehicle isn’t eligible. OneUp requires 2018 or newer. Use a qualifying car.</p>'; return; }
        qualAction('vehicle', { make: make, year: yr }).then(renderQual).catch(function (er) { $('#q-vehicle-err').innerHTML = '<p class="err">' + er.message + '</p>'; });
      } else if (act === 'book-inspection') { state.inspectionBooked = true; renderQual(); }
      else if (act === 'inspection') { qualAction('inspection').then(renderQual).catch(function (er) { toast(er.message); }); }
      else if (act === 'background') { state.bgRunning = true; renderQual(); delay(function () { qualAction('background').then(function () { state.bgRunning = false; renderQual(); }).catch(function (er) { state.bgRunning = false; toast(er.message); renderQual(); }); }, 1500); }
      else if (act === 'submit') {
        $('#qual-final').innerHTML = '<div class="center-stack" style="padding:18px 0"><div class="spin"></div><p>Reviewing your application…</p></div>';
        delay(function () { qualAction('submit').then(function (u) { if (u.qualified) { toast('You’re qualified — jobs unlocked.'); show('dv-home'); } }).catch(function (er) { toast(er.message); renderQual(); }); }, 1600);
      }
      return;
    }
    var doc = e.target.closest('[data-doc]'); if (doc) { qualAction('doc', { name: doc.dataset.doc }).then(renderQual).catch(function (er) { toast(er.message); }); return; }

    // ride / job flow
    var go = e.target.closest('[data-go]');
    if (go) { var v = go.dataset.go; if (v === 'r-complete') completeRide(); else if (v === 'dv-done') completeJob(); else show(v); return; }
    var pick = e.target.closest('[data-pick]'); if (pick) { switchPlan(pick.dataset.pick); return; }
    var sw = e.target.closest('[data-switch]'); if (sw) { switchPlan(sw.dataset.switch); return; }
    var biz = e.target.closest('[data-biz]'); if (biz) { $('#biz').hidden = false; return; }
  });
  $('#bizclose').addEventListener('click', function () { $('#biz').hidden = true; });
  $('#biz').addEventListener('click', function (e) { if (e.target === $('#biz')) $('#biz').hidden = true; });

  // ----------------------------------------------------------------- boot
  syncAuth();
  (function boot() {
    if (!token()) { showPage('landing'); return; }
    api('/me').then(function (r) { state.user = r.user; return enterApp(); })
      .catch(function () { setToken(''); showPage('landing'); });
  })();
})();
