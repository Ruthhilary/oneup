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
  var ADMIN_KEY = 'oneup_admin';
  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
  function adminToken() { try { return localStorage.getItem(ADMIN_KEY) || ''; } catch (e) { return ''; } }
  function setAdminToken(t) { try { t ? localStorage.setItem(ADMIN_KEY, t) : localStorage.removeItem(ADMIN_KEY); } catch (e) {} }
  function api(pathname, method, body, tok) {
    return fetch('/api' + pathname, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (tok || token()) },
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
  // surface any script error instead of failing silently
  window.addEventListener('error', function (ev) { try { toast('Script error: ' + (ev.message || 'see console')); } catch (e) {} });
  console.log('OneUp app.js loaded');

  // --------------------------------------------------------------- router
  var pages = { landing: $('#page-landing'), auth: $('#page-auth'), app: $('#page-app'), admin: $('#page-admin') };
  var nav = $('#nav');
  function showPage(name) {
    if (name !== 'app') stopPoll();
    Object.keys(pages).forEach(function (k) { var on = k === name; pages[k].classList.toggle('on', on); pages[k].hidden = !on; });
    nav.hidden = (name !== 'landing');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // ------------------------------------------------------------------ auth
  var titleEl = $('#auth-title'), submitEl = $('#authsubmit'), fName = $('#f-name'), fPhone = $('#f-phone');
  function syncAuth() {
    $$('[data-role-pick]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.rolePick === state.role); });
    $$('[data-mode]').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.mode === state.mode); });
    var creating = state.mode === 'create';
    fName.style.display = creating ? 'block' : 'none';
    if (fPhone) fPhone.style.display = creating ? 'block' : 'none';
    if ($('#auth-err')) $('#auth-err').innerHTML = '';
    var noun = state.role === 'rider' ? 'rider' : 'driver';
    titleEl.textContent = state.mode === 'create' ? 'Create your account' : 'Welcome back';
    submitEl.textContent = state.mode === 'create' ? 'Create ' + noun + ' account' : 'Sign in as ' + noun;
  }
  function openAuth(m, r, plan) { state.mode = m || 'create'; if (r) state.role = r; if (plan) state.pendingPlan = plan; syncAuth(); showPage('auth'); }
  $$('[data-role-pick]').forEach(function (b) { b.addEventListener('click', function () { state.role = b.dataset.rolePick; syncAuth(); }); });
  $$('[data-mode]').forEach(function (b) { b.addEventListener('click', function () { state.mode = b.dataset.mode; syncAuth(); }); });
  function authErr(msg) { var el = $('#auth-err'); if (el) el.innerHTML = msg ? '<p class="err" style="margin:2px 0 4px">' + msg + '</p>' : ''; }
  $('#authform').addEventListener('submit', function (e) {
    e.preventDefault();
    authErr('');
    var email = $('#a-email').value.trim(), pass = $('#a-pass').value;
    var name = $('#a-name').value.trim(), phone = ($('#a-phone') ? $('#a-phone').value.trim() : '');
    var creating = state.mode === 'create';
    if (creating && name.length < 2) { authErr('Please enter your full name.'); return; }
    if (!email) { authErr('Enter your email.'); return; }
    if (!pass) { authErr('Enter your password.'); return; }
    if (creating && pass.length < 8) { authErr('Password must be at least 8 characters.'); return; }
    submitEl.disabled = true;
    var req = creating
      ? api('/signup', 'POST', { role: state.role, name: name, email: email, phone: phone, password: pass, plan: state.pendingPlan || 'Starter' })
      : api('/login', 'POST', { role: state.role, email: email, password: pass });
    req.then(function (data) { setToken(data.token); state.user = data.user; return enterApp(); })
      .catch(function (e) { authErr(e.message || 'Could not sign in.'); })
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
    'dv-enroute': 'jobs', 'dv-trip': 'jobs', 'dv-done': 'jobs', 'dv-shifts': 'jobs', 'dv-trips': 'trips', 'dv-vehicle': 'vehicle', 'dv-account': 'account'
  };
  var GUIDE = {
    'r-home': 'Your home tab. Tap <b>Book a ride</b>, or explore the tabs below.',
    'r-book': 'Pickup & destination are set. Tap <b>Confirm pickup</b>.',
    'r-matching': 'Finding your driver…', 'r-matched': 'Tap <b>Driver’s here — get in</b>.',
    'r-trip': 'Tap <b>Arrive at destination</b> — the trip saves to your account.', 'r-complete': 'Saved. Tap <b>Done</b>.',
    'r-trips': 'Your saved rides.', 'r-plan': 'Tap another plan to switch — it’s saved.', 'r-account': 'Your profile & billing.',
    'dv-qualify': 'Complete all 4 checks to start earning. Progress is saved as you go.',
    'dv-home': 'You’re qualified. Tap the <b>Jobs</b> tab to go online.',
    'dv-jobs': 'Slide the switch to go online, or tap <b>Book shifts</b>.', 'dv-shifts': 'Book high-demand slots — caps keep every driver busy.', 'dv-online': 'You\'re in the dispatch queue. Tap <b>A ride request comes in</b>.',
    'dv-request': 'You’re cleared to drive — tap <b>Accept</b>.', 'dv-enroute': 'Tap <b>Arrived · start trip</b>.',
    'dv-trip': 'Tap <b>Complete trip</b> — the payout saves to your account.', 'dv-done': 'Tap <b>Back online</b>.',
    'dv-trips': 'Your saved jobs & payouts.', 'dv-vehicle': 'Your car and its documents.', 'dv-account': 'Your profile.'
  };
  var gtext = $('#guide .g-text');

  function stopPoll() { if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; } }
  function startPoll() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(function () {
      api('/me').then(function (r) {
        var was = state.user ? state.user.status : null;
        state.user = r.user;
        if (r.user.qualified) { stopPoll(); updateTabLocks(); toast('You’re approved — jobs unlocked.'); show('dv-home'); }
        else if (r.user.status !== was) renderQual();
      }).catch(function () {});
    }, 4000);
  }

  function show(view) {
    var scr = $('[data-screen="' + view + '"]'); if (!scr) return;
    if (view !== 'dv-qualify') stopPoll();
    if (view !== 'dv-online') stopDispatch();
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
    if (view === 'dv-shifts') loadShifts();
    if (view === 'dv-online') enterDispatch();
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
    $('#r-spend').textContent = money(u.billNow != null ? u.billNow : u.price);
    $('#r-used').textContent = Math.round(u.kmUsed) + ' km';
    renderNudge(u);
  }
  // right-size nudge + auto-upgrade notice
  var LADDER = ['Starter', 'Lite', 'Commuter', 'Pro', 'Max'];
  var PLAN_INFO = {
    Starter: { km: 120, price: 20000 }, Lite: { km: 350, price: 57000 },
    Commuter: { km: 700, price: 112000 }, Pro: { km: 1400, price: 224000 }, Max: { km: 2000, price: 310000 }
  };
  // always-visible reminder on the home screen, with an inline action
  function renderNudge(u) {
    var el = $('#r-nudge'); if (!el) return;
    var i = LADDER.indexOf(u.plan), pct = u.planKm ? u.kmUsed / u.planKm : 0, msg = '', btn = '';
    var next = (i > -1 && i < LADDER.length - 1) ? LADDER[i + 1] : null;
    if (u.autoUpgraded) {
      msg = 'You used all your ' + u.plan + ' km — you\'re on ' + u.billPlan + ' for this cycle (' + money(u.billNow) + '), no surge.';
      btn = '<button class="btn solid sm" data-pick="' + u.billPlan + '" style="margin-top:10px">Keep ' + u.billPlan + '</button>';
    } else if (u.overflowKm > 0) {
      msg = 'You\'re past Max by ' + Math.round(u.overflowKm) + ' km — extra rides are a flat ₦' + (u.topRate || 155) + '/km (' + money(u.overflowDue) + '), still no surge.';
    } else if (pct >= 0.8 && next) {
      msg = 'You\'ve used ' + Math.round(pct * 100) + '% of your ' + u.plan + '. At 100% we roll you up to ' + next + ' for the cycle — no surge, no penalty.';
      btn = '<button class="btn line sm" data-pick="' + next + '" style="margin-top:10px">Upgrade to ' + next + ' now</button>';
    } else if (pct <= 0.35 && i > 0) {
      msg = 'You\'re only using ' + Math.round(pct * 100) + '% of your plan. Switch to ' + LADDER[i - 1] + ' and pay less.';
      btn = '<button class="btn line sm" data-pick="' + LADDER[i - 1] + '" style="margin-top:10px">Switch to ' + LADDER[i - 1] + '</button>';
    }
    el.innerHTML = msg ? ('<span>' + msg + '</span>' + btn) : '';
    el.style.display = msg ? 'block' : 'none';
  }
  // active pop-up notice — fires after a ride when near or at the limit
  function limitBucket(u) {
    var pct = u.planKm ? u.kmUsed / u.planKm : 0;
    if (u.overflowKm > 0) return 'overmax';
    if (u.autoUpgraded) return 'upgraded';
    if (pct >= 0.8 && LADDER.indexOf(u.plan) < LADDER.length - 1) return 'near';
    return '';
  }
  function checkLimit(u) {
    if (!u || u.role !== 'rider') return;
    var b = limitBucket(u); if (!b) { state.limitKey = ''; return; }
    var key = u.plan + ':' + b;
    if (state.limitKey === key) return;   // don't nag for the same state twice
    state.limitKey = key;
    openLimitNotice(u, b);
  }
  function openLimitNotice(u, b) {
    var t = $('#limit-title'), body = $('#limit-body'), acts = $('#limit-actions'); if (!t) return;
    var i = LADDER.indexOf(u.plan), next = LADDER[i + 1];
    if (b === 'near') {
      var np = PLAN_INFO[next] || {};
      t.textContent = 'You\'re close to your limit';
      body.innerHTML = 'You\'ve used <b>' + Math.round(u.kmUsed) + ' of ' + u.planKm + ' km</b> on ' + u.plan +
        ' (' + Math.round(u.kmUsed / u.planKm * 100) + '%).<br><br>When you reach the limit, OneUp automatically moves you up to <b>' + next +
        '</b> for this cycle — a flat ' + money(np.price) + ' (' + (np.km || '') + ' km), <b>no surge and no penalty</b>. ' +
        'Upgrade now to lock in the bigger allowance, or keep riding and we\'ll handle it for you.';
      acts.innerHTML = '<button class="btn solid" data-pick="' + next + '">Upgrade to ' + next + '</button><button class="btn line" data-limitclose>Not now</button>';
    } else if (b === 'upgraded') {
      t.textContent = 'You\'ve been moved to ' + u.billPlan;
      body.innerHTML = 'You used all your ' + u.plan + ' km, so for the rest of this cycle you\'re on <b>' + u.billPlan +
        '</b> — a flat <b>' + money(u.billNow) + '</b>, still no surge, no penalty.<br><br>Make ' + u.billPlan +
        ' your plan to keep the bigger allowance next month too.';
      acts.innerHTML = '<button class="btn solid" data-pick="' + u.billPlan + '">Keep ' + u.billPlan + '</button><button class="btn line" data-limitclose>Stay on ' + u.plan + '</button>';
    } else {
      t.textContent = 'You\'re past the biggest plan';
      body.innerHTML = 'You\'ve gone <b>' + Math.round(u.overflowKm) + ' km</b> beyond Max. Extra km are a flat <b>₦' +
        (u.topRate || 155) + '/km</b> (' + money(u.overflowDue) + ') — still no surge. That\'s the fairest rate we have; a dedicated car may suit you better.';
      acts.innerHTML = '<button class="btn solid" data-limitclose>Got it</button>';
    }
    $('#limit').hidden = false;
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
      .then(function () { show('r-complete'); checkLimit(state.user); });
  }
  function switchPlan(plan) {
    api('/plan', 'POST', { plan: plan })
      .then(function (r) { state.user = r.user; state.limitKey = ''; $('#limit').hidden = true; renderRiderHome(); renderPlanView(); toast('Plan updated to ' + plan + '.'); show('r-home'); })
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

    var fin = $('#qual-final'), u = state.user;
    if (u.qualified) { fin.hidden = true; stopPoll(); }
    else if (u.status === 'pending') {
      fin.hidden = false;
      fin.innerHTML = '<div class="card fill"><div class="row"><b>Application submitted</b><span class="pill warn">Under review</span></div>' +
        '<p class="sm muted" style="margin-top:6px">A OneUp admin is reviewing your car, documents, inspection and background check. You’ll be cleared to drive once approved — usually within a day.</p>' +
        '<button class="btn line block" style="margin-top:12px" data-check>Check status</button></div>';
      startPoll();
    }
    else if (done === QSTEPS.length) {
      fin.hidden = false;
      var rej = u.status === 'rejected' ? '<div class="banner warn" style="margin-bottom:10px"><span><b>Not approved.</b> ' + (u.rejectReason || 'Please review your details and resubmit.') + '</span></div>' : '';
      fin.innerHTML = rej + '<div class="card fill"><b>All checks complete</b><p class="sm muted" style="margin-top:4px">Submit your application — a OneUp admin will review and approve it.</p><button class="btn solid block" style="margin-top:12px" data-q="submit">Submit for review</button></div>';
    }
    else { fin.hidden = true; }
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
        '<div class="field app"><label>Fuel type</label><select id="q-fuel"><option value="hybrid">Hybrid — recommended</option><option value="cng">CNG — where refuelling exists</option><option value="petrol">Petrol (thirsty)</option></select></div>' +
        '<p class="xs muted" style="margin-bottom:10px">You drive your own car (<b>2018 or newer</b>). With Lagos fuel high, OneUp gives <b>efficient & hybrid</b> cars priority — they earn the most. Thirsty petrol cars earn least.</p>' +
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
    var nudge = (u.vehicle.fuel === 'petrol')
      ? '<div class="banner warn" style="margin-top:10px"><span>Thirsty petrol eats most of your pay in Lagos. Move to a <b>hybrid</b> (ordinary petrol, no special refuelling) to lift your take-home to ~₦55/km — OneUp gives efficient cars priority.</span></div>'
      : '<div class="banner ok" style="margin-top:10px"><span>Efficient car — low fuel cost, so your net per km is strong and you get priority jobs.</span></div>';
    host.innerHTML =
      '<div class="card"><p class="xs muted" style="text-transform:uppercase;letter-spacing:.08em;font-weight:700">Your car</p><p style="font-size:19px;font-weight:700;margin-top:4px">' + v + (u.fuelLabel ? ' · ' + u.fuelLabel : '') + '</p>' +
      '<div class="row" style="margin-top:8px"><span class="sm muted">2018+ requirement</span>' + (eligible ? '<span class="pill good">Met</span>' : '<span class="pill warn">Not met</span>') + '</div>' +
      '<p class="xs muted" style="margin-top:10px">You own and drive this vehicle. OneUp inspects it and helps you keep it to standard — and funds a newer one as you rank up.</p></div>' +
      '<div class="card"><p class="xs muted" style="text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:6px">Your earnings per km</p>' +
      '<div class="row"><span class="sm">OneUp pays you</span><b class="sm num">₦' + u.payPerKm + '/km</b></div>' +
      '<div class="row" style="margin-top:6px"><span class="sm">Fuel (' + u.fuelLabel + ')</span><b class="sm num">−₦' + u.fuelPerKm + '/km</b></div>' +
      '<div class="row" style="margin-top:6px"><span class="sm">Maintenance</span><b class="sm num">−₦18/km</b></div>' +
      '<hr style="margin:10px 0"><div class="row"><span class="sm"><b>Your take-home</b></span><b class="sm num ' + (u.netPerKm > 0 ? 'good' : 'bad') + '">₦' + u.netPerKm + '/km</b></div>' + nudge + '</div>' +
      '<div class="card"><p class="xs muted" style="text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:6px">Documents</p>' + docRows + '</div>' +
      '<div class="card"><div class="row"><span class="sm">Inspection</span>' + (u.inspection ? '<span class="pill good">Passed</span>' : '<span class="pill warn">Pending</span>') + '</div>' +
      '<div class="row" style="margin-top:8px"><span class="sm">Background check</span>' + (u.background ? '<span class="pill good">Cleared</span>' : '<span class="pill warn">Pending</span>') + '</div></div>';
  }
  function tierNext(t) {
    var m = {
      Bronze: 'Reach 25 trips & 30 hrs a week to make Silver — unlocks a ₦70,000 weekly floor.',
      Silver: 'Reach 45 trips & 40 hrs a week to make Gold — ₦95,000 floor and +₦10/km.',
      Gold: 'Reach 70 trips & 45 hrs a week to make Platinum — ₦120,000 floor, +₦15/km & vehicle financing.',
      Platinum: 'Top tier — ₦120,000 floor, +₦15/km, fuel perks and a path to vehicle financing.'
    };
    return m[t] || '';
  }
  function renderDriverHome() {
    var u = state.user; if (!u) return;
    $('#dv-qbanner').hidden = !u.qualified;
    if ($('#dv-name')) $('#dv-name').textContent = (u.name || 'Driver').split(' ')[0];
    var ti = u.tierInfo;
    if ($('#dv-tierpill')) $('#dv-tierpill').textContent = (ti ? ti.tier : (u.tier || 'Bronze')) + ' driver';
    var host = $('#dv-earnpanel'); if (!host || !ti) return;
    function chip(ok, label) {
      return '<div class="row sm" style="margin-top:6px"><span>' + label + '</span><span class="pill ' + (ok ? 'good' : 'warn') + '">' + (ok ? '✓' : 'needs work') + '</span></div>';
    }
    var floorMsg, cond = '';
    if (ti.tier === 'Bronze') {
      floorMsg = 'You earn per completed trip. Build toward Silver to unlock a weekly guaranteed floor — the more you drive, the more you earn.';
    } else if (ti.floorEligible) {
      floorMsg = 'Active ✓ — you met your ' + ti.tier + ' commitments, so if a slow week falls short we top you up to ' + money(ti.floor) +
        (ti.floorTopUp > 0 ? ' (top-up ' + money(ti.floorTopUp) + ' so far this week).' : '.');
    } else {
      floorMsg = 'Locked this week — the floor activates once you meet your ' + ti.tier + ' commitments (it covers slow demand, not time off):';
      cond = chip(ti.met.hours, ti.onlineHrs + ' / ' + ti.need.minHrs + ' online hours')
        + chip(ti.met.accept, ti.acceptPct + '% / ' + ti.need.minAccept + '% acceptance')
        + chip(ti.met.trips, ti.tripsWeek + ' / ' + ti.need.minTrips + ' trips');
    }
    host.innerHTML =
      '<div class="metrics">'
      + '<div class="metric"><div class="k">Today</div><div class="v num">' + money(u.earningsToday) + '</div><div class="d">0% commission</div></div>'
      + '<div class="metric"><div class="k">This week</div><div class="v num">' + money(ti.weekGuaranteed) + '</div><div class="d">' + (ti.floor ? 'floor ' + money(ti.floor) : 'pay-per-trip') + '</div></div>'
      + '</div>'
      + '<div class="card" style="margin-top:10px"><div class="row"><span class="sm">Weekly guaranteed floor</span><b class="num sm">' + (ti.floor ? money(ti.floor) : '—') + '</b></div>'
      + '<p class="xs muted" style="margin-top:8px">' + floorMsg + '</p>' + cond + '</div>'
      + '<div class="card"><div class="row"><span class="sm">Tier · ' + ti.tier + '</span>' + (ti.bonusPerKm ? '<span class="pill">+₦' + ti.bonusPerKm + '/km bonus</span>' : '') + '</div>'
      + '<p class="xs muted" style="margin-top:8px">' + tierNext(ti.tier) + '</p></div>';
  }
  function renderDriverJobs() { var u = state.user; if (u) $('#dv-jobs-today').textContent = money(u.earningsToday); }

  // -- shift booking --
  function loadShifts() {
    api('/shifts').then(function (r) { renderShifts(r.shifts, r.committedHrs); }).catch(function (e) { toast(e.message); });
  }
  function demandPill(d) {
    var c = d === 'High' ? 'good' : (d === 'Low' ? 'warn' : '');
    return '<span class="pill ' + c + '">' + d + ' demand</span>';
  }
  function renderShifts(shifts, hrs) {
    var host = $('#dv-shiftlist'); if (!host) return;
    var cards = shifts.map(function (s) {
      var right = s.mine
        ? '<button class="btn line sm" data-shift="' + s.id + '" data-shiftact="cancel">Booked ✓ · cancel</button>'
        : (s.full ? '<span class="pill warn">Full</span>'
          : '<button class="btn solid sm" data-shift="' + s.id + '" data-shiftact="book">Book</button>');
      return '<div class="card"><div class="row"><div><b>' + s.zone + '</b><p class="xs muted">' + s.window + '</p></div>' + demandPill(s.demand) + '</div>' +
        '<div class="row sm muted" style="margin-top:8px"><span>' + s.booked + '/' + s.cap + ' drivers · ' + s.spotsLeft + ' spots left</span>' + right + '</div></div>';
    }).join('');
    host.innerHTML =
      '<div class="card fill"><div class="row"><span class="sm">Hours booked this week</span><b class="num sm">' + hrs + ' hrs</b></div>' +
      '<p class="xs muted" style="margin-top:6px">These count toward your weekly tier commitment and unlock your guaranteed floor.</p></div>' + cards;
  }
  function bookShift(id, act) {
    api('/shifts', 'POST', { slotId: id, action: act }).then(function (r) {
      renderShifts(r.shifts, r.committedHrs); toast(act === 'cancel' ? 'Shift cancelled.' : 'Shift booked.');
    }).catch(function (e) { toast(e.message); });
  }

  // -- fair dispatch (queue) --
  function stopDispatch() { if (state.dispatchTimer) { clearInterval(state.dispatchTimer); state.dispatchTimer = null; } }
  function enterDispatch() {
    api('/online', 'POST').then(function (d) { renderDispatch(d); }).catch(function () {});
    stopDispatch();
    state.dispatchTimer = setInterval(function () {
      api('/dispatch').then(renderDispatch).catch(function () {});
    }, 3000);
  }
  function renderDispatch(d) {
    var host = $('#dv-dispatch'); if (!host) return;
    var sub = $('#dv-online-sub'); if (sub) sub.textContent = 'Priority queue · ' + d.zone;
    var body = d.next
      ? '<p class="sm good" style="text-align:center"><b>You\'re next</b> — a ride should come through any moment.</p>'
      : '<p class="sm" style="text-align:center">You\'re <b>#' + d.position + '</b> of ' + d.online + ' online in ' + d.zone + ' · next ride in ~' + d.etaMin + ' min</p>';
    host.innerHTML = '<div class="card" style="margin-top:4px">' + body +
      '<p class="xs muted" style="margin-top:8px;text-align:center">Fair rotation: the longest-waiting driver gets the next ride. After each trip you go to the back — everyone shares the work.</p></div>';
  }

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
        var fuel = ($('#q-fuel') || {}).value || 'petrol';
        qualAction('vehicle', { make: make, year: yr, fuel: fuel }).then(renderQual).catch(function (er) { $('#q-vehicle-err').innerHTML = '<p class="err">' + er.message + '</p>'; });
      } else if (act === 'book-inspection') { state.inspectionBooked = true; renderQual(); }
      else if (act === 'inspection') { qualAction('inspection').then(renderQual).catch(function (er) { toast(er.message); }); }
      else if (act === 'background') { state.bgRunning = true; renderQual(); delay(function () { qualAction('background').then(function () { state.bgRunning = false; renderQual(); }).catch(function (er) { state.bgRunning = false; toast(er.message); renderQual(); }); }, 1500); }
      else if (act === 'submit') {
        $('#qual-final').innerHTML = '<div class="center-stack" style="padding:18px 0"><div class="spin"></div><p>Submitting your application…</p></div>';
        delay(function () { qualAction('submit').then(function () { toast('Submitted — an admin will review it.'); renderQual(); }).catch(function (er) { toast(er.message); renderQual(); }); }, 1200);
      }
      return;
    }
    var chk = e.target.closest('[data-check]');
    if (chk) { api('/me').then(function (r) { state.user = r.user; updateTabLocks(); if (r.user.qualified) { toast('You’re approved — jobs unlocked.'); show('dv-home'); } else { toast('Still under review.'); renderQual(); } }).catch(function (er) { toast(er.message); }); return; }
    var doc = e.target.closest('[data-doc]'); if (doc) { qualAction('doc', { name: doc.dataset.doc }).then(renderQual).catch(function (er) { toast(er.message); }); return; }

    // ride / job flow
    var go = e.target.closest('[data-go]');
    if (go) { var v = go.dataset.go; if (v === 'r-complete') completeRide(); else if (v === 'dv-done') completeJob(); else show(v); return; }
    var pick = e.target.closest('[data-pick]'); if (pick) { switchPlan(pick.dataset.pick); return; }
    var sw = e.target.closest('[data-switch]'); if (sw) { switchPlan(sw.dataset.switch); return; }
    var biz = e.target.closest('[data-biz]'); if (biz) { $('#biz').hidden = false; return; }
    var lc = e.target.closest('[data-limitclose]'); if (lc) { $('#limit').hidden = true; return; }
    var sh = e.target.closest('[data-shift]'); if (sh) { bookShift(sh.dataset.shift, sh.dataset.shiftact); return; }
  });
  $('#bizclose').addEventListener('click', function () { $('#biz').hidden = true; });
  $('#biz').addEventListener('click', function (e) { if (e.target === $('#biz')) $('#biz').hidden = true; });
  $('#limitclose').addEventListener('click', function () { $('#limit').hidden = true; });
  $('#limit').addEventListener('click', function (e) { if (e.target === $('#limit')) $('#limit').hidden = true; });

  // ------------------------------------------------------------------ ADMIN
  function openAdmin() {
    showPage('admin');
    var signed = !!adminToken();
    $('#admin-login').hidden = signed;
    $('#admin-dash').hidden = !signed;
    $('#admin-signout').hidden = !signed;
    if (signed) loadAdmin();
  }
  function loadAdmin() {
    api('/admin/drivers', 'GET', null, adminToken())
      .then(function (r) { renderAdmin(r.drivers); })
      .catch(function (e) { if (e.status === 401) { setAdminToken(''); openAdmin(); } toast(e.message); });
  }
  function adminWhen(iso) { if (!iso) return '—'; try { var d = new Date(iso); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } }
  function renderAdmin(drivers) {
    var pending = drivers.filter(function (d) { return d.status === 'pending'; }).length;
    $('#admin-counts').textContent = drivers.length + ' driver' + (drivers.length === 1 ? '' : 's') + ' · ' + pending + ' pending review';
    var host = $('#admin-list');
    if (!drivers.length) { host.innerHTML = '<p class="sm muted" style="padding:28px 0;text-align:center">No driver applications yet. Create a driver account in the app and submit it for review.</p>'; return; }
    host.innerHTML = drivers.map(function (d) {
      var sp = d.status === 'approved' ? '<span class="pill good">Approved</span>'
        : d.status === 'pending' ? '<span class="pill warn">Pending</span>'
          : d.status === 'rejected' ? '<span class="pill bad">Rejected</span>'
            : '<span class="pill">Not submitted</span>';
      var veh = d.vehicle.year ? (d.vehicle.make + ' · ' + d.vehicle.year) : '—';
      var vpill = d.vehicle.year ? (d.eligible ? '<span class="pill good">2018+</span>' : '<span class="pill bad">Too old</span>') : '';
      var facts = '<div class="afacts">' +
        fact('Vehicle', veh + ' ' + vpill) +
        fact('Documents', d.docsCount + '/' + d.docsTotal) +
        fact('Inspection', d.inspection ? 'Passed' : 'Pending') +
        fact('Background', d.background ? 'Cleared' : 'Pending') +
        fact('Submitted', adminWhen(d.submittedAt)) +
        '</div>';
      var rej = d.status === 'rejected' && d.rejectReason ? '<p class="sm bad" style="margin-top:8px">Reason given: ' + d.rejectReason + '</p>' : '';
      var actions;
      if (d.status === 'approved') {
        actions = '<div class="row" style="margin-top:14px"><span class="sm muted">Cleared to drive.</span><button class="btn line sm" data-reject="' + d.id + '">Revoke</button></div>';
      } else {
        actions = '<input class="areason" placeholder="Reason (used if you reject)"><div class="row" style="gap:10px;margin-top:10px"><button class="btn line" style="flex:1" data-reject="' + d.id + '">Reject</button><button class="btn solid" style="flex:1" data-approve="' + d.id + '">Approve</button></div>';
      }
      return '<div class="acard"><div class="row"><div><b>' + (d.name || 'Driver') + '</b><p class="sm muted">' + d.email + '</p></div>' + sp + '</div>' + facts + rej + actions + '</div>';
    }).join('');
  }
  function fact(k, v) { return '<div class="afact"><span class="ak">' + k + '</span><span class="av">' + v + '</span></div>'; }
  function adminDecision(id, decision, reason) {
    api('/admin/decision', 'POST', { id: Number(id), decision: decision, reason: reason }, adminToken())
      .then(function () { toast('Driver ' + (decision === 'approve' ? 'approved' : 'rejected') + '.'); loadAdmin(); })
      .catch(function (e) { toast(e.message); });
  }
  $('#adminform').addEventListener('submit', function (e) {
    e.preventDefault();
    api('/admin/login', 'POST', { key: $('#admin-key').value })
      .then(function (r) { setAdminToken(r.token); openAdmin(); })
      .catch(function (er) { toast(er.message); });
  });
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-admin]')) { openAdmin(); return; }
    if (e.target.closest('[data-admin-signout]')) { setAdminToken(''); openAdmin(); return; }
    var ap = e.target.closest('[data-approve]'); if (ap) { adminDecision(ap.dataset.approve, 'approve'); return; }
    var rj = e.target.closest('[data-reject]');
    if (rj) { var card = rj.closest('.acard'); var reason = card ? (($('.areason', card) || {}).value || '') : ''; adminDecision(rj.dataset.reject, 'reject', reason); return; }
  });

  // ----------------------------------------------------------------- boot
  syncAuth();
  (function boot() {
    if (!token()) { showPage('landing'); return; }
    api('/me').then(function (r) { state.user = r.user; return enterApp(); })
      .catch(function () { setToken(''); showPage('landing'); });
  })();
})();
