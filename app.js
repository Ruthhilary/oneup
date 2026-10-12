/* OneUp prototype — all interactivity. Vanilla JS, no dependencies. */
(function () {
  'use strict';

  // ---------------------------------------------------------------- state
  var state = {
    role: 'rider', mode: 'create', pendingPlan: null,
    plan: 'Commuter', planKm: 620, kmUsed: 93,
    driverQualified: false,
    qual: { vehicle: false, docs: false, inspection: false, background: false },
    vehicle: { make: '', year: null },
    inspectionBooked: false,
    bgRunning: false,
    docs: {}
  };
  var DOCS = ["Driver's licence", "Vehicle registration", "Insurance certificate", "Roadworthiness certificate", "Proof the car is yours"];
  var QSTEPS = [
    { id: 'vehicle', title: 'Your vehicle', desc: 'Must be a 2018 or newer car that you own and drive.' },
    { id: 'docs', title: 'Documents', desc: 'Upload your licence and the car’s papers.' },
    { id: 'inspection', title: 'Vehicle inspection', desc: 'Book and pass a safety & condition check.' },
    { id: 'background', title: 'Background check', desc: 'Identity and driving-history verification.' }
  ];

  // --------------------------------------------------------------- helpers
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var money = function (n) { return '₦' + n.toLocaleString(); };
  var reduce = function () { return matchMedia('(prefers-reduced-motion:reduce)').matches; };
  var timer = null;
  function delay(fn, ms) { if (timer) clearTimeout(timer); timer = setTimeout(fn, reduce() ? 500 : ms); }

  // ---------------------------------------------------------------- router
  var pages = { landing: $('#page-landing'), auth: $('#page-auth'), app: $('#page-app') };
  var nav = $('#nav');
  function showPage(name) {
    Object.keys(pages).forEach(function (k) { var on = k === name; pages[k].classList.toggle('on', on); pages[k].hidden = !on; });
    nav.hidden = (name !== 'landing');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // ------------------------------------------------------------------ auth
  var title = $('#auth-title'), submit = $('#authsubmit'), fName = $('#f-name');
  function syncAuth() {
    $$('[data-role-pick]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.rolePick === state.role); });
    $$('[data-mode]').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.mode === state.mode); });
    fName.style.display = state.mode === 'create' ? 'block' : 'none';
    var noun = state.role === 'rider' ? 'rider' : 'driver';
    title.textContent = state.mode === 'create' ? 'Create your account' : 'Welcome back';
    submit.textContent = state.mode === 'create' ? 'Create ' + noun + ' account' : 'Sign in as ' + noun;
  }
  function openAuth(m, r, plan) { state.mode = m || 'create'; if (r) state.role = r; if (plan) state.pendingPlan = plan; syncAuth(); showPage('auth'); }
  $$('[data-role-pick]').forEach(function (b) { b.addEventListener('click', function () { state.role = b.dataset.rolePick; syncAuth(); }); });
  $$('[data-mode]').forEach(function (b) { b.addEventListener('click', function () { state.mode = b.dataset.mode; syncAuth(); }); });
  $('#authform').addEventListener('submit', function (e) { e.preventDefault(); enterApp(); });

  // ------------------------------------------------------------- enter app
  function enterApp() {
    showPage('app');
    var driver = state.role === 'driver';
    $('#app-role').textContent = driver ? 'Driver' : 'Rider';
    $('#sb-role').textContent = driver ? 'OneUp · Driver' : 'OneUp · Rider';
    $('#tabs-rider').classList.toggle('on', !driver);
    $('#tabs-driver').classList.toggle('on', driver);
    if (!driver) {
      if (state.mode === 'create') {
        if (state.pendingPlan) { setPlan(state.pendingPlan); show('r-home'); }
        else show('r-plans');
      } else { setPlan('Commuter'); show('r-home'); }
    } else {
      if (state.mode === 'signin') {         // returning, already-qualified driver
        state.driverQualified = true;
        state.qual = { vehicle: true, docs: true, inspection: true, background: true };
        state.vehicle = { make: 'Toyota Corolla', year: 2020 };
        DOCS.forEach(function (d) { state.docs[d] = true; });
        updateTabLocks(); show('dv-home');
      } else {                                // brand new driver → must qualify
        state.driverQualified = false;
        state.qual = { vehicle: false, docs: false, inspection: false, background: false };
        state.vehicle = { make: '', year: null }; state.inspectionBooked = false; state.docs = {};
        updateTabLocks(); show('dv-qualify');
      }
    }
  }

  // --------------------------------------------------------- screen + tabs
  var VIEW_TAB = {
    'r-home': 'home', 'r-book': 'book', 'r-matching': 'book', 'r-matched': 'book', 'r-trip': 'book', 'r-complete': 'book',
    'r-plans': 'plan', 'r-trips': 'trips', 'r-plan': 'plan', 'r-account': 'account',
    'dv-qualify': 'home', 'dv-home': 'home', 'dv-jobs': 'jobs', 'dv-online': 'jobs', 'dv-request': 'jobs',
    'dv-enroute': 'jobs', 'dv-trip': 'jobs', 'dv-done': 'jobs', 'dv-trips': 'trips', 'dv-vehicle': 'vehicle', 'dv-account': 'account'
  };
  var GUIDE = {
    'r-plans': 'Pick a plan — tap a <b>Choose</b> button.',
    'r-home': 'Your home tab. Tap <b>Book a ride</b>, or explore the tabs below.',
    'r-book': 'Pickup & destination are set. Tap <b>Confirm pickup</b>.',
    'r-matching': 'Finding your driver…', 'r-matched': 'Tap <b>Driver’s here — get in</b>.',
    'r-trip': 'Tap <b>Arrive at destination</b>.', 'r-complete': 'Tap <b>Done</b> to return home.',
    'r-trips': 'Your past rides.', 'r-plan': 'Your plan — tap another to switch.', 'r-account': 'Your profile & billing.',
    'dv-qualify': 'Complete all 4 checks to start earning. The active step is highlighted.',
    'dv-home': 'You’re qualified. Tap the <b>Jobs</b> tab to go online.',
    'dv-jobs': 'Slide the switch to go online for jobs.', 'dv-online': 'Tap <b>A ride request comes in</b>.',
    'dv-request': 'You’re cleared to drive — tap <b>Accept</b>.', 'dv-enroute': 'Tap <b>Arrived · start trip</b>.',
    'dv-trip': 'Tap <b>Complete trip</b>.', 'dv-done': 'Tap <b>Back online</b> for the next job.',
    'dv-trips': 'Your completed jobs & payouts.', 'dv-vehicle': 'Your car and its documents.', 'dv-account': 'Your profile.'
  };
  var gtext = $('#guide .g-text');

  function show(view) {
    var scr = $('[data-screen="' + view + '"]'); if (!scr) return;
    $$('.app-screen').forEach(function (s) { s.classList.remove('on'); });
    scr.classList.add('on');
    var v = $('#page-app .view'); if (v) v.scrollTop = 0;
    if (GUIDE[view]) gtext.innerHTML = GUIDE[view];
    // highlight tab
    var tab = VIEW_TAB[view];
    var bar = state.role === 'driver' ? $('#tabs-driver') : $('#tabs-rider');
    $$('button', bar).forEach(function (b) { b.setAttribute('aria-current', b.dataset.tab === tab ? 'true' : 'false'); });
    // per-view renders
    if (view === 'dv-qualify') renderQual();
    if (view === 'dv-vehicle') renderVehicle();
    if (view === 'dv-home') renderDriverHome();
    if (view === 'r-plan') renderPlanView();
    if (view === 'r-matching') delay(function () { show('r-matched'); }, 1800);
  }

  function updateTabLocks() {
    var bar = $('#tabs-driver');
    $$('button', bar).forEach(function (b) {
      var locked = !state.driverQualified && (b.dataset.tab === 'jobs' || b.dataset.tab === 'trips');
      b.classList.toggle('locked', locked);
      var lk = $('.lockdot', b); if (lk) lk.hidden = !locked;
    });
  }

  function clickTab(bar, tab) {
    if (state.role === 'driver') {
      if (!state.driverQualified && (tab === 'jobs' || tab === 'trips')) {
        gtext.innerHTML = 'Finish <b>qualification</b> first — you can’t take jobs until your car is verified.';
        show('dv-qualify'); return;
      }
      var map = { home: state.driverQualified ? 'dv-home' : 'dv-qualify', jobs: 'dv-jobs', trips: 'dv-trips', vehicle: 'dv-vehicle', account: 'dv-account' };
      show(map[tab]);
    } else {
      var rmap = { home: 'r-home', book: 'r-book', trips: 'r-trips', plan: 'r-plan', account: 'r-account' };
      show(rmap[tab]);
    }
  }
  $$('.tabbar').forEach(function (bar) {
    bar.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) clickTab(bar, b.dataset.tab); });
  });

  // --------------------------------------------------------- rider: plans
  function setPlan(name) {
    var km = name === 'Lite' ? 280 : (name === 'Pro' ? 1300 : 620);
    var rate = name === 'Lite' ? 143 : (name === 'Pro' ? 115 : 129);
    var price = name === 'Lite' ? 40000 : (name === 'Pro' ? 150000 : 80000);
    state.plan = name; state.planKm = km; state.rate = rate; state.price = price;
    state.kmUsed = name === 'Lite' ? 60 : (name === 'Pro' ? 160 : 93);
    renderRiderHome();
  }
  function renderRiderHome() {
    var left = state.planKm - state.kmUsed;
    $('#r-planbadge').textContent = state.plan;
    $('#r-kmleft').textContent = left.toLocaleString();
    $('#r-kmtotal').textContent = 'of ' + state.planKm.toLocaleString() + ' km';
    $('#r-rate').textContent = 'Flat ₦' + state.rate + '/km · no surge';
    $('#r-ring').style.setProperty('--p', Math.round(left / state.planKm * 100));
    $('#r-spend').textContent = money(state.price);
    $('#r-used').textContent = state.kmUsed + ' km';
    $('#r-after').textContent = (left - 9.2).toFixed(1) + ' km';
  }
  function renderPlanView() {
    $$('#r-plan [data-planopt]').forEach(function (c) {
      var cur = c.dataset.planopt === state.plan;
      c.classList.toggle('fill', cur);
      $('.planopt-btn', c).textContent = cur ? 'Current plan' : 'Switch to ' + c.dataset.planopt;
      $('.planopt-btn', c).disabled = cur;
    });
  }

  // ------------------------------------------------ driver: qualification
  function qualProgress() { var d = 0; QSTEPS.forEach(function (s) { if (state.qual[s.id]) d++; }); return d; }
  function activeStep() { for (var i = 0; i < QSTEPS.length; i++) { if (!state.qual[QSTEPS[i].id]) return QSTEPS[i].id; } return null; }

  function renderQual() {
    var host = $('#qual-steps'); if (!host) return;
    var done = qualProgress(), active = activeStep();
    $('#qual-bar').style.width = (done / QSTEPS.length * 100) + '%';
    $('#qual-count').textContent = done + ' of ' + QSTEPS.length + ' complete';
    var html = '';
    QSTEPS.forEach(function (s, i) {
      var isDone = state.qual[s.id], isActive = s.id === active, cls = isDone ? 'done' : (isActive ? 'active' : 'locked');
      html += '<div class="qstep ' + cls + '">';
      html += '<div class="qhead"><span class="qnum">' + (isDone ? '✓' : (i + 1)) + '</span>';
      html += '<div style="flex:1"><div class="row"><span class="qtitle">' + s.title + '</span>' + statusPill(s.id, isDone, isActive) + '</div><p class="qdesc">' + s.desc + '</p>';
      if (isDone) html += '<p class="qdesc good" style="margin-top:6px">' + doneSummary(s.id) + '</p>';
      html += '</div></div>';
      if (isActive) html += '<div class="qbody">' + stepBody(s.id) + '</div>';
      html += '</div>';
    });
    host.innerHTML = html;
    // final review block
    var fin = $('#qual-final');
    fin.hidden = !(done === QSTEPS.length && !state.driverQualified);
  }
  function statusPill(id, done, active) {
    if (done) return '<span class="pill good">Verified</span>';
    if (active) return '<span class="pill warn">In progress</span>';
    return '<span class="pill">Locked</span>';
  }
  function doneSummary(id) {
    if (id === 'vehicle') return state.vehicle.make + ' · ' + state.vehicle.year + ' — eligible';
    if (id === 'docs') return 'All ' + DOCS.length + ' documents uploaded';
    if (id === 'inspection') return 'Inspection passed';
    if (id === 'background') return 'Identity & history cleared';
    return '';
  }
  function stepBody(id) {
    if (id === 'vehicle') {
      var years = '';
      for (var y = 2024; y >= 2014; y--) years += '<option value="' + y + '">' + y + (y < 2018 ? ' — not eligible' : '') + '</option>';
      return '<div class="field app"><label>Make & model</label><input id="q-make" value="Toyota Corolla"></div>' +
        '<div class="field app"><label>Model year</label><select id="q-year"><option value="">Select year…</option>' + years + '</select></div>' +
        '<p class="xs muted" style="margin-bottom:10px">You drive your own car. OneUp only accepts vehicles from <b>2018 or newer</b>.</p>' +
        '<div id="q-vehicle-err"></div>' +
        '<button class="btn solid block" data-q="save-vehicle">Save vehicle</button>';
    }
    if (id === 'docs') {
      var rows = DOCS.map(function (d) {
        var up = !!state.docs[d];
        return '<div class="docrow"><span class="dn">' + d + '</span>' +
          (up ? '<span class="pill good">Uploaded</span>' : '<button class="btn line sm" data-doc="' + d + '">Upload</button>') + '</div>';
      }).join('');
      var n = DOCS.filter(function (d) { return state.docs[d]; }).length;
      return rows + '<button class="btn solid block" style="margin-top:12px" data-q="save-docs"' + (n < DOCS.length ? ' disabled' : '') + '>Continue (' + n + '/' + DOCS.length + ')</button>';
    }
    if (id === 'inspection') {
      if (!state.inspectionBooked)
        return '<p class="qdesc" style="margin-bottom:10px">Book a 20-minute inspection at a OneUp centre. We check brakes, tyres, lights, AC and cleanliness.</p><button class="btn solid block" data-q="book-inspection">Book inspection</button>';
      return '<div class="banner ok" style="margin-bottom:10px"><span>Booked for tomorrow, 10:00 — Lekki centre.</span></div><button class="btn solid block" data-q="pass-inspection">Mark inspection passed (demo)</button>';
    }
    if (id === 'background') {
      if (state.bgRunning) return '<div class="center-stack" style="padding:14px 0"><div class="spin"></div><p>Running check…</p></div>';
      return '<p class="qdesc" style="margin-bottom:10px">We verify your identity (NIN) and driving history. Usually under 24 hours.</p><button class="btn solid block" data-q="run-bg">Run background check</button>';
    }
    return '';
  }

  // qualification actions (delegated)
  document.addEventListener('click', function (e) {
    var q = e.target.closest('[data-q]');
    if (q) {
      var act = q.dataset.q;
      if (act === 'save-vehicle') {
        var yr = parseInt(($('#q-year') || {}).value, 10);
        var make = ($('#q-make') || {}).value || 'Your car';
        if (!yr) { $('#q-vehicle-err').innerHTML = '<p class="err">Please select your car’s model year.</p>'; return; }
        if (yr < 2018) { $('#q-vehicle-err').innerHTML = '<p class="err">Sorry — a ' + yr + ' vehicle isn’t eligible. OneUp requires 2018 or newer. Update the year or use a qualifying car.</p>'; return; }
        state.vehicle = { make: make, year: yr }; state.qual.vehicle = true; renderQual();
      } else if (act === 'save-docs') { state.qual.docs = true; renderQual(); }
      else if (act === 'book-inspection') { state.inspectionBooked = true; renderQual(); }
      else if (act === 'pass-inspection') { state.qual.inspection = true; renderQual(); }
      else if (act === 'run-bg') { state.bgRunning = true; renderQual(); delay(function () { state.bgRunning = false; state.qual.background = true; renderQual(); }, 1600); }
      else if (act === 'submit-review') {
        $('#qual-final').innerHTML = '<div class="center-stack" style="padding:18px 0"><div class="spin"></div><p>Reviewing your application…</p></div>';
        delay(function () { state.driverQualified = true; updateTabLocks(); show('dv-home'); }, 1700);
      }
      return;
    }
    var doc = e.target.closest('[data-doc]');
    if (doc) { state.docs[doc.dataset.doc] = true; renderQual(); return; }
  });

  // ------------------------------------------------------ driver: vehicle
  function renderVehicle() {
    var host = $('#dv-vehicle-body');
    var v = state.vehicle.year ? (state.vehicle.make + ' · ' + state.vehicle.year) : 'Not added yet';
    var eligible = state.vehicle.year && state.vehicle.year >= 2018;
    var rows = DOCS.map(function (d) {
      var up = !!state.docs[d];
      return '<div class="listrow"><span class="lt">' + d + '</span>' + (up ? '<span class="pill good">Verified</span>' : '<span class="pill warn">Pending</span>') + '</div>';
    }).join('');
    host.innerHTML =
      '<div class="card"><p class="xs muted" style="text-transform:uppercase;letter-spacing:.08em;font-weight:700">Your car</p>' +
      '<p style="font-size:19px;font-weight:700;margin-top:4px">' + v + '</p>' +
      '<div class="row" style="margin-top:8px"><span class="sm muted">2018+ requirement</span>' + (eligible ? '<span class="pill good">Met</span>' : '<span class="pill warn">Not met</span>') + '</div>' +
      '<p class="xs muted" style="margin-top:10px">You own and drive this vehicle. OneUp inspects it and helps you keep it to standard — and funds a newer one as you rank up.</p></div>' +
      '<div class="card"><p class="xs muted" style="text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:6px">Documents</p>' + rows + '</div>' +
      '<div class="card"><div class="row"><span class="sm">Inspection</span>' + (state.qual.inspection ? '<span class="pill good">Passed</span>' : '<span class="pill warn">Pending</span>') + '</div>' +
      '<div class="row" style="margin-top:8px"><span class="sm">Background check</span>' + (state.qual.background ? '<span class="pill good">Cleared</span>' : '<span class="pill warn">Pending</span>') + '</div></div>';
  }
  function renderDriverHome() {
    $('#dv-qbanner').hidden = !state.driverQualified;
  }

  // --------------------------------------------------- driver online flow
  var tog = $('#d-toggle');
  function goOnline() { tog.classList.add('on'); tog.setAttribute('aria-checked', 'true'); $('#d-status').textContent = "You're online"; show('dv-online'); }
  tog.addEventListener('click', goOnline);
  tog.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); goOnline(); } });

  // -------------------------------------------------------------- resets
  $('#reset').addEventListener('click', function () {
    if (state.role === 'rider') { setPlan(state.plan); show('r-home'); }
    else {
      tog.classList.remove('on'); tog.setAttribute('aria-checked', 'false'); $('#d-status').textContent = "You're offline";
      show(state.driverQualified ? 'dv-home' : 'dv-qualify');
    }
  });

  // --------------------------------------------- global clicks (routing)
  document.addEventListener('click', function (e) {
    var home = e.target.closest('[data-home]'); if (home) { showPage('landing'); return; }
    var sc = e.target.closest('[data-scroll]');
    if (sc) { var t = $('#' + sc.dataset.scroll); if (pages.landing.classList.contains('on') && t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } else { showPage('landing'); } return; }
    var au = e.target.closest('[data-auth]'); if (au) { openAuth(au.dataset.auth, au.dataset.role, au.dataset.plan); return; }
    var go = e.target.closest('[data-go]'); if (go) { show(go.dataset.go); return; }
    var pick = e.target.closest('[data-pick]'); if (pick) { setPlan(pick.dataset.pick); show('r-home'); return; }
    var sw = e.target.closest('[data-switch]'); if (sw) { setPlan(sw.dataset.switch); renderPlanView(); show('r-home'); return; }
    var biz = e.target.closest('[data-biz]'); if (biz) { $('#biz').hidden = false; return; }
  });
  var bizEl = $('#biz');
  $('#bizclose').addEventListener('click', function () { bizEl.hidden = true; });
  bizEl.addEventListener('click', function (e) { if (e.target === bizEl) bizEl.hidden = true; });

  // ------------------------------------------------------------- init
  setPlan('Commuter');
  updateTabLocks();
  syncAuth();
})();
