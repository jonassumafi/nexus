import { useState, useEffect, useRef, useMemo } from 'react';
import api from '../services/api';

const modemSnd = new Audio('/sounds/modem.mp3');
const playClick = () => {
  const file = Math.random() > 0.5 ? '/sounds/click.mp3' : '/sounds/click2.mp3';
  const snd = new Audio(file);
  snd.volume = 0.7;
  snd.play().catch(() => {});
};
const playModem = () => { try { modemSnd.currentTime = 0; modemSnd.volume = 0.5; modemSnd.play(); } catch(e) {} };

// Reverse manufacturer map: display name -> list of slug prefixes
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

// Shared style for the CANCEL + REGISTER VESSEL buttons in the header right column.
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

const ROLE_CATEGORIES = [
  { name: 'COMBAT', roles: ['PILOT', 'CO-PILOT', 'TURRET OPERATOR', 'REMOTE TURRET OPERATOR', 'GUNNER', 'MARINE', 'BOARDING SPECIALIST'] },
  { name: 'SUPPORT', roles: ['ENGINEER', 'SUPPORT ENGINEER', 'MEDIC', 'NAVIGATOR'] },
  { name: 'OPERATIONS', roles: ['CARGO MANAGER', 'MINING LASER OPERATOR', 'SALVAGE OPERATOR', 'SCIENCE OFFICER', 'SENSOR OPERATOR'] },
  { name: 'COMMAND', roles: ['EXECUTIVE OFFICER', 'TACTICAL OFFICER'] },
];

// ─── Boot sequence ──────────────────────────────────────────────────────────

// Splash-style dot animation system, parameterized by per-flow LINE_DEFS.
const DOT_SLOTS = 20;
const TICK_MS = 80;
const IDLE_P = 'idle';
const ANIMATING_P = 'animating';
const RESOLVED_P = 'resolved';
const DIVIDER_LINE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

function dotsString(n) {
  return '[' + '.'.repeat(n) + ' '.repeat(DOT_SLOTS - n) + ']';
}
function randIntR(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

const REG_LINE_DEFS = [
  { label: 'AUTHENTICATING OPERATOR  ', status: 'OK',     color: '#66AADD', range: [600, 1800] },
  { label: 'ACCESSING FLEET REGISTRY ', status: 'OK',     color: '#66AADD', range: [500, 1600] },
  { label: 'VERIFYING CLEARANCE      ', status: 'OK',     color: '#66AADD', range: [400, 1400] },
  { label: 'LOADING CONFIG SUITE     ', status: 'OK',     color: '#66AADD', range: [500, 1500] },
  { label: 'INITIALIZING CREW EDITOR ', status: 'OK',     color: '#66AADD', range: [400, 1200] },
  { label: 'ESTABLISHING CONNECTION  ', status: 'READY',  color: '#33DDAA', range: [300, 1000] },
  { label: 'REGISTRY TERMINAL        ', status: 'ONLINE', color: '#33DDAA', range: [200, 800]  },
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
    REG_LINE_DEFS.map(() => ({ phase: IDLE_P, dots: 0 }))
  );

  if (!seqRef.current) {
    const HEADER_TIME = 700;
    const TAIL_TIME = 500;
    const budget = Math.max(2000, duration - HEADER_TIME - TAIL_TIME);
    let durations = REG_LINE_DEFS.map(({ range }) => randIntR(range[0], range[1]));
    const total = durations.reduce((s, d) => s + d, 0);
    if (total > budget) {
      const scale = budget / total;
      durations = durations.map(d => Math.max(Math.floor(d * scale), 150));
    }
    seqRef.current = { durations, headerTime: HEADER_TIME };
  }

  useEffect(() => {
    const snd = new Audio('/sounds/processing.mp3');
    snd.loop = true;
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
    REG_LINE_DEFS.forEach((_, index) => {
      const dur = seqRef.current.durations[index];
      schedule(() => {
        setLineStates(prev => {
          const next = [...prev];
          next[index] = { phase: ANIMATING_P, dots: 0 };
          return next;
        });
        let dotPos = 0;
        const iid = setInterval(() => {
          dotPos = (dotPos + 1) % (DOT_SLOTS + 1);
          setLineStates(prev => {
            const next = [...prev];
            if (next[index].phase === ANIMATING_P) {
              next[index] = { phase: ANIMATING_P, dots: dotPos };
            }
            return next;
          });
        }, TICK_MS);
        iids.push(iid);
        schedule(() => {
          clearInterval(iid);
          setLineStates(prev => {
            const next = [...prev];
            next[index] = { phase: RESOLVED_P, dots: DOT_SLOTS };
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
    ls.phase === RESOLVED_P ? REG_LINE_DEFS[idx].color : '#66AADD';

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
            NEXUS FLEET REGISTRY — TERMINAL ACCESS v2.1
          </div>
        )}
        {showDivOpen && (
          <div style={{ color: '#1A3D55' }}>{DIVIDER_LINE}</div>
        )}
        {header2 && (
          <div style={{ color: '#66AADD', whiteSpace: 'pre', marginBottom: 12 }}>
            {`OPERATOR: ${operatorName || 'UNKNOWN'}  //  AUTH: VERIFIED`}
          </div>
        )}

        {REG_LINE_DEFS.map((def, i) => {
          const ls = lineStates[i];
          if (ls.phase === IDLE_P) return null;
          return (
            <div key={i} style={{ color: lineColor(ls, i), whiteSpace: 'pre' }}>
              {def.label}{dotsString(ls.dots)}{ls.phase === RESOLVED_P ? '  ' + def.status : ''}
            </div>
          );
        })}

        {showDivClose && (
          <div style={{ color: '#1A3D55', marginTop: 8 }}>{DIVIDER_LINE}</div>
        )}
        {showReady && (
          <div style={{ color: '#33DDAA', whiteSpace: 'pre' }}>
            &gt; REGISTRY TERMINAL READY
          </div>
        )}
        {showPrompt && (
          <div style={{ color: '#00EEFF', whiteSpace: 'pre' }}>
            &gt; AWAITING VESSEL DATA INPUT...
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

// ─── Main registration form ─────────────────────────────────────────────────

function RegistrationForm({ me, specs, onClose, onSuccess }) {
  const [callsign, setCallsign]               = useState('');
  const [manufacturer, setManufacturer]       = useState('ALL MANUFACTURERS');
  const [search, setSearch]                   = useState('');
  const [showDropdown, setShowDropdown]       = useState(false);
  const [selectedModel, setSelectedModel]     = useState(null);
  const [shipHistory, setShipHistory]         = useState('');
  const [activeRole, setActiveRole]           = useState(null);
  const [nodes, setNodes]                     = useState([]);  // { id, role, x, y }
  const [selectedNodeId, setSelectedNodeId]   = useState(null);
  const [error, setError]                     = useState('');
  const [submitting, setSubmitting]           = useState(false);
  const [refining, setRefining]               = useState(false);
  const [refineDots, setRefineDots]           = useState(0);
  const [hoveredNodeId, setHoveredNodeId]     = useState(null);
  const [shipImages, setShipImages]           = useState({});
  const [cancelHover, setCancelHover]         = useState(false);
  const [submitHover, setSubmitHover]         = useState(false);
  const [refineHover, setRefineHover]         = useState(false);
  const [clearHover, setClearHover]           = useState(false);
  const [success, setSuccess]                 = useState(null);  // { callsign }

  const schematicRef = useRef(null);
  const nextNodeId = useRef(1);
  const dragState = useRef(null);  // { nodeId, startX, startY, moved }

  // Load schematic image index
  useEffect(() => {
    fetch('/images/ships/ship_index_large.json')
      .then(r => r.json())
      .then(setShipImages)
      .catch(() => {});
  }, []);

  // Filtered search results
  const results = useMemo(() => {
    if (!specs) return [];
    const q = search.trim().toLowerCase();
    const prefixes = manufacturer === 'ALL MANUFACTURERS' ? null : MFG_PREFIX[manufacturer];
    const out = [];
    for (const [slug, spec] of Object.entries(specs)) {
      if (prefixes && !prefixes.some(p => slug === p || slug.startsWith(p + '_'))) continue;
      if (q && !(spec.display_name || '').toLowerCase().includes(q)) continue;
      out.push({ slug, spec });
      if (out.length >= 40) break;
    }
    return out;
  }, [specs, search, manufacturer]);

  // Refine dots animation
  useEffect(() => {
    if (!refining) return;
    const id = setInterval(() => setRefineDots(d => (d + 1) % 4), 400);
    return () => clearInterval(id);
  }, [refining]);

  // Delete key for selected node; Escape clears the active role
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const isInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (e.key === 'Delete' && selectedNodeId !== null) {
        if (isInput) return;
        e.preventDefault();
        removeNode(selectedNodeId);
        setSelectedNodeId(null);
      } else if (e.key === 'Escape') {
        if (isInput) return;
        setActiveRole(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId]);

  function selectModel(slug, spec) {
    setSelectedModel({ slug, spec });
    setSearch(spec.display_name || slug);
    setShowDropdown(false);
    setNodes([]);
    setActiveRole(null);
    setSelectedNodeId(null);
  }

  function placeNode(e) {
    // Right-click places a node — suppress the browser's own context menu.
    e.preventDefault();
    if (!activeRole) return;
    if (!schematicRef.current) return;
    const rect = schematicRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    const id = nextNodeId.current++;
    setNodes(prev => [...prev, { id, role: activeRole, x: +x.toFixed(1), y: +y.toFixed(1) }]);
  }

  function removeNode(id) {
    setNodes(prev => prev.filter(n => n.id !== id));
  }

  function clearAllNodes() {
    setNodes([]);
    setActiveRole(null);
    setSelectedNodeId(null);
  }

  function onNodeMouseDown(e, node) {
    e.stopPropagation();
    if (e.button === 2) return;  // right click handled by contextmenu
    const rect = schematicRef.current.getBoundingClientRect();
    dragState.current = {
      nodeId: node.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      rect,
      moved: false,
    };
    const onMove = (ev) => {
      const ds = dragState.current;
      if (!ds) return;
      const dx = ev.clientX - ds.startClientX;
      const dy = ev.clientY - ds.startClientY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) ds.moved = true;
      if (ds.moved) {
        const x = ((ev.clientX - ds.rect.left) / ds.rect.width) * 100;
        const y = ((ev.clientY - ds.rect.top) / ds.rect.height) * 100;
        const clamped_x = Math.max(0, Math.min(100, x));
        const clamped_y = Math.max(0, Math.min(100, y));
        setNodes(prev => prev.map(n => n.id === ds.nodeId
          ? { ...n, x: +clamped_x.toFixed(1), y: +clamped_y.toFixed(1) }
          : n
        ));
      }
    };
    const onUp = () => {
      // Selection is handled by a separate onClick on the node — mouse-down
      // now only owns the drag lifecycle.
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onNodeContextMenu(e, node) {
    // Right-click on a node deselects (no longer deletes — Delete key does that).
    e.preventDefault();
    e.stopPropagation();
    setSelectedNodeId(null);
  }

  // Per-role node count for number label
  function nodeLabel(node) {
    const sameRole = nodes.filter(n => n.role === node.role);
    return String(sameRole.findIndex(n => n.id === node.id) + 1);
  }

  // Role button state — active and placed are independent.
  // A role can be both active (cyan, ready to place more) and placed (✓, has nodes).
  function roleState(role) {
    return {
      active: activeRole === role,
      placed: nodes.some(n => n.role === role),
    };
  }

  function roleBtnStyle(state, hover) {
    if (state.active) return { border: '1px solid #00EEFF', color: '#00EEFF', background: 'rgba(0,238,255,0.05)' };
    if (state.placed) return { border: '1px solid #00FF66', color: '#00FF66', background: '#000' };
    if (hover) return { border: '1px solid #2A6A9A', color: '#99CCFF', background: '#000' };
    return { border: '1px solid #1A3D55', color: '#66AADD', background: '#000' };
  }

  async function handleRefine() {
    if (!shipHistory.trim() || refining) return;
    playModem();
    setRefining(true);
    try {
      const { data } = await api.post('/users/refine-text', { text: shipHistory });
      if (data?.refined_text) setShipHistory(data.refined_text);
    } catch (err) {
      setError(err?.response?.data?.error || 'REFINE FAILED');
    } finally {
      setRefining(false);
    }
  }

  function validate() {
    if (!callsign.trim()) return 'CALLSIGN REQUIRED';
    if (!selectedModel) return 'SHIP MODEL REQUIRED';
    return '';
  }

  async function handleSubmit() {
    const v = validate();
    if (v) { setError(v); return; }
    const hasPilot = nodes.some(n => n.role.toLowerCase() === 'pilot');
    if (!hasPilot) {
      setError('A PILOT NODE IS REQUIRED — SELECT PILOT FROM THE ROLE PALETTE AND PLACE IT ON THE SCHEMATIC');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        ship_name: callsign.toUpperCase().trim(),
        ship_model: selectedModel.slug,
        ship_type: selectedModel.spec?.role || '',
        description: shipHistory,
        node_positions: nodes.map(n => ({ role: n.role, x: n.x, y: n.y })),
      };
      const { data } = await api.post('/ships/register', payload);
      if (data?.success) {
        playClick();
        setSuccess({ callsign: payload.ship_name });
        setTimeout(() => onSuccess?.(), 2000);
      } else {
        setError('REGISTRATION FAILED');
      }
    } catch (err) {
      setError(err?.response?.data?.error || 'REGISTRATION FAILED');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div style={{
        background: '#000', height: '100%',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
        padding: 20, textAlign: 'center',
      }}>
        <div style={{ fontSize: 19.5, color: '#33DDAA', letterSpacing: '0.1em', marginBottom: 14 }}>
          ✓ {success.callsign} REGISTERED TO NEXUS FLEET INVENTORY
        </div>
        <div style={{ fontSize: 16.5, color: '#66AADD', letterSpacing: '0.08em' }}>
          VESSEL RECORD SAVED — RETURNING TO OPERATIONS...
        </div>
      </div>
    );
  }

  const hasPilot = nodes.some(n => n.role.toLowerCase() === 'pilot');
  const formInvalid = !callsign.trim() || !selectedModel || !hasPilot;
  const schemImg = selectedModel ? shipImages[selectedModel.slug] : null;
  const labelStyle = { fontSize: 16, color: '#66AADD', letterSpacing: '0.14em', marginBottom: 6, display: 'block', textTransform: 'uppercase' };
  const inputStyle = {
    width: '100%', background: '#000', border: '1px solid #4488BB',
    color: '#99CCFF', fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
    fontSize: 18, padding: '8px 10px', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#000', fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
    }}>

      {/* Header — title left, CANCEL + REGISTER VESSEL stacked right */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid #1A3D55',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0,
      }}>
        <div style={{ fontSize: 16, color: '#99CCFF', letterSpacing: '0.18em' }}>
          ⊕ VESSEL REGISTRATION
        </div>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 6,
          paddingRight: 16,
          paddingLeft: 8,
          flexShrink: 0,
        }}>
          <button
            onClick={() => {
              playClick();
              try { modemSnd.pause(); modemSnd.currentTime = 0; } catch(e) {}
              onClose?.();
            }}
            onMouseEnter={() => setCancelHover(true)}
            onMouseLeave={() => setCancelHover(false)}
            style={{
              ...HEADER_BTN_STYLE,
              border: '1px solid #FFBB33',
              color: cancelHover ? '#000' : '#FFBB33',
              background: cancelHover ? '#FFBB33' : '#000',
            }}>
            [ CANCEL ]
          </button>
          <button
            onClick={handleSubmit}
            disabled={formInvalid || submitting}
            onMouseEnter={() => setSubmitHover(true)}
            onMouseLeave={() => setSubmitHover(false)}
            style={{
              ...HEADER_BTN_STYLE,
              border: `1px solid ${formInvalid ? '#1A3D55' : '#33DDAA'}`,
              color: formInvalid ? '#1A3D55' : (submitHover ? '#000' : '#33DDAA'),
              background: !formInvalid && submitHover ? '#33DDAA' : '#000',
              cursor: formInvalid || submitting ? 'default' : 'pointer',
            }}>
            {submitting ? '[ REGISTERING... ]' : '[ REGISTER VESSEL ]'}
          </button>
          {error && (
            <div style={{
              fontSize: 16,
              color: '#FF5544',
              letterSpacing: '0.08em',
              marginTop: 4,
              textAlign: 'right',
              maxWidth: 220,
            }}>
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>

        {/* Left column 40% */}
        <div style={{
          width: '40%',
          padding: 20, overflowY: 'auto',
          borderRight: '1px solid #1A3D55',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>

          {/* Callsign */}
          <div>
            <label style={labelStyle}>SHIP CALLSIGN</label>
            <input
              type="text"
              value={callsign}
              onChange={e => setCallsign(e.target.value.slice(0, 60))}
              onBlur={() => setCallsign(c => c.toUpperCase())}
              placeholder="e.g. HCS CHIMERA"
              maxLength={60}
              style={inputStyle}
            />
          </div>

          {/* Ship Model */}
          <div>
            <label style={labelStyle}>SHIP MODEL</label>
            <select
              value={manufacturer}
              onChange={e => {
                setManufacturer(e.target.value);
                setSearch('');
                setSelectedModel(null);
                setNodes([]);
                setActiveRole(null);
                setSelectedNodeId(null);
                setShowDropdown(true);
              }}
              style={{ ...inputStyle, marginBottom: 8, cursor: 'pointer' }}
            >
              {MANUFACTURERS.map(m => <option key={m} value={m} style={{ background: '#000' }}>{m}</option>)}
            </select>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={search}
                onChange={e => { setSearch(e.target.value); setShowDropdown(true); }}
                onFocus={() => setShowDropdown(true)}
                placeholder="> SEARCH SHIP MODEL..."
                style={inputStyle}
              />
              {showDropdown && results.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0,
                  background: '#000', border: '1px solid #1A3D55',
                  maxHeight: 200, overflowY: 'auto', zIndex: 10,
                }}>
                  {results.map(r => (
                    <ResultRow
                      key={r.slug}
                      slug={r.slug}
                      spec={r.spec}
                      onClick={() => selectModel(r.slug, r.spec)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Ship History */}
          <div>
            <label style={labelStyle}>SHIP HISTORY</label>
            <textarea
              value={shipHistory}
              onChange={e => setShipHistory(e.target.value.slice(0, 1000))}
              rows={6}
              maxLength={1000}
              placeholder="Describe your vessel in roleplay terms — its history, exploits, and character. What has this ship seen?"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace" }}
            />
            <div style={{ textAlign: 'right', color: '#66AADD', fontSize: 16, marginTop: 2 }}>
              {shipHistory.length} / 1000
            </div>
            <button
              onClick={handleRefine}
              disabled={refining || !shipHistory.trim()}
              onMouseEnter={() => setRefineHover(true)}
              onMouseLeave={() => setRefineHover(false)}
              style={{
                width: '100%',
                border: '1px solid #66AADD',
                color: refineHover && !refining ? '#000' : '#66AADD',
                background: refineHover && !refining ? '#66AADD' : '#000',
                fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
                fontSize: 16, letterSpacing: '0.12em', padding: 6,
                marginTop: 8, cursor: refining || !shipHistory.trim() ? 'default' : 'pointer',
                opacity: !shipHistory.trim() && !refining ? 0.5 : 1,
              }}
            >
              {refining ? `REFINING${'.'.repeat(refineDots)}` : '✦ AI REFINE HISTORY'}
            </button>
          </div>
        </div>

        {/* Right column 60% */}
        <div style={{
          width: '60%',
          padding: 20, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>

          {/* Instructions panel */}
          <div style={{
            background: '#0D2030', border: '1px solid #1A3D55',
            padding: '10px 14px', fontSize: 16, color: '#66AADD',
            lineHeight: 1.8, letterSpacing: '0.06em',
          }}>
            <div style={{ color: '#99CCFF', marginBottom: 4 }}>HOW TO CONFIGURE YOUR CREW</div>
            <div style={{ color: '#1A3D55' }}>──────────────────────────────────────────</div>
            <div>1. Select a role from the palette</div>
            <div>2. Right-click schematic to place</div>
            <div>3. Left-click a node to select it</div>
            <div>4. Drag a selected node to move it</div>
            <div>5. Right-click a node to deselect</div>
            <div>6. Press DELETE to remove selected</div>
            <div>7. Same role can be placed multiple times</div>
          </div>

          {/* Schematic — right-click places, left-click on empty space
              deselects. Node clicks stopPropagation so they don't bubble to
              this handler. */}
          <div
            ref={schematicRef}
            onContextMenu={placeNode}
            onClick={() => setSelectedNodeId(null)}
            style={{
              position: 'relative', width: '100%', maxWidth: '80%', margin: '0 auto',
              background: '#000',
              ...(selectedModel ? {} : {
                height: 128,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#1A3D55', fontSize: 16.5, letterSpacing: '0.1em',
              }),
              cursor: activeRole ? 'crosshair' : 'default',
            }}
          >
            {!selectedModel && 'SELECT A SHIP MODEL TO VIEW SCHEMATIC'}
            {selectedModel && schemImg && (
              <img
                src={schemImg}
                alt=""
                style={{
                  width: '100%', height: 'auto', display: 'block',
                  pointerEvents: 'none',
                  filter: 'invert(1) sepia(1) saturate(4) hue-rotate(170deg) brightness(0.5) contrast(1.3)',
                }}
              />
            )}
            {selectedModel && !schemImg && (
              <div style={{ padding: 60, color: '#1A3D55', textAlign: 'center', fontSize: 16.5 }}>
                [ NO SCHEMATIC IMAGE ]
              </div>
            )}

            {/* Nodes layer */}
            {selectedModel && (
              <div style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                pointerEvents: 'none',
              }}>
                {nodes.map(n => {
                  const isSelected = selectedNodeId === n.id;
                  return (
                    <div
                      key={n.id}
                      onMouseDown={e => onNodeMouseDown(e, n)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedNodeId(prev => prev === n.id ? null : n.id);
                      }}
                      onContextMenu={e => onNodeContextMenu(e, n)}
                      onMouseEnter={() => setHoveredNodeId(n.id)}
                      onMouseLeave={() => setHoveredNodeId(null)}
                      className="nexus-node"
                      style={{
                        position: 'absolute',
                        left: `${n.x}%`, top: `${n.y}%`,
                        width: 48, height: 48,
                        border: `2px solid ${isSelected ? '#00EEFF' : '#00FF66'}`,
                        background: isSelected ? 'rgba(0,238,255,0.15)' : 'rgba(0,255,102,0.2)',
                        boxShadow: isSelected ? '0 0 0 3px rgba(0,238,255,0.3)' : undefined,
                        transform: 'translate(-50%, -50%)',
                        cursor: 'pointer',
                        animation: isSelected ? 'none' : 'nodePulse 1.8s ease-in-out infinite',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: isSelected ? '#00EEFF' : '#00FF66',
                        fontSize: 21,
                        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
                        pointerEvents: 'auto',
                        userSelect: 'none',
                        zIndex: 5,
                      }}
                    >
                      {nodeLabel(n)}
                      {hoveredNodeId === n.id && (
                        <div style={{
                          position: 'absolute',
                          transform: 'translate(-50%, -140%)',
                          left: '50%',
                          background: '#0D2030',
                          border: '1px solid #1A3D55',
                          color: '#99CCFF',
                          fontSize: 16,
                          padding: '3px 7px',
                          whiteSpace: 'nowrap',
                          pointerEvents: 'none',
                          fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
                          letterSpacing: '0.08em',
                          zIndex: 10,
                        }}>
                          {n.role}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Palette */}
          <div>
            <div style={{
              fontSize: 16, color: '#66AADD', letterSpacing: '0.14em',
              marginBottom: 8, textTransform: 'uppercase',
            }}>
              CREW ROLE PALETTE
            </div>

            {ROLE_CATEGORIES.map(cat => (
              <div key={cat.name}>
                <div style={{
                  fontSize: 16, color: '#66AADD', letterSpacing: '0.14em',
                  borderBottom: '1px solid #0D2030', paddingBottom: 3,
                  margin: '8px 0 4px',
                }}>
                  {cat.name}
                </div>
                {cat.roles.map(role => (
                  <RoleButton
                    key={role}
                    role={role}
                    state={roleState(role)}
                    onClick={() => {
                      playClick();
                      setActiveRole(prev => prev === role ? null : role);
                    }}
                    styleFn={roleBtnStyle}
                  />
                ))}
              </div>
            ))}

            <button
              onClick={() => { playClick(); clearAllNodes(); }}
              onMouseEnter={() => setClearHover(true)}
              onMouseLeave={() => setClearHover(false)}
              style={{
                width: '100%', marginTop: 10,
                border: '1px solid #FF5544',
                color: clearHover ? '#000' : '#FF5544',
                background: clearHover ? '#FF5544' : '#000',
                fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
                fontSize: 16, padding: 5, cursor: 'pointer',
                letterSpacing: '0.1em',
              }}>
              ✕ CLEAR ALL NODES
            </button>
            {selectedModel && !nodes.some(n => n.role.toLowerCase() === 'pilot') && (
              <div style={{ fontSize: 13, color: '#FFBB33', letterSpacing: '0.08em', marginTop: 8, textAlign: 'center' }}>
                ⚠ PILOT NODE REQUIRED TO REGISTER
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

function ResultRow({ slug, spec, onClick }) {
  const [hover, setHover] = useState(false);
  const crewRange = (spec.crew_min && spec.crew_max)
    ? (spec.crew_min === spec.crew_max ? `CREW ${spec.crew_min}` : `CREW ${spec.crew_min}–${spec.crew_max}`)
    : '';
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '8px 10px',
        borderBottom: '1px solid #0D2030',
        cursor: 'pointer',
        display: 'flex',
        justifyContent: 'space-between',
        background: hover ? '#0D2030' : '#000',
      }}>
      <span style={{ color: '#66AADD', fontSize: 16.5 }}>{spec.display_name || slug}</span>
      <span style={{ color: '#66AADD', fontSize: 16 }}>{crewRange}</span>
    </div>
  );
}

function RoleButton({ role, state, onClick, styleFn }) {
  const [hover, setHover] = useState(false);
  const s = styleFn(state, hover);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'block', width: '100%',
        marginBottom: 4, padding: '5px 10px',
        background: s.background,
        border: s.border,
        color: s.color,
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
        fontSize: 16, textAlign: 'left',
        cursor: 'pointer',
        letterSpacing: '0.08em',
      }}>
      {state.placed ? `✓ ${role}` : `[ ${role} ]`}
    </button>
  );
}

// ─── Wrapper: boot → form ────────────────────────────────────────────────────

export default function ShipRegistration({ me, onClose, onSuccess }) {
  const [phase, setPhase] = useState('boot');  // 'boot' | 'form'
  const [fading, setFading] = useState(false);
  const [specs, setSpecs] = useState(null);

  useEffect(() => {
    fetch('/images/ships/ship_specs.json')
      .then(r => r.json())
      .then(setSpecs)
      .catch(() => {});
  }, []);

  function handleBootDone() {
    setFading(true);
    setTimeout(() => { setPhase('form'); setFading(false); }, 200);
  }

  return (
    <div style={{
      height: '100%',
      opacity: fading ? 0 : 1,
      transition: 'opacity 0.2s ease',
    }}>
      {phase === 'boot' && (
        <BootSequence operatorName={me?.citizen_name} onDone={handleBootDone} />
      )}
      {phase === 'form' && (
        <RegistrationForm
          me={me}
          specs={specs}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      )}
    </div>
  );
}
