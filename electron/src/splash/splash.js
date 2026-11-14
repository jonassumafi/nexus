/* Nexus returning-player startup splash — vanilla JS port of
 * frontend/src/pages/StartupSplash.jsx. Bundled with the Electron
 * shell (loaded via loadFile) so it paints at renderer-ready, works
 * offline, and never depends on the frontend dev/prod server.
 *
 * Reveal rule: all phases must be ok/offline, 3.5s floor must have
 * passed, and the last log line must have been visible for 450ms.
 */
(function () {
  'use strict';

  var api = window.electronAPI || null;

  // ─── Skin palette (mirror of SK[] in the HTML spec) ──────────────────
  var SKIN_PALETTES = {
    deepblue:   ['#66AADD','#00EEFF','#020C14','#061018','#0A1828','#12263A','#1A3A50','#2A5A7A'],
    obsidian:   ['#b4c2d3','#e4f2ff','#0a0a0c','#101012','#17171a','#202024','#2c2c31','#4a4a52'],
    ember:      ['#e3a655','#ffc766','#0c0806','#130d09','#1c130d','#281a11','#3a2616','#6a4524'],
    oxide:      ['#e2806a','#ffae92','#0e0607','#160a0b','#20100f','#2e1715','#44201c','#7a3a2e'],
    olivedrab:  ['#aec86f','#dff48f','#090b06','#0f120a','#171b0f','#212714','#333b1f','#5c6b34'],
    violetvoid: ['#ae92ee','#e6ceff','#0a0612','#100a1a','#181026','#231738','#34224f','#5b3d8c'],
    abyss:      ['#52c6b3','#80f6e8','#04100f','#081817','#0e2321','#16322f','#1d4642','#2f7a72'],
    dune:       ['#d8bd90','#f3deb4','#100e0c','#181512','#221e19','#2f2922','#403830','#6e6254'],
    carbonpink: ['#ff5fae','#ff8cc6','#030304','#08080a','#0f0f12','#18181c','#25252b','#3e3e47'],
  };
  var PALETTE_VARS = ['--acc','--acc2','--bg0','--bg1','--bg2','--bg3','--rim0','--rim1'];

  function applySkin(id) {
    var p = SKIN_PALETTES[id] || SKIN_PALETTES.deepblue;
    var root = document.documentElement;
    for (var i = 0; i < PALETTE_VARS.length; i++) {
      root.style.setProperty(PALETTE_VARS[i], p[i]);
    }
  }

  // Skin is passed as a query param on loadFile (?skin=deepblue). Falls
  // back to deepblue if missing or unknown.
  (function readSkinFromQuery() {
    try {
      var qs = new URLSearchParams(window.location.search);
      var id = (qs.get('skin') || 'deepblue').trim();
      applySkin(id);
    } catch (e) { applySkin('deepblue'); }
  })();

  // Reduced-motion detection + report to main.
  var reducedMotion = false;
  try {
    reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}
  if (reducedMotion) document.body.classList.add('reduced');
  try { api && api.startup && api.startup.reportReducedMotion && api.startup.reportReducedMotion(reducedMotion); } catch (e) {}

  // Stamp the version into the footer.
  try {
    var v = api && api.companion && api.companion.version;
    document.getElementById('ver').textContent = 'VERSION ' + (v || '');
  } catch (e) {}

  // ─── Phase model (verbatim from StartupSplash.jsx) ────────────────────
  var PHASES = [
    { id: 'start',   label: 'Starting Nexus',              ftLabel: 'STARTING', needs: ['prefs_read','skin_apply','cache_clear','ptt_hook'], network: false },
    { id: 'update',  label: 'Checking for updates',        ftLabel: 'UPDATES',  needs: ['update_check'],   network: true  },
    { id: 'network', label: 'Connecting to the network',   ftLabel: 'NETWORK',  needs: ['socket_connect'], network: true  },
    { id: 'radios',  label: 'Loading your radios',         ftLabel: 'RADIOS',   needs: ['renderer_load'],  network: false },
    { id: 'dash',    label: 'Opening your dashboard',      ftLabel: 'READY',    needs: ['heartbeat'],      network: true  },
  ];

  var FLOOR_MS = 3500;
  var LINE_MIN_MS = 450;
  var STILL_WORKING_MS = 20000;
  var FAIL_MS = 60000;

  // Single mutable state object — FIX 2: all timers close over this live
  // reference so the 60s FAIL_MS timer never reads a stale snapshot.
  var state = {
    startedAt: Date.now(),
    steps: {
      prefs_read: 'ok',
      skin_apply: 'ok',
      cache_clear: 'pending',
      ptt_hook: 'pending',
      update_check: 'pending',
      socket_connect: 'pending',
      renderer_load: 'pending',
      heartbeat: 'pending',
    },
    // Phases the user has seen. Each entry: { id, shownAt, completedAt }.
    visiblePhases: [{ id: PHASES[0].id, shownAt: Date.now(), completedAt: null }],
    activeIdx: 0,
    update: null, // { percent, downloading, ready }
    stillWorking: false,
    failedPhase: null,
    revealed: false,
    signalSent: false,
  };

  function isPhaseDone(phase) {
    for (var i = 0; i < phase.needs.length; i++) {
      var s = state.steps[phase.needs[i]];
      if (s !== 'ok' && s !== 'offline') return false;
    }
    return true;
  }
  function isPhaseOffline(phase) {
    for (var i = 0; i < phase.needs.length; i++) {
      if (state.steps[phase.needs[i]] === 'offline') return true;
    }
    return false;
  }

  // ─── DOM refs ─────────────────────────────────────────────────────────
  var $win = document.getElementById('win');
  var $lg  = document.getElementById('lg');
  var $bf  = document.getElementById('bf');
  var $pp  = document.getElementById('pp');
  var $ps  = document.getElementById('ps');
  var $ftl = document.getElementById('ftl');
  var $dots = document.getElementById('dots').children;

  // Render the log + progress + footer for current state.
  function render() {
    // Progress bar.
    var completed = 0;
    for (var i = 0; i < PHASES.length; i++) if (isPhaseDone(PHASES[i])) completed++;
    var basePct = Math.round((completed / PHASES.length) * 100);
    var downloading = state.update && state.update.downloading && !state.update.ready;
    var barPct = downloading
      ? Math.max(basePct, Math.min(100, Math.round(state.update.percent || 0)))
      : basePct;
    $bf.style.width = barPct + '%';
    $pp.textContent = barPct + '%';

    // Updating at launch: say which version, and warn before the app
    // closes into the installer so it doesn't look like a crash.
    var ver = state.update && state.update.version ? ('Nexus ' + state.update.version) : 'the latest version';
    var restarting = state.update && state.update.ready;
    var statusWord = restarting
      ? ('Update ready — restarting to install ' + ver + '…')
      : downloading
        ? ('Updating to ' + ver + ' — ' + Math.round(state.update.percent || 0) + '%')
        : (PHASES[state.activeIdx] ? PHASES[state.activeIdx].label : 'Starting');
    if (state.stillWorking && !state.revealed) statusWord += ' — Still working';
    $ps.textContent = statusWord;
    $ftl.textContent = (downloading || restarting)
      ? 'UPDATE'
      : (PHASES[state.activeIdx] ? PHASES[state.activeIdx].ftLabel : 'STARTING');

    // Dots.
    for (var di = 0; di < PHASES.length && di < $dots.length; di++) {
      var d = $dots[di];
      var done = isPhaseDone(PHASES[di]);
      var active = di === state.activeIdx && !done;
      d.className = done ? 'done' : (active ? 'on' : '');
    }

    // Log lines.
    var html = '';
    for (var k = 0; k < state.visiblePhases.length; k++) {
      var v = state.visiblePhases[k];
      var def = null;
      for (var p = 0; p < PHASES.length; p++) if (PHASES[p].id === v.id) { def = PHASES[p]; break; }
      var isLast = k === state.visiblePhases.length - 1;
      var done2 = def ? isPhaseDone(def) : false;
      var offline = def ? isPhaseOffline(def) : false;
      var failed = state.failedPhase === v.id;
      var cls = 'ln' + (isLast ? '' : ' old') + (failed ? ' err' : '');
      var suffix = '';
      if (done2 && !offline) suffix = '<span class="ok">ok</span>';
      else if (offline) suffix = '<span class="offline">offline</span>';
      if (failed) suffix += '<span class="err-label">failed</span>';
      html += '<div class="' + cls + '">' + escapeHtml(def ? def.label : v.id) + '...' + suffix + '</div>';
    }
    if (state.failedPhase) {
      html += '<div class="actions"><button id="retryBtn">Retry</button><button id="quitBtn">Quit</button></div>';
    }
    $lg.innerHTML = html;
    if (state.failedPhase) {
      var r = document.getElementById('retryBtn');
      var q = document.getElementById('quitBtn');
      if (r) r.onclick = function () { try { api && api.app && api.app.relaunch && api.app.relaunch(); } catch (e) {} };
      if (q) q.onclick = function () { try { api && api.app && api.app.quit && api.app.quit(); } catch (e) {} };
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  // ─── Step ingestion ───────────────────────────────────────────────────
  function markStepLocal(name, status) {
    if (!name) return;
    var cur = state.steps[name];
    if (cur === 'ok' || cur === 'offline') return;
    state.steps[name] = status || 'ok';
    tick();
  }

  if (api && api.startup && api.startup.onBroadcastStep) {
    api.startup.onBroadcastStep(function (payload) {
      if (!payload) return;
      markStepLocal(payload.name, payload.status);
    });
  }

  // Updates at launch are mandatory for returning players (no skip): the
  // splash holds until the download finishes, then installs. Only a failed
  // download (error -> update_check 'offline') lets the player in.

  // Shown before the app closes into the installer, so the hand-off
  // reads as "restarting to update" rather than a crash.
  var RESTART_NOTICE_MS = 2000;

  if (api && api.update && api.update.on) {
    api.update.on('available', function (info) {
      state.update = { version: (info && info.version) || null, percent: 0,
        downloading: true, ready: false };
      try { api.update.download && api.update.download(); } catch (e) {}
      render();
    });
    api.update.on('progress', function (p) {
      if (!state.update) state.update = { version: null };
      state.update.percent = Math.round((p && p.percent) || 0);
      state.update.downloading = true;
      state.update.ready = false;
      render();
    });
    api.update.on('ready', function (info) {
      if (!state.update) state.update = { version: null };
      if (info && info.version) state.update.version = info.version;
      state.update.percent = 100;
      state.update.downloading = false;
      state.update.ready = true;
      render();
      setTimeout(function () {
        try { api.update.installNow && api.update.installNow(); } catch (e) {}
      }, RESTART_NOTICE_MS);
    });
    api.update.on('none', function () {
      if (state.steps.update_check === 'pending') markStepLocal('update_check', 'ok');
    });
    api.update.on('error', function () {
      if (state.steps.update_check === 'pending') markStepLocal('update_check', 'offline');
    });
  }

  // ─── Phase advancement + reveal loop ──────────────────────────────────
  function advancePhasesAndMaybeReveal() {
    // Mark completedAt on the active visible phase.
    var last = state.visiblePhases[state.visiblePhases.length - 1];
    var lastDef = null;
    for (var i = 0; i < PHASES.length; i++) if (PHASES[i].id === last.id) { lastDef = PHASES[i]; break; }
    if (lastDef && !last.completedAt && isPhaseDone(lastDef)) {
      last.completedAt = Date.now();
    }

    // Advance to next phase once current is done AND has been visible
    // LINE_MIN_MS.
    if (state.activeIdx < PHASES.length - 1 && lastDef && isPhaseDone(lastDef)) {
      var elapsed = Date.now() - last.shownAt;
      if (elapsed >= LINE_MIN_MS) {
        state.activeIdx += 1;
        state.visiblePhases.push({ id: PHASES[state.activeIdx].id, shownAt: Date.now(), completedAt: null });
      }
    }

    // Reveal if everything is in shape.
    if (!state.revealed) {
      var allDone = true;
      for (var j = 0; j < PHASES.length; j++) if (!isPhaseDone(PHASES[j])) { allDone = false; break; }
      var everyLineSeen = state.visiblePhases.length >= PHASES.length;
      var floorPassed = Date.now() - state.startedAt >= FLOOR_MS;
      var lastLineSettled = state.visiblePhases.length > 0
        && (Date.now() - state.visiblePhases[state.visiblePhases.length - 1].shownAt) >= LINE_MIN_MS;
      if (allDone && everyLineSeen && floorPassed && lastLineSettled) {
        state.revealed = true;
        if (!state.signalSent) {
          state.signalSent = true;
          try { api && api.startup && api.startup.signalReady && api.startup.signalReady(); } catch (e) {}
        }
        $win.classList.add('done');
      }
    }
  }

  // Central tick — render + advance + reschedule the poll.
  var pollTimer = null;
  function tick() {
    advancePhasesAndMaybeReveal();
    render();
    if (!state.revealed && !state.failedPhase) {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = setTimeout(tick, 120);
    }
  }

  // ─── Still-working + failure timers (close over live state) ───────────
  setTimeout(function () {
    state.stillWorking = true;
    render();
  }, STILL_WORKING_MS);

  setTimeout(function () {
    // Pick the first phase that's not yet ok/offline — read LIVE state.
    var stuck = null;
    for (var i = 0; i < PHASES.length; i++) {
      if (!isPhaseDone(PHASES[i])) { stuck = PHASES[i]; break; }
    }
    if (!stuck) return;
    // A mandatory update that is still downloading isn't stuck: keep the
    // splash up. main.js reveals the dashboard if the download stalls
    // (no progress for a while) or errors (-> update_check 'offline').
    if (stuck.id === 'update' && state.update && state.update.downloading && !state.update.ready) return;
    if (stuck.network) {
      // Degrade pending network needs to 'offline' so we keep moving.
      for (var k = 0; k < stuck.needs.length; k++) {
        if (state.steps[stuck.needs[k]] === 'pending') {
          state.steps[stuck.needs[k]] = 'offline';
        }
      }
      tick();
    } else {
      state.failedPhase = stuck.id;
      render();
    }
  }, FAIL_MS);

  // Kick the first render + schedule the poll loop.
  render();
  tick();
})();
