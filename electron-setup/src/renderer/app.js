// Nexus Setup renderer. Port of the mockup's state machine, with all
// the simulated steps replaced by real IPC. Screens: welcome, progress,
// done, failed, canceled. Skin tokens are injected on <html> at startup
// before anything else paints.

(function () {
  'use strict';

  const api = window.setupAPI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  // ─── State ───────────────────────────────────────────────────────
  let ctx          = null;    // { existing, defaultDir, manifest, version, productName }
  let scenario     = 'fresh'; // 'fresh' | 'update' | 'repair' | 'remove'
  let screen       = 'welcome';
  let optOpen      = false;
  let desktopShortcut = true;
  let startLogin    = false;
  let installDir    = '';
  let keepSettings  = true;
  let pct           = 0;
  const LOG         = [];
  let clk           = 0;
  let unsubStep     = null;
  let runToken      = 0;
  let launchAfter   = true;

  // ─── Skin ────────────────────────────────────────────────────────
  async function applySkin() {
    try {
      const s = await api.getSkin();
      const root = document.documentElement.style;
      ['acc','acc2','bg0','bg1','bg2','bg3','rim0','rim1'].forEach(k => {
        if (s && s[k]) root.setProperty('--' + k, s[k]);
      });
    } catch {}
  }

  // ─── Logo SVG (draw-on vs. still) ────────────────────────────────
  function logoSVG(cls) {
    cls = cls || '';
    return '<svg viewBox="0 0 64 64" class="lg ' + cls + '" aria-hidden="true">'
      + '<path class="ink" pathLength="1" style="--dl:0ms"   d="M20 10H9V54H20"/>'
      + '<path class="ink" pathLength="1" style="--dl:140ms" d="M44 10H55V54H44"/>'
      + '<path class="hot" pathLength="1" style="--dl:340ms" d="M24 22L36 32L24 42"/>'
      + '<rect class="cur" x="38" y="40" width="10" height="5"/></svg>';
  }

  function timestamp() {
    clk += 1;
    const s = 41000 + clk * 3;
    const hh = ('0' + (Math.floor(s / 3600) % 24)).slice(-2);
    const mm = ('0' + (Math.floor(s / 60)   % 60)).slice(-2);
    const ss = ('0' + (s % 60)).slice(-2);
    return hh + ':' + mm + ':' + ss;
  }

  function setDots(n) {
    const w = []; for (let i = 0; i < 3; i++) w.push('<i class="' + (i < n ? 'done' : i === n ? 'on' : '') + '"></i>');
    $('dots').innerHTML = w.join('');
  }

  function checkIcon(k) {
    const m = {
      ok:  '<circle cx="32" cy="32" r="28" pathLength="1"/><path pathLength="1" d="M20 33l9 9 16-19"/>',
      bad: '<circle cx="32" cy="32" r="28" pathLength="1"/><path pathLength="1" d="M32 18v18M32 44v1"/>',
      neu: '<circle cx="32" cy="32" r="28" pathLength="1"/><path pathLength="1" d="M22 32h20"/>',
    };
    return '<div class="ic ' + k + '"><svg viewBox="0 0 64 64">' + m[k] + '</svg></div>';
  }

  // ─── Log stream ──────────────────────────────────────────────────
  function addLog(text, cls, quiet) {
    const L = $('log'); if (!L) return null;
    const old = L.querySelector('.cur'); if (old) old.classList.remove('cur');
    const d = document.createElement('div');
    const fin = cls === 'err' || cls === 'okl';
    d.className = 'ln ' + (cls || '') + (fin ? '' : ' cur');
    d.innerHTML = '<time>' + timestamp() + '</time>' + text;
    L.appendChild(d);
    while (L.children.length > 8) L.removeChild(L.firstChild);
    if (!quiet) LOG.push([text, cls || '']);
    return d;
  }
  function okMark() {
    const L = $('log'); if (!L) return;
    const l = L.querySelector('.cur') || L.lastChild;
    if (l && !l.querySelector('.okm')) l.insertAdjacentHTML('beforeend', '<span class="okm">ok</span>');
  }
  function setPct(p) {
    pct = Math.max(0, Math.min(100, p));
    const f = $('pf'); if (f) f.style.width = pct + '%';
    const c = $('pc'); if (c) c.textContent = Math.round(pct) + '%';
  }
  function setStatusLabel(text) {
    const pst = $('pst'); if (pst) pst.textContent = text.charAt(0).toUpperCase() + text.slice(1);
  }

  // ─── Screens ─────────────────────────────────────────────────────
  function render(name) {
    screen = name;
    const body = $('body');
    let html = '';
    const verbLabel = scenario === 'update' ? 'Update'
                    : scenario === 'remove' ? 'Uninstall'
                    : scenario === 'repair' ? 'Repair'
                    : 'Install';

    if (name === 'welcome') {
      setDots(0);
      $('ftl').textContent = scenario === 'update' || scenario === 'repair'
        ? 'EXISTING INSTALL FOUND'
        : scenario === 'remove' ? 'UNINSTALL' : 'WELCOME';

      if (scenario === 'remove') {
        html = '<div class="scr wl">'
          + '<div class="logo">' + logoSVG('still') + '</div>'
          + '<div class="wr" style="--i:1">'
          + '<div class="ttl" style="font-size:28px;letter-spacing:.08em;display:block">Remove Nexus?</div>'
          + '<div class="sub">UNINSTALL</div>'
          + '<div class="ver">This removes the app from <b>' + esc(ctx?.existing?.path || installDir) + '</b>, plus its shortcuts.</div>'
          + '<div class="optb" style="margin-top:14px">'
          +   '<label class="cb"><input type="checkbox" id="keep" ' + (keepSettings ? 'checked' : '') + '> Keep my settings and skins</label>'
          + '</div>'
          + '<div class="acts"><button class="pb1 red" data-a="go">Uninstall</button>'
          +   '<button class="lk" data-a="cancelw">Cancel</button></div>'
          + '</div></div>';
      } else {
        const title = 'NEXUS'.split('').map((c, i) => '<span style="--k:' + i + '">' + c + '</span>').join('');
        const existingLine = (scenario === 'update' || scenario === 'repair') && ctx?.existing?.version
          ? '<div class="stat"><b style="color:var(--lime)">Nexus ' + esc(ctx.existing.version) + '</b> is installed. Version <b>' + esc(ctx.version) + '</b> is ready.</div>'
          : '';
        const actions = (scenario === 'update' || scenario === 'repair')
          ? '<button class="pb1" data-a="go">Update</button>'
          + '<button class="sec" data-a="repair">Repair</button>'
          + '<button class="lk dg" data-a="rem">Uninstall</button>'
          : '<button class="pb1" data-a="go">Install</button>'
          + '<button class="lk" data-a="opt" aria-expanded="' + optOpen + '">Options</button>';
        const opts = (scenario === 'update' || scenario === 'repair')
          ? ''
          : '<div class="opt' + (optOpen ? ' open' : '') + '" id="opt"><div>'
            + '<div class="optb">'
            +   '<div class="lab" style="margin:0">Install folder</div>'
            +   '<div class="fld"><div class="p" id="pathp">' + esc(installDir) + '</div>'
            +     '<button data-a="browse">Browse</button></div>'
            +   '<label class="cb"><input type="checkbox" id="ds" ' + (desktopShortcut ? 'checked' : '') + '> Create a desktop shortcut</label>'
            +   '<label class="cb"><input type="checkbox" id="sl" ' + (startLogin ? 'checked' : '') + '> Start Nexus when I sign in</label>'
            + '</div></div></div>';
        html = '<div class="scr wl">'
          + '<div class="logo">' + logoSVG() + '</div>'
          + '<div class="wr">'
          +   '<div class="ttl" aria-label="NEXUS">' + title + '</div>'
          +   '<div class="sub" style="--i:3">' + (scenario === 'repair' ? 'REPAIR' : 'SHIP MANAGEMENT') + '</div>'
          +   '<div class="ver" style="--i:4">Version <b>' + esc(ctx?.version || '0.0.0') + '</b> · ' + fmtBytes(ctx?.manifest?.size) + ((scenario === 'update' || scenario === 'repair') ? '' : ' · your settings stay put') + '</div>'
          +   existingLine
          +   '<div class="acts" style="--i:5">' + actions + '</div>'
          +   opts
          + '</div></div>';
      }
    }

    if (name === 'progress') {
      setDots(1);
      $('ftl').textContent = 'STEP 2 OF 3';
      const title = scenario === 'update' ? 'Updating Nexus'
                  : scenario === 'remove' ? 'Removing Nexus'
                  : scenario === 'repair' ? 'Repairing Nexus'
                  : 'Installing Nexus';
      html = '<div class="scr pg">'
        + '<div class="ph">' + logoSVG('still') + '<div><h2 id="ptt">' + title + '</h2>'
        + '<p id="psub">Please keep this window open.</p></div></div>'
        + '<div class="bar" id="bar"><i id="pf"></i></div>'
        + '<div class="pr"><span id="pst">Starting</span><b id="pc">0%</b></div>'
        + '<div class="log" id="log"></div>'
        + '<div class="pa"><button class="lk" data-a="cancel" id="cx">Cancel</button></div>'
        + '</div>';
    }

    if (name === 'done' || name === 'canceled' || name === 'failed') {
      setDots(name === 'done' ? 3 : 2);
      let ic, ttl, det, extra = '', bt = '';
      if (name === 'done') {
        ic  = checkIcon('ok');
        ttl = scenario === 'update' ? 'Nexus is up to date'
            : scenario === 'remove' ? 'Nexus was removed'
            : scenario === 'repair' ? 'Nexus is repaired'
            : 'Nexus is ready';
        det = scenario === 'update' ? ('Updated to ' + esc(ctx?.version || '') + '. Your settings were kept.')
            : scenario === 'remove' ? 'Your settings were kept in %APPDATA%\\Nexus Companion UDP.'
            : scenario === 'repair' ? 'All files restored. Your settings were kept.'
            : 'Installed for your account. Shortcuts are on your Start menu and desktop.';
        if (scenario !== 'remove') {
          extra = '<label class="cb" style="margin-top:12px"><input type="checkbox" id="la" '
            + (launchAfter ? 'checked' : '') + '> Launch Nexus</label>';
        }
        bt = '<button class="pb1" data-a="finish">' + (scenario === 'remove' ? 'Close' : 'Finish') + '</button>';
        $('ftl').textContent = 'DONE';
      } else if (name === 'canceled') {
        ic  = checkIcon('neu');
        ttl = 'Setup canceled';
        det = 'Nothing was changed on your computer.';
        bt  = '<button class="pb1" data-a="again">Start over</button><button class="lk" data-a="close">Close</button>';
        $('ftl').textContent = 'CANCELED';
      } else {
        ic  = checkIcon('bad');
        ttl = 'Setup could not finish';
        det = 'Something went wrong. Your previous version was restored.';
        const tail = LOG.slice(-5).map(l => '<div' + (l[1] === 'err' ? ' class="e"' : '') + '>' + l[0] + '</div>').join('');
        extra = '<div class="mini">' + tail + '</div>';
        bt = '<button class="pb1" data-a="again">Retry</button>'
          + '<button class="sec" data-a="copy" id="cp">Copy log</button>'
          + '<button class="lk" data-a="close">Close</button>';
        $('ftl').textContent = 'FAILED';
      }
      html = '<div class="scr rs">' + ic + '<div style="min-width:0;flex:1">'
        + '<h2>' + ttl + '</h2>'
        + '<p class="d">' + det + '</p>'
        + (name === 'done' && scenario !== 'remove' ? '<div class="mono">' + esc(installDir) + '</div>' : '')
        + extra
        + '<div class="acts" style="margin-top:16px">' + bt + '</div>'
        + '</div></div>';
    }

    body.innerHTML = html;
    if (name === 'progress') LOG.forEach(l => addLog(l[0], l[1], true));
  }

  function fmtBytes(n) {
    if (!n || typeof n !== 'number') return 'size unknown';
    const mb = n / (1024 * 1024);
    return mb >= 100 ? Math.round(mb) + ' MB' : mb.toFixed(1) + ' MB';
  }

  // ─── Rollback animation when IPC reports an error / cancel ──────
  async function rollbackVisual(after) {
    const bar = $('bar'), cx = $('cx');
    if (cx) cx.style.visibility = 'hidden';
    if (bar) bar.classList.add('rb');
    setStatusLabel('Rolling back');
    const ptt = $('ptt'), psub = $('psub');
    if (ptt) ptt.textContent = 'Rolling back';
    if (psub) psub.textContent = 'Putting everything back as it was.';
    const from = pct;
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      await sleep(90);
      setPct(from * (1 - i / steps));
    }
    addLog('rollback complete', 'okl');
    await sleep(500);
    render(after);
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ─── Scenario orchestration ─────────────────────────────────────
  async function startInstall(mode) {
    runToken++;
    const token = runToken;
    LOG.length = 0;
    pct = 0;
    scenario = mode;
    render('progress');

    // Subscribe to streamed steps from main.
    if (unsubStep) { try { unsubStep(); } catch {} unsubStep = null; }
    let completedSteps = 0;
    // Rough synthetic percentage: we don't know how many steps the
    // core will fire until it starts, so we lean on file-extract
    // progress plus a base increment per discrete step.
    unsubStep = api.onStep((s) => {
      if (token !== runToken) return;
      if (s.status === 'start') {
        if (s.name.startsWith('+ ')) {
          addLog(s.name, 'dim');
          if (s.fileProgress) {
            const base = 25; // extraction occupies roughly 25 → 78 of the bar
            const span = 53;
            const pctLocal = base + span * (s.fileProgress.index + 1) / Math.max(1, s.fileProgress.total);
            setPct(pctLocal);
          }
        } else {
          addLog('&gt; ' + s.name);
          setStatusLabel(s.name);
        }
      } else if (s.status === 'ok') {
        okMark();
        completedSteps++;
        // Nudge pct forward; extraction's internal file callback
        // handles the main climb, so other steps are small pushes.
        setPct(Math.min(97, pct + 3));
      } else if (s.status === 'warn') {
        addLog(s.name, 'dim');
      } else if (s.status === 'err') {
        addLog('! ' + s.name, 'err');
      }
    });

    try {
      const opts = {
        installDir:    installDir,
        createDesktop: desktopShortcut,
        startWithLogin: startLogin,
      };
      let res;
      if (mode === 'remove') {
        res = await api.uninstall({ keepSettings });
      } else if (mode === 'repair') {
        res = await api.repair(opts);
      } else {
        res = await api.install(opts);
      }
      if (token !== runToken) return;
      if (res && res.ok) {
        setPct(100);
        await sleep(400);
        render('done');
      } else if (res && res.canceled) {
        await rollbackVisual('canceled');
      } else {
        await rollbackVisual('failed');
      }
    } finally {
      if (unsubStep) { try { unsubStep(); } catch {} unsubStep = null; }
    }
  }

  // ─── Event delegation ───────────────────────────────────────────
  document.addEventListener('click', (e) => {
    const t = e.target;
    let el;
    if ((el = t.closest('[data-w]'))) {
      if (el.dataset.w === 'min')   api.minimize();
      if (el.dataset.w === 'close') api.close();
      return;
    }
    if ((el = t.closest('[data-a]'))) {
      const a = el.dataset.a;
      if (a === 'go') {
        // Pick up any form values before committing.
        const dsEl = document.getElementById('ds'); if (dsEl) desktopShortcut = dsEl.checked;
        const slEl = document.getElementById('sl'); if (slEl) startLogin      = slEl.checked;
        const kpEl = document.getElementById('keep'); if (kpEl) keepSettings   = kpEl.checked;
        const mode = scenario === 'repair' ? 'repair'
                   : scenario === 'remove' ? 'remove'
                   : (scenario === 'update' ? 'update' : 'fresh');
        startInstall(mode);
        return;
      }
      if (a === 'opt') {
        optOpen = !optOpen;
        const panel = document.getElementById('opt');
        if (panel) panel.classList.toggle('open', optOpen);
        el.setAttribute('aria-expanded', String(optOpen));
        return;
      }
      if (a === 'browse') {
        api.pickFolder(installDir).then(picked => {
          if (picked) { installDir = picked; const p = document.getElementById('pathp'); if (p) p.textContent = picked; }
        });
        return;
      }
      if (a === 'repair') { scenario = 'repair'; render('welcome'); return; }
      if (a === 'rem')    { scenario = 'remove'; render('welcome'); return; }
      if (a === 'cancelw'){ scenario = ctx?.existing ? 'update' : 'fresh'; render('welcome'); return; }
      if (a === 'cancel') { api.cancel(); return; }
      if (a === 'again')  { scenario = ctx?.existing ? 'update' : 'fresh'; render('welcome'); return; }
      if (a === 'close')  { api.close(); return; }
      if (a === 'finish') {
        const laEl = document.getElementById('la'); if (laEl) launchAfter = laEl.checked;
        if (scenario !== 'remove' && launchAfter) api.launchApp();
        api.close();
        return;
      }
      if (a === 'copy') {
        const text = LOG.map(l => l[0].replace(/&gt;/g, '>')).join('\n');
        api.copyText(text);
        el.textContent = 'Copied';
        setTimeout(() => { el.textContent = 'Copy log'; }, 1600);
        return;
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (screen === 'progress') { api.cancel(); return; }
      if (screen === 'welcome')  { api.close(); return; }
    }
  });

  // ─── Boot ───────────────────────────────────────────────────────
  (async function boot() {
    await applySkin();
    try {
      ctx = await api.getContext();
      installDir = ctx?.existing?.path || ctx?.defaultDir || '';
      scenario = ctx?.existing ? 'update' : 'fresh';
    } catch {
      scenario = 'fresh';
    }
    render('welcome');
  })();
})();
