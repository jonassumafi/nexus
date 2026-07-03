import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import api from '../services/api';

const playClick = () => {
  const file = Math.random() > 0.5 ? '/sounds/click.mp3' : '/sounds/click2.mp3';
  const snd = new Audio(file);
  snd.volume = 0.7;
  snd.play().catch(() => {});
};

const MFG_PREFIX = {
  'Aegis Dynamics':       ['aegis'],
  'Anvil Aerospace':      ['anvil'],
  'Aopoa':                ['aopoa'],
  'ARGO Astronautics':    ['argo'],
  'Banu':                 ['banu'],
  'Consolidated Outland': ['consolidated'],
  'Crusader Industries':  ['crusader'],
  'Drake Interplanetary': ['drake'],
  'Esperia':              ['esperia'],
  'Gatac Manufacture':    ['gatac'],
  "Grey's":               ['shiv'],
  'GREYCAT Industrial':   ['greycat'],
  'Kruger Intergalactic': ['kruger'],
  'Mirai':                ['mirai'],
  'MISC':                 ['misc'],
  'Origin Jumpworks':     ['origin'],
  'RSI':                  ['rsi'],
  'Tumbril Land Systems': ['tumbril'],
  'Vanduul':              ['vanduul'],
  "Xi'An":                ['aopoa', 'gatac', 'mirai'],
};
const MANUFACTURERS = ['ALL MANUFACTURERS', ...Object.keys(MFG_PREFIX).sort()];

const HEADER_BTN_STYLE = {
  width: 220,
  display: 'block',
  textAlign: 'center',
  fontSize: 15,
  padding: '7px 0',
  fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
  letterSpacing: '0.12em',
  cursor: 'pointer',
};

const LABEL_STYLE = {
  fontSize: 16,
  color: '#66AADD',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  marginBottom: 6,
  display: 'block',
};
const INPUT_STYLE = {
  width: '100%',
  background: '#000',
  border: '1px solid #4488BB',
  color: '#99CCFF',
  fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
  fontSize: 16,
  padding: '8px 10px',
  outline: 'none',
  boxSizing: 'border-box',
};

// ─── Boot sequence ──────────────────────────────────────────────────────────

// Splash-style dot animation system, mirrored from ShipRegistration.
const CM_DOT_SLOTS = 20;
const CM_TICK_MS = 80;
const CM_IDLE = 'idle';
const CM_ANIMATING = 'animating';
const CM_RESOLVED = 'resolved';
const CM_DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

function cmDots(n) {
  return '[' + '.'.repeat(n) + ' '.repeat(CM_DOT_SLOTS - n) + ']';
}
function cmRandInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

const CM_LINE_DEFS = [
  { label: 'AUTHENTICATING OPERATOR  ', status: 'OK',     color: '#66AADD', range: [600, 1800] },
  { label: 'ACCESSING MISSION DB     ', status: 'OK',     color: '#66AADD', range: [500, 1600] },
  { label: 'LOADING FLEET MANIFEST   ', status: 'OK',     color: '#66AADD', range: [400, 1400] },
  { label: 'INITIALIZING CREW SYSTEM ', status: 'OK',     color: '#66AADD', range: [500, 1500] },
  { label: 'PREPARING PARAMETERS     ', status: 'OK',     color: '#66AADD', range: [400, 1200] },
  { label: 'ESTABLISHING CONNECTION  ', status: 'READY',  color: '#33DDAA', range: [300, 1000] },
  { label: 'MISSION TERMINAL         ', status: 'ONLINE', color: '#33DDAA', range: [200, 800]  },
];

function BootSequence({ operatorName, onDone }) {
  const [duration] = useState(() => 5000 + Math.random() * 2000);
  const seqRef = useRef(null);
  const sndRef = useRef(null);

  const [header1, setHeader1]     = useState(false);
  const [header2, setHeader2]     = useState(false);
  const [showDivOpen, setDivOpen] = useState(false);
  const [showDivClose, setDivClose] = useState(false);
  const [showReady, setShowReady] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [lineStates, setLineStates] = useState(
    CM_LINE_DEFS.map(() => ({ phase: CM_IDLE, dots: 0 }))
  );

  if (!seqRef.current) {
    const HEADER_TIME = 700;
    const TAIL_TIME = 500;
    const budget = Math.max(2000, duration - HEADER_TIME - TAIL_TIME);
    let durations = CM_LINE_DEFS.map(({ range }) => cmRandInt(range[0], range[1]));
    const total = durations.reduce((s, d) => s + d, 0);
    if (total > budget) {
      const scale = budget / total;
      durations = durations.map(d => Math.max(Math.floor(d * scale), 150));
    }
    seqRef.current = { durations, headerTime: HEADER_TIME };
  }

  useEffect(() => {
    const snd = new Audio('/sounds/mission_boot.mp3');
    snd.loop = false;
    snd.volume = 0.4;
    snd.muted = true;
    snd.play().catch(() => {});
    sndRef.current = snd;
    const unmute = setTimeout(() => { try { snd.muted = false; } catch (e) {} }, 80);
    const stopSnd = setTimeout(() => {
      try { snd.pause(); snd.currentTime = 0; snd.src = ''; snd.load(); } catch (e) {}
    }, duration);

    const tids = [];
    const iids = [];
    const schedule = (fn, delay) => { tids.push(setTimeout(fn, delay)); };

    schedule(() => setHeader1(true), 0);
    schedule(() => setDivOpen(true), 150);
    schedule(() => setHeader2(true), 300);

    let cursor = seqRef.current.headerTime;
    CM_LINE_DEFS.forEach((_, index) => {
      const dur = seqRef.current.durations[index];
      schedule(() => {
        setLineStates(prev => {
          const next = [...prev];
          next[index] = { phase: CM_ANIMATING, dots: 0 };
          return next;
        });
        let dotPos = 0;
        const iid = setInterval(() => {
          dotPos = (dotPos + 1) % (CM_DOT_SLOTS + 1);
          setLineStates(prev => {
            const next = [...prev];
            if (next[index].phase === CM_ANIMATING) {
              next[index] = { phase: CM_ANIMATING, dots: dotPos };
            }
            return next;
          });
        }, CM_TICK_MS);
        iids.push(iid);
        schedule(() => {
          clearInterval(iid);
          setLineStates(prev => {
            const next = [...prev];
            next[index] = { phase: CM_RESOLVED, dots: CM_DOT_SLOTS };
            return next;
          });
        }, dur);
      }, cursor);
      cursor += dur;
    });

    schedule(() => setDivClose(true), cursor + 100);
    schedule(() => setShowReady(true),  cursor + 250);
    schedule(() => setShowPrompt(true), cursor + 400);

    const doneTimer = setTimeout(() => { onDone?.(); }, duration + 3000);

    return () => {
      clearTimeout(unmute);
      clearTimeout(stopSnd);
      clearTimeout(doneTimer);
      tids.forEach(clearTimeout);
      iids.forEach(clearInterval);
      try { snd.pause(); snd.currentTime = 0; snd.src = ''; snd.load(); } catch (e) {}
    };
  }, [duration, onDone]);

  const lineColor = (ls, idx) =>
    ls.phase === CM_RESOLVED ? CM_LINE_DEFS[idx].color : '#66AADD';

  return (
    <div style={{
      background: '#000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      width: '100%',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        width: 'fit-content',
        maxWidth: 700,
        padding: '0 40px',
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
        fontSize: 16,
        lineHeight: 1.9,
        letterSpacing: '0.06em',
      }}>
        {header1 && (
          <div style={{ color: '#99CCFF' }}>
            NEXUS MISSION COMMAND — TERMINAL ACCESS
          </div>
        )}
        {showDivOpen && (
          <div style={{ color: '#1A3D55' }}>{CM_DIVIDER}</div>
        )}
        {header2 && (
          <div style={{ color: '#66AADD', whiteSpace: 'pre', marginBottom: 12 }}>
            {`OPERATOR: ${operatorName || 'UNKNOWN'}  //  AUTH: VERIFIED`}
          </div>
        )}

        {CM_LINE_DEFS.map((def, i) => {
          const ls = lineStates[i];
          if (ls.phase === CM_IDLE) return null;
          return (
            <div key={i} style={{ color: lineColor(ls, i), whiteSpace: 'pre' }}>
              {def.label}{cmDots(ls.dots)}{ls.phase === CM_RESOLVED ? '  ' + def.status : ''}
            </div>
          );
        })}

        {showDivClose && (
          <div style={{ color: '#1A3D55', marginTop: 8 }}>{CM_DIVIDER}</div>
        )}
        {showReady && (
          <div style={{ color: '#33DDAA', whiteSpace: 'pre' }}>
            &gt; MISSION TERMINAL READY
          </div>
        )}
        {showPrompt && (
          <div style={{ color: '#00EEFF', whiteSpace: 'pre' }}>
            &gt; AWAITING MISSION DATA INPUT...
            <span style={{
              display: 'inline-block', width: 8, height: 14,
              background: '#66AADD', verticalAlign: 'middle', marginLeft: 6,
              animation: 'blink 0.8s step-end infinite',
            }} />
          </div>
        )}
      </div>
    </div>
  );
}

function generateFreq() {
  const raw = Math.floor(Math.random() * 190) + 1180;
  return (raw / 10).toFixed(1);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCountdown(target) {
  if (!target) return '';
  const ms = target.getTime() - Date.now();
  if (ms <= 0) return 'PAST';
  const days = Math.floor(ms / 86400000);
  const hrs  = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `T-MINUS ${String(days).padStart(2,'0')}D ${String(hrs).padStart(2,'0')}H ${String(mins).padStart(2,'0')}M`;
}

function deriveCrewRolesFromNodes(nodes) {
  const out = {};
  for (const n of nodes || []) {
    if (!n?.role) continue;
    if (!out[n.role]) out[n.role] = { slots: 0, filled: [] };
    out[n.role].slots += 1;
  }
  return out;
}

function HoverBtn({ onClick, color, disabled, children, style = {} }) {
  const [hover, setHover] = useState(false);
  const active = hover && !disabled;
  return (
    <button
      onClick={disabled ? undefined : () => { playClick(); onClick?.(); }}
      onMouseEnter={() => !disabled && setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        border: `1px solid ${disabled ? '#1A3D55' : color}`,
        color: disabled ? '#1A3D55' : (active ? '#000' : color),
        background: active ? color : '#000',
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
        ...HEADER_BTN_STYLE,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function BackDashBtn({ onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={() => { playClick(); onClick?.(); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...HEADER_BTN_STYLE,
        border: '1px solid #FFBB33',
        color: hover ? '#000' : '#FFBB33',
        background: hover ? '#FFBB33' : '#000',
        marginTop: 8,
      }}
    >
      [ ◀ BACK TO DASHBOARD ]
    </button>
  );
}

// ─── Stage indicator pills ──────────────────────────────────────────────────

const STAGES = [
  { id: 1, label: 'BRIEFING' },
  { id: 2, label: 'FLEET' },
  { id: 3, label: 'CREW' },
];

function StagePills({ current, completedMax, onJump }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '8px 20px 12px', borderBottom: '1px solid #0D2030' }}>
      {STAGES.map(s => {
        const completed = s.id < current && s.id <= completedMax;
        const isCurrent = s.id === current;
        const future = !completed && !isCurrent;
        const border = isCurrent ? '#00EEFF' : completed ? '#33DDAA' : '#1A3D55';
        const color = isCurrent ? '#00EEFF' : completed ? '#33DDAA' : '#1A3D55';
        const bg = isCurrent ? 'rgba(0,238,255,0.08)' : '#000';
        const clickable = completed && !future && s.id !== current;
        return (
          <div
            key={s.id}
            onClick={clickable ? () => { playClick(); onJump?.(s.id); } : undefined}
            style={{
              border: `1px solid ${border}`,
              color,
              background: bg,
              fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
              fontSize: 13,
              letterSpacing: '0.14em',
              padding: '4px 12px',
              cursor: clickable ? 'pointer' : 'default',
            }}
          >
            {`[ 0${s.id} ${s.label} ]`}
          </div>
        );
      })}
    </div>
  );
}

// ─── Stage 1: BRIEFING ──────────────────────────────────────────────────────

function Stage1({ form, setForm, missionTypes, nameStatus, setNameStatus, runNameCheck }) {
  const dt = useMemo(() => {
    if (!form.mission_date || !form.mission_time) return null;
    return new Date(`${form.mission_date}T${form.mission_time}`);
  }, [form.mission_date, form.mission_time]);

  const [countdown, setCountdown] = useState(() => dt ? formatCountdown(dt) : '');
  useEffect(() => {
    if (!dt) return;
    setCountdown(formatCountdown(dt));
    const id = setInterval(() => setCountdown(formatCountdown(dt)), 30000);
    return () => clearInterval(id);
  }, [dt]);

  // Compute date input bounds: today → +60 days
  const minDate = new Date().toISOString().slice(0, 10);
  const maxDt = new Date();
  maxDt.setDate(maxDt.getDate() + 60);
  const maxDate = maxDt.toISOString().slice(0, 10);

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={LABEL_STYLE}>MISSION NAME</label>
        <input
          value={form.name}
          maxLength={80}
          onChange={e => {
            setForm(f => ({ ...f, name: e.target.value }));
            setNameStatus('idle');
          }}
          onBlur={() => {
            const upper = form.name.toUpperCase();
            setForm(f => ({ ...f, name: upper }));
            if (upper.trim()) runNameCheck(upper.trim());
          }}
          placeholder="e.g. OPERATION IRON VEIL"
          style={INPUT_STYLE}
        />
        {nameStatus === 'checking' && (
          <div style={{ fontSize: 16, color: '#66AADD', marginTop: 4 }}>CHECKING...</div>
        )}
        {nameStatus === 'available' && (
          <div style={{ fontSize: 16, color: '#33DDAA', marginTop: 4 }}>✓ AVAILABLE</div>
        )}
        {nameStatus === 'taken' && (
          <div style={{ fontSize: 16, color: '#FF5544', marginTop: 4 }}>✗ NAME TAKEN</div>
        )}
      </div>

      <div>
        <label style={LABEL_STYLE}>MISSION TYPE</label>
        <select
          value={form.mission_type}
          onChange={e => setForm(f => ({ ...f, mission_type: e.target.value }))}
          style={{ ...INPUT_STYLE, cursor: 'pointer' }}
        >
          <option value="">— SELECT —</option>
          {missionTypes.map(t => (
            <option key={t.name} value={t.name} style={{ background: '#000' }}>
              {t.emoji ? `${t.emoji} ${t.name}` : t.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label style={LABEL_STYLE}>SCHEDULED DATE AND TIME</label>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <input
              type="date"
              min={minDate}
              max={maxDate}
              value={form.mission_date}
              onChange={e => setForm(f => ({ ...f, mission_date: e.target.value }))}
              style={{ ...INPUT_STYLE, flex: 1 }}
            />
            <ConvenienceBtn onClick={() => {
              const t = new Date();
              const yyyy = t.getFullYear();
              const mm = String(t.getMonth() + 1).padStart(2, '0');
              const dd = String(t.getDate()).padStart(2, '0');
              setForm(f => ({ ...f, mission_date: `${yyyy}-${mm}-${dd}` }));
            }}>
              [ TODAY ]
            </ConvenienceBtn>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <input
              type="time"
              value={form.mission_time}
              onChange={e => setForm(f => ({ ...f, mission_time: e.target.value }))}
              style={{ ...INPUT_STYLE, flex: 1 }}
            />
            <ConvenienceBtn onClick={() => {
              const t = new Date();
              const hh = String(t.getHours()).padStart(2, '0');
              const min = String(t.getMinutes()).padStart(2, '0');
              setForm(f => ({ ...f, mission_time: `${hh}:${min}` }));
            }}>
              [ NOW ]
            </ConvenienceBtn>
          </div>
        </div>
        {countdown && (
          <div style={{ fontSize: 16, color: '#66AADD', marginTop: 4 }}>{countdown}</div>
        )}
        {form.mission_date && form.mission_time && dt && dt.getTime() <= Date.now() && (
          <div style={{
            fontSize: 12,
            color: '#FF5544',
            letterSpacing: '0.06em',
            marginTop: 6,
            fontWeight: 'bold',
          }}>
            ⚠ SELECTED TIME HAS ALREADY PASSED — CHOOSE A FUTURE TIME
          </div>
        )}
      </div>

      <div>
        <label style={LABEL_STYLE}>OBJECTIVES</label>
        <textarea
          rows={6}
          maxLength={2000}
          value={form.objectives}
          onChange={e => setForm(f => ({ ...f, objectives: e.target.value }))}
          placeholder="Describe mission objectives, target location, expected resistance, and rules of engagement."
          style={{ ...INPUT_STYLE, resize: 'vertical' }}
        />
        <div style={{ textAlign: 'right', color: '#66AADD', fontSize: 16, marginTop: 2 }}>
          {form.objectives.length} / 2000
        </div>
      </div>

      <div>
        <label style={LABEL_STYLE}>VISIBILITY</label>
        <div style={{ display: 'flex', gap: 10 }}>
          <VisibilityBtn
            label="ORG"
            disabled
            tooltip="JOIN AN ORG TO ENABLE"
          />
          <VisibilityBtn
            label="PUBLIC"
            active={form.is_public}
            onClick={() => setForm(f => ({ ...f, is_public: true }))}
          />
        </div>
      </div>

      <div>
        <label style={LABEL_STYLE}>MISSION FREQUENCY</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            value={form.frequency}
            onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
            placeholder="127.4"
            style={{
              width: 110,
              background: '#000',
              border: '1px solid #4488BB',
              color: '#00EEFF',
              fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
              fontSize: 22,
              padding: '8px 10px',
              textAlign: 'center',
              letterSpacing: '0.14em',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <span style={{ fontSize: 16, color: '#66AADD', marginLeft: 6 }}>MHz</span>
          <ConvenienceBtn onClick={() => setForm(f => ({ ...f, frequency: generateFreq() }))}>
            [ GENERATE ]
          </ConvenienceBtn>
        </div>
      </div>

      <div>
        <label style={LABEL_STYLE}>CREW QUEUE WINDOW</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => { playClick(); setForm(f => ({ ...f, queue_on: !f.queue_on })); }}
            style={{
              border: `1px solid ${form.queue_on ? '#33DDAA' : '#1A3D55'}`,
              color: form.queue_on ? '#33DDAA' : '#66AADD',
              background: form.queue_on ? 'rgba(51,221,170,0.08)' : '#000',
              fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
              fontSize: 18,
              letterSpacing: '0.12em',
              padding: '6px 14px',
              cursor: 'pointer',
            }}
          >
            {form.queue_on ? '[ ON ]' : '[ OFF ]'}
          </button>
          {form.queue_on && (
            <>
              <input
                type="number"
                min={5}
                max={120}
                value={form.queue_minutes}
                onChange={e => setForm(f => ({ ...f, queue_minutes: e.target.value }))}
                style={{ ...INPUT_STYLE, width: 90, fontSize: 16 }}
              />
              <span style={{ fontSize: 16, color: '#66AADD', letterSpacing: '0.12em' }}>MIN</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConvenienceBtn({ onClick, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={() => { playClick(); onClick?.(); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: '#000',
        border: `1px solid ${hover ? '#66AADD' : '#2A6A9A'}`,
        color: hover ? '#99CCFF' : '#66AADD',
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
        fontSize: 11,
        padding: '3px 8px',
        letterSpacing: '0.1em',
        cursor: 'pointer',
        marginLeft: 8,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

function VisibilityBtn({ label, active, disabled, tooltip, onClick }) {
  const [hover, setHover] = useState(false);
  const border = disabled ? '#1A3D55' : (active ? '#33DDAA' : '#4488BB');
  const color = disabled ? '#1A3D55' : (active ? '#33DDAA' : '#99CCFF');
  const bg = active ? 'rgba(51,221,170,0.08)' : '#000';
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={disabled ? undefined : () => { playClick(); onClick?.(); }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          border: `1px solid ${border}`,
          color,
          background: bg,
          fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
          fontSize: 18,
          letterSpacing: '0.14em',
          padding: '7px 18px',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        [ {label} ]
      </button>
      {disabled && tooltip && hover && (
        <div style={{
          position: 'absolute', top: '-32px', left: 0,
          background: '#0D2030', border: '1px solid #1A3D55',
          color: '#99CCFF', fontSize: 16, padding: '3px 8px',
          whiteSpace: 'nowrap', letterSpacing: '0.08em',
          fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
        }}>
          {tooltip}
        </div>
      )}
    </div>
  );
}

// ─── Stage 2: FLEET ─────────────────────────────────────────────────────────

function Stage2({ form, setForm, myShips, allShips, shipImages, specs, me, borrowedShipIds, myRequests, onRequestSent }) {
  const [search, setSearch] = useState('');
  const [mfg, setMfg] = useState('ALL MANUFACTURERS');
  const ownedShipIds = useMemo(
    () => new Set((myShips || []).map(s => s._id?.toString())),
    [myShips]
  );

  const manifest = form.fleet || [];
  const primaryId = manifest.find(m => m.role === 'PRIMARY')?.ship_id || null;
  const inManifest = (id) => manifest.some(m => m.ship_id === id);

  function addShip(ship, role) {
    setForm(f => {
      const next = [...(f.fleet || [])];
      next.push({ ship_id: ship._id, ship_name: ship.ship_name, role, ship });
      return { ...f, fleet: next };
    });
  }
  function removeShip(id) {
    setForm(f => ({ ...f, fleet: (f.fleet || []).filter(m => m.ship_id !== id) }));
  }
  function makePrimary(id) {
    setForm(f => {
      const next = (f.fleet || []).map(m => {
        if (m.role === 'PRIMARY') return { ...m, role: 'SUPPORT' };
        if (m.ship_id === id) return { ...m, role: 'PRIMARY' };
        return m;
      });
      return { ...f, fleet: next };
    });
  }

  const filteredInventory = useMemo(() => {
    const q = search.trim().toLowerCase();
    const prefixes = mfg === 'ALL MANUFACTURERS' ? null : MFG_PREFIX[mfg];
    return (allShips || []).filter(s => {
      // Owned ships are already surfaced in the MY SHIPS section above —
      // exclude them here so the inventory only lists non-owned vessels.
      if (ownedShipIds.has(s._id?.toString())) return false;
      if (q && !(s.ship_name || '').toLowerCase().includes(q)) return false;
      if (prefixes) {
        const m = s.ship_model || '';
        if (!prefixes.some(p => m === p || m.startsWith(p + '_'))) return false;
      }
      return true;
    }).slice(0, 30);
  }, [allShips, search, mfg, ownedShipIds]);

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Section title="MY SHIPS">
        {(!myShips || myShips.length === 0) ? (
          <div style={{ fontSize: 16, color: '#1A3D55' }}>
            NO VESSELS REGISTERED — REGISTER A SHIP FIRST
          </div>
        ) : (
          myShips.map(ship => (
            <ShipCardRow
              key={ship._id}
              ship={ship}
              shipImages={shipImages}
              specs={specs}
              inManifest={inManifest(ship._id)}
              hasPrimary={!!primaryId}
              onAddPrimary={() => addShip(ship, 'PRIMARY')}
              onAddSupport={() => addShip(ship, 'SUPPORT')}
            />
          ))
        )}
      </Section>

      <Section title="NEXUS FLEET INVENTORY">
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="> SEARCH BY SHIP NAME..."
            style={{ ...INPUT_STYLE, flex: 1 }}
          />
          <select
            value={mfg}
            onChange={e => setMfg(e.target.value)}
            style={{ ...INPUT_STYLE, width: 220, cursor: 'pointer' }}
          >
            {MANUFACTURERS.map(m => <option key={m} value={m} style={{ background: '#000' }}>{m}</option>)}
          </select>
        </div>
        {filteredInventory.length === 0 ? (
          <div style={{ fontSize: 16, color: '#1A3D55' }}>NO MATCHING SHIPS</div>
        ) : (
          filteredInventory.map(ship => (
            <ShipCardRow
              key={ship._id}
              ship={ship}
              shipImages={shipImages}
              specs={specs}
              showOwner
              inManifest={inManifest(ship._id)}
              hasPrimary={!!primaryId}
              onAddPrimary={() => addShip(ship, 'PRIMARY')}
              onAddSupport={() => addShip(ship, 'SUPPORT')}
              hasActiveLoan={borrowedShipIds?.has(ship._id?.toString())}
              pendingRequest={myRequests?.[ship._id?.toString()]}
              onRequestSent={onRequestSent}
            />
          ))
        )}
      </Section>

      <FleetManifestStrip
        manifest={manifest}
        onRemove={removeShip}
        onMakePrimary={makePrimary}
      />
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div style={{
        fontSize: 16, color: '#66AADD', letterSpacing: '0.14em',
        textTransform: 'uppercase', marginBottom: 8,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function ShipCardRow({
  ship, shipImages, specs, showOwner, inManifest, hasPrimary, onAddPrimary, onAddSupport,
  hasActiveLoan, pendingRequest, onRequestSent,
}) {
  const spec = specs?.[ship.ship_model] || {};
  const displayName = spec.display_name || ship.ship_model || '';
  const img = shipImages?.[ship.ship_model] || null;
  const owner = ship.owner_id?.citizen_name || ship.owner_id?.username || 'UNKNOWN';
  const [reqLoading, setReqLoading] = useState(false);
  const [localPending, setLocalPending] = useState(false);
  const showPending = localPending || pendingRequest?.status === 'pending';

  const roleCounts = useMemo(() => {
    const counts = {};
    for (const n of ship.node_positions || []) {
      counts[n.role] = (counts[n.role] || 0) + 1;
    }
    return counts;
  }, [ship.node_positions]);
  const crewLabel = Object.keys(roleCounts).length
    ? Object.entries(roleCounts).map(([r, n]) => `${r} ×${n}`).join(' · ')
    : 'NO CREW CONFIGURED';

  return (
    <div style={{
      background: '#0D2030',
      border: '1px solid #1A3D55',
      padding: '10px 14px',
      marginBottom: 6,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
    }}>
      {img && (
        <div style={{
          width: 76, height: 76, padding: 8, background: '#040D15',
          boxSizing: 'border-box', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <img
            src={img}
            alt=""
            style={{
              width: '100%', height: '100%', objectFit: 'contain',
              filter: 'invert(1) sepia(1) saturate(4) hue-rotate(170deg) brightness(0.5) contrast(1.3)',
            }}
          />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, color: '#99CCFF', letterSpacing: '0.08em' }}>{ship.ship_name}</div>
        <div style={{ fontSize: 16, color: '#66AADD' }}>{displayName}</div>
        <div style={{ fontSize: 16, color: '#66AADD', marginTop: 2 }}>{crewLabel}</div>
        {showOwner && (
          <div style={{ fontSize: 16, color: '#66AADD', marginTop: 2 }}>OWNER: {owner}</div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>
        {(ship.is_mission || ship.current_mission_id) ? (
          <div style={{
            fontSize: 12,
            color: '#FFBB33',
            border: '1px solid #FFBB33',
            padding: '4px 12px',
            letterSpacing: '0.1em',
            fontWeight: 'bold',
            fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
          }}>
            ON MISSION
          </div>
        ) : inManifest ? (
          <div style={{
            border: '1px solid #33DDAA', color: '#33DDAA',
            padding: '6px 12px', fontSize: 13, letterSpacing: '0.12em',
            fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
          }}>
            [ ADDED ✓ ]
          </div>
        ) : showOwner && !hasActiveLoan ? (
          showPending ? (
            <div style={{
              border: '1px solid #FFBB33', color: '#FFBB33',
              padding: '6px 12px', fontSize: 13, letterSpacing: '0.12em',
              fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
              whiteSpace: 'nowrap',
            }}>
              ⏳ REQUEST PENDING
            </div>
          ) : (
            <button
              onClick={async () => {
                if (reqLoading) return;
                setReqLoading(true);
                playClick();
                try {
                  const { data } = await api.post(`/ships/${ship._id}/request-access`);
                  setLocalPending(true);
                  onRequestSent?.(ship._id?.toString(), data?.request?._id);
                } catch (err) {
                  // Server will 400 if a duplicate active request exists — treat as pending too.
                  if (err?.response?.status === 400) setLocalPending(true);
                } finally {
                  setReqLoading(false);
                }
              }}
              style={{
                border: '1px solid #1A3D55',
                color: '#99CCFF',
                background: '#000',
                fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
                fontSize: 13,
                letterSpacing: '0.12em',
                padding: '6px 12px',
                cursor: reqLoading ? 'wait' : 'pointer',
                whiteSpace: 'nowrap',
                opacity: reqLoading ? 0.6 : 1,
              }}
            >
              {reqLoading ? 'SENDING...' : 'REQUEST ACCESS →'}
            </button>
          )
        ) : !hasPrimary ? (
          <SmallBtn color="#66AADD" onClick={onAddPrimary}>+ ADD AS PRIMARY</SmallBtn>
        ) : (
          <SmallBtn color="#66AADD" onClick={onAddSupport}>+ ADD AS SUPPORT</SmallBtn>
        )}
      </div>
    </div>
  );
}

function SmallBtn({ color, onClick, children, disabled }) {
  const [hover, setHover] = useState(false);
  const active = hover && !disabled;
  return (
    <button
      onClick={disabled ? undefined : () => { playClick(); onClick?.(); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        border: `1px solid ${disabled ? '#1A3D55' : color}`,
        color: disabled ? '#1A3D55' : (active ? '#000' : color),
        background: active ? color : '#000',
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
        fontSize: 18,
        letterSpacing: '0.12em',
        padding: '6px 12px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

function FleetManifestStrip({ manifest, onRemove, onMakePrimary }) {
  return (
    <div>
      <div style={{
        fontSize: 16, color: '#66AADD', letterSpacing: '0.14em',
        textTransform: 'uppercase', marginBottom: 8,
      }}>
        FLEET MANIFEST · {manifest.length} / 5 SHIPS
      </div>
      {manifest.length === 0 ? (
        <div style={{ fontSize: 16, color: '#1A3D55' }}>NO SHIPS ASSIGNED</div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {manifest.map(m => (
            <div key={m.ship_id} style={{
              background: '#0D2030', border: '1px solid #1A3D55',
              padding: '8px 12px', display: 'inline-flex', gap: 8, alignItems: 'center',
            }}>
              <span style={{
                color: m.role === 'PRIMARY' ? '#FFBB33' : '#66AADD',
                fontSize: 13, letterSpacing: '0.12em',
                fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
              }}>
                [{m.role === 'PRIMARY' ? '★ PRIMARY' : 'SUPPORT'}]
              </span>
              <span style={{
                color: '#99CCFF', fontSize: 16,
                fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
              }}>
                {m.ship_name}
              </span>
              {m.role === 'SUPPORT' && (
                <SmallBtn color="#FFBB33" onClick={() => onMakePrimary(m.ship_id)}>MAKE PRIMARY</SmallBtn>
              )}
              <SmallBtn color="#FF5544" onClick={() => onRemove(m.ship_id)}>REMOVE</SmallBtn>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Stage 3: CREW ──────────────────────────────────────────────────────────

function Stage3({ form, setForm, me, shipImages }) {
  const fleet = form.fleet || [];
  if (fleet.length === 0) {
    return <div style={{ padding: 20, fontSize: 16, color: '#1A3D55' }}>NO SHIPS IN FLEET MANIFEST</div>;
  }
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {fleet.map(m => (
        <CrewShipCard
          key={m.ship_id}
          manifestEntry={m}
          form={form}
          setForm={setForm}
          me={me}
          shipImages={shipImages}
        />
      ))}
    </div>
  );
}

function CrewShipCard({ manifestEntry, form, setForm, me, shipImages }) {
  const [collapsed, setCollapsed] = useState(false);
  const ship = manifestEntry.ship;
  const img = shipImages?.[ship.ship_model] || null;
  const roleCounts = useMemo(() => {
    const counts = {};
    for (const n of ship.node_positions || []) {
      counts[n.role] = (counts[n.role] || 0) + 1;
    }
    return counts;
  }, [ship.node_positions]);

  const customRoles = form.custom_roles?.[ship._id] || {};

  function addCustomRole(role, slots) {
    setForm(f => {
      const next = { ...(f.custom_roles || {}) };
      const shipRoles = { ...(next[ship._id] || {}) };
      shipRoles[role] = { slots };
      next[ship._id] = shipRoles;
      return { ...f, custom_roles: next };
    });
  }
  function removeCustomRole(role) {
    setForm(f => {
      const next = { ...(f.custom_roles || {}) };
      if (next[ship._id]) {
        const shipRoles = { ...next[ship._id] };
        delete shipRoles[role];
        next[ship._id] = shipRoles;
      }
      return { ...f, custom_roles: next };
    });
  }

  const selfReserveOn = !!(form.self_reserve && form.self_reserve[ship._id]);
  const hasPilot = roleCounts['Pilot'] > 0;
  function toggleSelfReserve() {
    setForm(f => {
      const next = { ...(f.self_reserve || {}) };
      next[ship._id] = !next[ship._id];
      return { ...f, self_reserve: next };
    });
  }

  return (
    <div style={{ background: '#0D2030', border: '1px solid #1A3D55', padding: '10px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace" }}>
          <span style={{ fontSize: 16, color: '#99CCFF', letterSpacing: '0.08em' }}>
            {ship.ship_name}
          </span>
          <span style={{ fontSize: 16, color: '#66AADD', marginLeft: 10 }}>{ship.ship_model}</span>
        </div>
        <SmallBtn color="#4488BB" onClick={() => setCollapsed(c => !c)}>
          {collapsed ? '+ EXPAND' : '- COLLAPSE'}
        </SmallBtn>
      </div>

      {!collapsed && (
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {Object.keys(roleCounts).length === 0 && Object.keys(customRoles).length === 0 ? (
              <div style={{ fontSize: 16, color: '#1A3D55', padding: 8 }}>
                NO CREW CONFIGURATION — SHIP HAS NO REGISTERED NODE POSITIONS
              </div>
            ) : (
              <table style={{
                width: '100%',
                fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
                fontSize: 16,
                color: '#99CCFF',
                borderCollapse: 'collapse',
              }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1A3D55' }}>
                    <th style={{ textAlign: 'left', padding: '4px 6px', color: '#66AADD', letterSpacing: '0.12em' }}>ROLE</th>
                    <th style={{ textAlign: 'right', padding: '4px 6px', color: '#66AADD', letterSpacing: '0.12em' }}>SLOTS</th>
                    <th style={{ textAlign: 'right', padding: '4px 6px', color: '#66AADD', letterSpacing: '0.12em' }}>FILLED</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(roleCounts).map(([role, count]) => (
                    <tr key={role}>
                      <td style={{ padding: '4px 6px' }}>{role}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right' }}>{count}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', color: '#66AADD' }}>0 / {count}</td>
                      <td></td>
                    </tr>
                  ))}
                  {Object.entries(customRoles).map(([role, def]) => (
                    <tr key={'c-' + role}>
                      <td style={{ padding: '4px 6px' }}>{role} <span style={{ color: '#FFBB33' }}>(custom)</span></td>
                      <td style={{ padding: '4px 6px', textAlign: 'right' }}>{def.slots}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', color: '#66AADD' }}>0 / {def.slots}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                        <SmallBtn color="#FF5544" onClick={() => removeCustomRole(role)}>REMOVE</SmallBtn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <AddCustomRole onAdd={addCustomRole} />

            {hasPilot && (
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                marginTop: 10, fontSize: 16, color: '#66AADD', letterSpacing: '0.08em',
                fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
                cursor: 'pointer',
              }}>
                <input type="checkbox" checked={selfReserveOn} onChange={toggleSelfReserve} />
                <span>Reserve PILOT for myself ({me?.citizen_name || 'OPERATOR'})</span>
              </label>
            )}
          </div>

          {img && (
            <div style={{
              width: 200, flexShrink: 0,
              alignSelf: 'flex-start',  // ← prevent flex row from stretching wrapper vertically
              background: '#040D15',
              padding: 8, boxSizing: 'border-box',
            }}>
              {/* Inner wrapper sizes exactly to the image so the node overlay
                  anchors to the actual rendered image bounds, not a stretched cell. */}
              <div style={{ position: 'relative', width: '100%' }}>
                <img
                  src={img}
                  alt=""
                  style={{
                    width: '100%', height: 'auto', display: 'block',
                    filter: 'invert(1) sepia(1) saturate(4) hue-rotate(170deg) brightness(0.5) contrast(1.3)',
                  }}
                />
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                  {(ship.node_positions || []).map((n, i) => (
                    <div key={i} className="nexus-node" style={{
                      position: 'absolute',
                      left: `${n.x}%`, top: `${n.y}%`,
                      width: 20, height: 20,
                      border: '2px solid #00FF66',
                      background: 'rgba(0,255,102,0.2)',
                      transform: 'translate(-50%, -50%)',
                      animation: 'nodePulse 1.8s ease-in-out infinite',
                    }} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddCustomRole({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState('');
  const [slots, setSlots] = useState(1);

  if (!open) {
    return (
      <div style={{ marginTop: 10 }}>
        <SmallBtn color="#66AADD" onClick={() => setOpen(true)}>+ ADD CUSTOM ROLE</SmallBtn>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
      <input
        value={role}
        onChange={e => setRole(e.target.value)}
        placeholder="ROLE NAME"
        style={{ ...INPUT_STYLE, flex: 1, fontSize: 16 }}
      />
      <input
        type="number"
        min={1}
        max={9}
        value={slots}
        onChange={e => setSlots(parseInt(e.target.value || '1', 10))}
        style={{ ...INPUT_STYLE, width: 70, fontSize: 16 }}
      />
      <SmallBtn color="#33DDAA" onClick={() => {
        if (role.trim()) { onAdd(role.trim(), slots); setRole(''); setSlots(1); setOpen(false); }
      }}>ADD</SmallBtn>
      <SmallBtn color="#FF5544" onClick={() => { setRole(''); setOpen(false); }}>CANCEL</SmallBtn>
    </div>
  );
}

// ─── Review ─────────────────────────────────────────────────────────────────

function Review({ form, missionTypes }) {
  const FONT = "'JetBrains Mono', 'Courier New', Courier, monospace";
  const dt = form.mission_date && form.mission_time
    ? new Date(`${form.mission_date}T${form.mission_time}`)
    : null;
  const typeInfo = missionTypes.find(t => t.name === form.mission_type);
  const totalSlots = (form.fleet || []).reduce((sum, m) => {
    const counts = {};
    for (const n of m.ship.node_positions || []) counts[n.role] = (counts[n.role] || 0) + 1;
    const customs = form.custom_roles?.[m.ship._id] || {};
    let s = 0;
    for (const v of Object.values(counts)) s += v;
    for (const v of Object.values(customs)) s += (v.slots || 0);
    return sum + s;
  }, 0);

  const sectionHdr = (rgb, accent, label) => (
    <div style={{
      padding: '6px 12px',
      marginBottom: 10,
      background: `linear-gradient(90deg, rgba(${rgb},0.18), rgba(${rgb},0.02))`,
      borderLeft: `3px solid ${accent}`,
    }}>
      <span style={{ fontSize: 12, fontWeight: 'bold', letterSpacing: '0.14em', color: accent }}>
        {label}
      </span>
    </div>
  );

  return (
    <div style={{ padding: 20, fontFamily: FONT }}>
      {/* Mission title */}
      <div style={{ fontSize: 24, color: '#CCE8FF', fontWeight: 'bold', letterSpacing: '0.08em', marginBottom: 8 }}>
        {form.name || '—'}
      </div>
      {/* Meta row */}
      <div style={{ fontSize: 13, color: '#66AADD', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {typeInfo && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 10px', border: '1px solid #4488BB', color: '#99CCFF', fontSize: 11, fontWeight: 'bold' }}>
            {typeInfo.emoji ? `${typeInfo.emoji} ` : ''}{typeInfo.name}
          </span>
        )}
        <span>
          {dt ? dt.toLocaleString() : '—'}{dt ? ` · ${formatCountdown(dt)}` : ''} · {form.is_public ? 'PUBLIC' : 'ORG'}
        </span>
      </div>

      {/* OBJECTIVES */}
      <div style={{ marginBottom: 8 }}>
        {sectionHdr('102,170,221', '#66AADD', 'OBJECTIVES')}
        <div style={{ padding: '0 12px 20px', fontSize: 15, color: '#66AADD', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
          {form.objectives || '—'}
        </div>
      </div>

      {/* FLEET MANIFEST */}
      <div style={{ marginBottom: 8 }}>
        {sectionHdr('255,187,51', '#FFBB33', 'FLEET MANIFEST')}
        <div style={{ padding: '0 12px 20px' }}>
          {(form.fleet || []).map(m => (
            <div key={m.ship_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
              {m.role === 'PRIMARY' ? (
                <span style={{ fontSize: 10, color: '#FFBB33', fontWeight: 'bold', border: '1px solid #FFBB33', padding: '1px 6px' }}>
                  ★ PRIMARY
                </span>
              ) : (
                <span style={{ fontSize: 10, color: '#66AADD', fontWeight: 'bold', border: '1px solid #66AADD', padding: '1px 6px' }}>
                  SUPPORT
                </span>
              )}
              <span style={{ fontSize: 15, color: '#CCE8FF', fontWeight: 'bold' }}>{m.ship_name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* CREW MANIFEST */}
      <div style={{ marginBottom: 8 }}>
        {sectionHdr('68,255,136', '#44FF88', 'CREW MANIFEST')}
        <div style={{ padding: '0 12px 20px' }}>
          {(form.fleet || []).map((m, mi) => {
            const counts = {};
            for (const n of m.ship.node_positions || []) counts[n.role] = (counts[n.role] || 0) + 1;
            const customs = form.custom_roles?.[m.ship._id] || {};
            const roles = [
              ...Object.entries(counts).map(([r, n]) => ({ role: r, count: n })),
              ...Object.entries(customs).map(([r, def]) => ({ role: r, count: def.slots })),
            ];
            const isLast = mi === (form.fleet || []).length - 1;
            return (
              <div key={m.ship_id} style={{ marginBottom: isLast ? 0 : 16 }}>
                <div style={{ fontSize: 15, color: '#CCE8FF', fontWeight: 'bold', marginBottom: 8 }}>
                  {m.ship_name}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {roles.length > 0 ? roles.map(({ role, count }) => (
                    <span key={role} style={{
                      fontSize: 11, color: '#CCFFE0',
                      background: 'rgba(68,255,136,0.08)',
                      border: '1px solid #44FF88',
                      padding: '3px 8px',
                    }}>
                      <b style={{ color: '#44FF88' }}>{role}</b> ×{count}
                    </span>
                  )) : (
                    <span style={{ fontSize: 11, color: '#4488BB' }}>NO SLOTS</span>
                  )}
                </div>
              </div>
            );
          })}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 0', marginTop: 10, borderTop: '1px solid #1A3D55',
          }}>
            <span style={{ fontSize: 12, color: '#4488BB', letterSpacing: '0.1em', fontWeight: 'bold' }}>
              TOTAL CREW SLOTS
            </span>
            <span style={{ fontSize: 24, color: '#CCE8FF', fontWeight: 'bold' }}>{totalSlots}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Wizard wrapper ─────────────────────────────────────────────────────────

function Wizard({ me, onClose, onSuccess }) {
  const [stage, setStage] = useState(1);
  const [completedMax, setCompletedMax] = useState(1);
  const [form, setForm] = useState({
    name: '',
    mission_type: '',
    mission_date: '',
    mission_time: '',
    objectives: '',
    is_public: true,
    queue_on: true,
    queue_minutes: 30,
    frequency: generateFreq(),
    fleet: [],          // [{ ship_id, ship_name, role, ship }]
    custom_roles: {},   // { [shipId]: { roleName: { slots } } }
    self_reserve: {},   // { [shipId]: bool }
  });
  const [missionTypes, setMissionTypes] = useState([]);
  const [myShips, setMyShips] = useState([]);
  const [allShips, setAllShips] = useState([]);
  const [shipImages, setShipImages] = useState({});
  const [specs, setSpecs] = useState({});
  const [nameStatus, setNameStatus] = useState('idle');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [borrowedShipIds, setBorrowedShipIds] = useState(new Set());
  const [myRequests, setMyRequests] = useState({}); // { [shipId]: { _id, status } }
  const nameCheckRef = useRef(null);

  useEffect(() => {
    api.get('/missions/types').then(({ data }) => setMissionTypes(Array.isArray(data) ? data : [])).catch(() => {});
    api.get('/ships/mine').then(({ data }) => setMyShips(Array.isArray(data) ? data : [])).catch(() => {});
    api.get('/ships/all').then(({ data }) => setAllShips(Array.isArray(data) ? data : [])).catch(() => {});
    api.get('/ships/borrowed')
      .then(({ data }) => setBorrowedShipIds(new Set((data || []).map(s => s._id?.toString()))))
      .catch(() => {});
    api.get('/ships/access-requests/mine')
      .then(({ data }) => {
        const map = {};
        for (const r of (data?.as_requester || [])) {
          const key = r.ship_id?.toString();
          if (key) map[key] = { _id: r._id, status: r.status };
        }
        setMyRequests(map);
      })
      .catch(() => {});
    fetch('/images/ships/ship_index_large.json').then(r => r.json()).then(setShipImages).catch(() => {});
    fetch('/images/ships/ship_specs.json').then(r => r.json()).then(setSpecs).catch(() => {});
  }, []);

  const runNameCheck = useCallback((name) => {
    if (nameCheckRef.current) clearTimeout(nameCheckRef.current);
    setNameStatus('checking');
    nameCheckRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get(`/missions/check-name?name=${encodeURIComponent(name)}`);
        setNameStatus(data?.available ? 'available' : 'taken');
      } catch {
        setNameStatus('idle');
      }
    }, 200);
  }, []);

  // Stage validators
  const dt = (() => {
    if (!form.mission_date || !form.mission_time) return null;
    const d = new Date(`${form.mission_date}T${form.mission_time}:00`);
    return isNaN(d.getTime()) ? null : d;
  })();
  const stage1Valid =
    form.name.trim().length > 0 &&
    nameStatus !== 'taken' &&
    !!form.mission_type &&
    !!dt && dt.getTime() > Date.now() &&
    form.objectives.trim().length >= 10;
  const stage2Valid = (form.fleet || []).some(m => m.role === 'PRIMARY');
  const stage3Valid = true;
  const reviewValid = stage1Valid && stage2Valid;

  async function deploy() {
    if (!reviewValid || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const crew_roles_payload = {};
      for (const m of (form.fleet || [])) {
        const base = deriveCrewRolesFromNodes(m.ship.node_positions);
        const customs = form.custom_roles?.[m.ship._id] || {};
        for (const [r, def] of Object.entries(customs)) {
          base[r] = { slots: def.slots, filled: [] };
        }
        if (form.self_reserve?.[m.ship._id] && base['Pilot']) {
          base['Pilot'].filled = [me?.discord_id || me?._id].filter(Boolean);
        }
        crew_roles_payload[m.ship._id] = base;
      }
      const supporting_ships = (form.fleet || []).filter(m => m.role === 'SUPPORT').map(m => m.ship_id);
      const primary_ship = (form.fleet || []).find(m => m.role === 'PRIMARY')?.ship_id;

      const body = {
        name: form.name.trim(),
        mission_type: form.mission_type,
        mission_time: dt.toISOString(),
        objectives: form.objectives.trim(),
        is_public: !!form.is_public,
        queue_expires_minutes: form.queue_on ? parseInt(form.queue_minutes, 10) : null,
        frequency: form.frequency || undefined,
        primary_ship,
        supporting_ships,
        crew_roles: crew_roles_payload,
      };
      await api.post('/missions', body);
      playClick();
      onSuccess?.(form.name.trim());
    } catch (err) {
      setError(err?.response?.data?.error || 'DEPLOY FAILED');
    } finally {
      setSubmitting(false);
    }
  }

  function goNext() {
    if (stage === 1 && !stage1Valid) { setError('FILL ALL BRIEFING FIELDS'); return; }
    if (stage === 2 && !stage2Valid) { setError('PRIMARY SHIP REQUIRED'); return; }
    setError('');
    const next = Math.min(4, stage + 1);
    setStage(next);
    setCompletedMax(m => Math.max(m, next));
  }
  function goBack() {
    setError('');
    setStage(s => Math.max(1, s - 1));
  }

  // Header right buttons depend on stage
  function headerButtons() {
    if (stage === 1) {
      return (
        <>
          <HoverBtn color="#FFBB33" onClick={onClose}>[ CANCEL ]</HoverBtn>
          <HoverBtn color="#00EEFF" onClick={goNext} disabled={!stage1Valid}>
            [ NEXT → FLEET ]
          </HoverBtn>
        </>
      );
    }
    if (stage === 2) {
      return (
        <>
          <HoverBtn color="#FFBB33" onClick={goBack}>[ ← BACK ]</HoverBtn>
          <HoverBtn color="#00EEFF" onClick={goNext} disabled={!stage2Valid}>
            [ NEXT → CREW ]
          </HoverBtn>
        </>
      );
    }
    if (stage === 3) {
      return (
        <>
          <HoverBtn color="#FFBB33" onClick={goBack}>[ ← BACK ]</HoverBtn>
          <HoverBtn color="#00EEFF" onClick={goNext} disabled={!stage3Valid}>
            [ NEXT → REVIEW ]
          </HoverBtn>
        </>
      );
    }
    // stage 4 / review
    return (
      <>
        <HoverBtn color="#FFBB33" onClick={goBack}>[ ← BACK ]</HoverBtn>
        <HoverBtn color="#33DDAA" onClick={deploy} disabled={!reviewValid || submitting}>
          {submitting ? '[ DEPLOYING... ]' : '[ DEPLOY MISSION ]'}
        </HoverBtn>
      </>
    );
  }

  const stageTitle = stage === 4 ? 'REVIEW' : STAGES[stage - 1].label;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#000' }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid #1A3D55',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        flexShrink: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 16, color: '#66AADD', letterSpacing: '0.14em',
            fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
          }}>
            STAGE {String(stage === 4 ? '04' : '0' + stage)} / 03 — {stageTitle}
          </div>
          {form.name && (
            <div style={{
              fontSize: 16, color: '#99CCFF', letterSpacing: '0.08em', marginTop: 4,
              fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
            }}>
              {form.name}
            </div>
          )}
        </div>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
          gap: 6, paddingRight: 16, paddingLeft: 8, flexShrink: 0,
        }}>
          {headerButtons()}
        </div>
      </div>

      {/* Stage pills */}
      <StagePills
        current={stage > 3 ? 3 : stage}
        completedMax={completedMax}
        onJump={(s) => setStage(s)}
      />

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {stage === 1 && (
          <Stage1
            form={form}
            setForm={setForm}
            missionTypes={missionTypes}
            nameStatus={nameStatus}
            setNameStatus={setNameStatus}
            runNameCheck={runNameCheck}
          />
        )}
        {stage === 2 && (
          <Stage2
            form={form}
            setForm={setForm}
            myShips={myShips}
            allShips={allShips}
            shipImages={shipImages}
            specs={specs}
            me={me}
            borrowedShipIds={borrowedShipIds}
            myRequests={myRequests}
            onRequestSent={(shipId, requestId) =>
              setMyRequests(m => ({ ...m, [shipId]: { _id: requestId, status: 'pending' } }))
            }
          />
        )}
        {stage === 3 && (
          <Stage3
            form={form}
            setForm={setForm}
            me={me}
            shipImages={shipImages}
          />
        )}
        {stage === 4 && (
          <Review form={form} missionTypes={missionTypes} />
        )}
      </div>

      {/* Footer */}
      {error && (
        <div style={{
          padding: '8px 20px',
          borderTop: '1px solid #1A3D55',
          fontSize: 16, color: '#FF5544', letterSpacing: '0.08em',
          flexShrink: 0,
          fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Top-level: boot → wizard → success ─────────────────────────────────────

export default function CreateMission({ me, onClose, onSuccess }) {
  const [phase, setPhase] = useState('boot');
  const [fading, setFading] = useState(false);
  const [success, setSuccess] = useState(null);

  function handleBootDone() {
    setFading(true);
    setTimeout(() => { setPhase('wizard'); setFading(false); }, 200);
  }

  function handleSuccess(name) {
    setSuccess(name);
    setTimeout(() => { onSuccess?.(); }, 5000);
  }

  if (success) {
    return (
      <div style={{
        height: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: '#000', padding: 20,
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
      }}>
        <div style={{
          padding: 30,
          border: '1px solid #33DDAA',
          background: 'rgba(51,221,170,0.05)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 13, color: '#33DDAA', letterSpacing: '0.14em', fontWeight: 'bold', marginBottom: 8 }}>
            ✓ MISSION DEPLOYED
          </div>
          <div style={{ fontSize: 18, color: '#CCE8FF', fontWeight: 'bold' }}>
            {success}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', opacity: fading ? 0 : 1, transition: 'opacity 0.2s ease' }}>
      {phase === 'boot' && (
        <BootSequence operatorName={me?.citizen_name} onDone={handleBootDone} />
      )}
      {phase === 'wizard' && (
        <Wizard me={me} onClose={onClose} onSuccess={handleSuccess} />
      )}
    </div>
  );
}
