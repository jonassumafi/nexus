import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import api from '../services/api';
import TerminalBoot from './TerminalBoot';

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
  fontFamily: "'Inter', system-ui, sans-serif",
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

const REG_PHASES = [
  { label: 'AUTHENTICATING OPERATOR',  status: 'OK'     },
  { label: 'ACCESSING FLEET REGISTRY', status: 'OK'     },
  { label: 'VERIFYING CLEARANCE',      status: 'OK'     },
  { label: 'LOADING CONFIG SUITE',     status: 'OK'     },
  { label: 'INITIALIZING CREW EDITOR', status: 'OK'     },
  { label: 'ESTABLISHING CONNECTION',  status: 'READY'  },
  { label: 'REGISTRY TERMINAL',        status: 'ONLINE' },
];

function BootSequence({ operatorName, onDone }) {
  const sndRef = useRef(null);

  useEffect(() => {
    const snd = new Audio('/sounds/processing.mp3');
    snd.loop = true;
    snd.volume = 0.4;
    snd.play().catch(() => {});
    sndRef.current = snd;
    return () => {
      try { snd.pause(); snd.currentTime = 0; snd.src = ''; snd.load(); } catch {}
    };
  }, []);

  return (
    <div style={{
      background: '#000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', width: '100%', overflow: 'hidden',
    }}>
      <TerminalBoot
        title="NEXUS FLEET REGISTRY — TERMINAL ACCESS v2.1"
        operatorLine={<>OPERATOR: <b>{operatorName || 'UNKNOWN'}</b> &nbsp;//&nbsp; AUTH: <b>VERIFIED</b></>}
        phases={REG_PHASES}
        phaseDelay={700}
        onComplete={() => {
          try { sndRef.current?.pause(); } catch {}
          onDone?.();
        }}
        completeDelay={1200}
        awaitingLabel="AWAITING VESSEL DATA INPUT"
        readyLabel="REGISTRY TERMINAL READY"
        loadingLabel="REGISTRY TERMINAL LOADING"
      />
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
    if (state.active) return {
      border: '1px solid var(--cyan)',
      color: 'var(--cyan)',
      background: 'rgba(0,238,255,0.08)',
    };
    if (state.placed) return {
      border: '1px solid var(--lime)',
      color: 'var(--lime)',
      background: 'rgba(68,255,136,0.08)',
    };
    if (hover) return {
      border: '1px solid var(--rim1)',
      color: 'var(--fg0)',
      background: 'rgba(102,170,221,0.06)',
    };
    return {
      border: '1px solid var(--rim0)',
      color: 'var(--fg1)',
      background: 'transparent',
    };
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
        fontFamily: "'Inter', system-ui, sans-serif",
        padding: 20, textAlign: 'center',
      }}>
        <div style={{ fontSize: 19.5, color: '#44FF88', letterSpacing: '0.1em', marginBottom: 14 }}>
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
  const labelStyle = {
    fontSize: 12, fontWeight: 600, color: 'var(--fg2)',
    letterSpacing: '0.03em', marginBottom: 6,
    display: 'block', textTransform: 'uppercase',
  };
  const inputStyle = {
    width: '100%', background: '#02080e',
    border: '1px solid var(--rim0)', borderRadius: 5,
    color: 'var(--fg0)', fontFamily: 'var(--font)',
    fontSize: 14, padding: '9px 11px', outline: 'none',
    boxShadow: '0 2px 6px #000 inset',
    boxSizing: 'border-box',
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg0)', fontFamily: 'var(--font)',
    }}>

      {/* Header — title left, CANCEL + REGISTER VESSEL stacked right */}
      <div className="sh" style={{ alignItems: 'flex-start' }}>
        <span style={{ fontSize: 13, color: 'var(--fg0)', letterSpacing: '0.08em' }}>
          ⊕ Vessel registration
        </span>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 6,
          flexShrink: 0,
          minWidth: 220,
        }}>
          <button
            className="btn amb"
            onClick={() => {
              playClick();
              try { modemSnd.pause(); modemSnd.currentTime = 0; } catch(e) {}
              onClose?.();
            }}
            style={HEADER_BTN_STYLE}
          >
            Cancel
          </button>
          <button
            className="btn go"
            onClick={handleSubmit}
            disabled={formInvalid || submitting}
            style={HEADER_BTN_STYLE}
          >
            {submitting ? <><span className="spinner" />Registering…</> : 'Register vessel'}
          </button>
          {error && (
            <div className="err" style={{ textAlign: 'right', maxWidth: 220 }}>
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
          borderRight: '1px solid var(--rim0)',
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
                <div className="raised" style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                  maxHeight: 220, overflowY: 'auto', zIndex: 10, padding: 0,
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
              style={{ ...inputStyle, resize: 'vertical', fontFamily: "'Inter', system-ui, sans-serif" }}
            />
            <div style={{ textAlign: 'right', color: 'var(--fg3)', fontSize: 11, marginTop: 2 }}>
              {shipHistory.length} / 1000
            </div>
            <button
              className="btn"
              onClick={handleRefine}
              disabled={refining || !shipHistory.trim()}
              style={{ width: '100%', fontSize: 12, padding: '7px 10px', marginTop: 8 }}
            >
              {refining
                ? <><span className="spinner" />Refining{'.'.repeat(refineDots)}</>
                : <>✦ AI refine history</>}
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
          <div className="raised" style={{
            padding: '12px 14px',
            borderColor: 'rgba(255,187,51,0.3)',
            fontSize: 12, color: 'var(--fg2)', lineHeight: 1.75,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
              color: 'var(--amber)', textTransform: 'uppercase', marginBottom: 6,
            }}>
              How to configure your crew
            </div>
            <div>1. Select a role from the palette.</div>
            <div>2. Right-click the schematic to place.</div>
            <div>3. Left-click a node to select it.</div>
            <div>4. Drag a selected node to move it.</div>
            <div>5. Right-click a node to deselect.</div>
            <div>6. Press <kbd>Delete</kbd> to remove selected.</div>
            <div>7. Same role can be placed multiple times.</div>
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
                color: '#1A3A50', fontSize: 16.5, letterSpacing: '0.1em',
              }),
              cursor: activeRole ? 'crosshair' : 'default',
            }}
          >
            {!selectedModel && (
              <span style={{
                color: 'var(--fg3)', fontSize: 13, letterSpacing: '0.08em',
                textTransform: 'uppercase', fontWeight: 600,
              }}>
                Select a ship model to view schematic
              </span>
            )}
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
              <div className="empty" style={{ padding: 60 }}>
                No schematic image available
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
                        fontFamily: "'Inter', system-ui, sans-serif",
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
                          background: '#061018',
                          border: '1px solid #1A3A50',
                          color: '#99BBDD',
                          fontSize: 16,
                          padding: '3px 7px',
                          whiteSpace: 'nowrap',
                          pointerEvents: 'none',
                          fontFamily: "'Inter', system-ui, sans-serif",
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

          {/* Palette — 2-column grid of raised category cards. Each card
              carries the same bevel/relief as other cards in the system
              (see ShipRegistryCard). Prevents the long scroll list the
              old layout required. */}
          <div>
            <div className="h3" style={{ marginBottom: 10 }}>
              Crew role palette
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 10,
            }}>
              {ROLE_CATEGORIES.map(cat => (
                <div key={cat.name} className="raised" style={{ padding: 12 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
                    color: 'var(--blue)', textTransform: 'uppercase',
                    paddingBottom: 6,
                    marginBottom: 8,
                    borderBottom: '1px solid var(--rim0)',
                  }}>
                    {cat.name}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
                </div>
              ))}
            </div>

            <button
              className="btn warn"
              onClick={() => { playClick(); clearAllNodes(); }}
              style={{ width: '100%', marginTop: 12, fontSize: 12, padding: '7px 10px' }}
            >
              ✕ Clear all nodes
            </button>
            {selectedModel && !nodes.some(n => n.role.toLowerCase() === 'pilot') && (
              <div className="badge b-amber" style={{ marginTop: 10, display: 'block', textAlign: 'center' }}>
                ⚠ Pilot node required to register
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
        padding: '8px 11px',
        borderBottom: '1px solid rgba(26,58,80,.5)',
        cursor: 'pointer',
        display: 'flex',
        justifyContent: 'space-between',
        gap: 10,
        background: hover ? 'rgba(63,130,179,.08)' : 'transparent',
        transition: 'background .12s',
      }}>
      <span style={{ color: 'var(--fg0)', fontSize: 13 }}>{spec.display_name || slug}</span>
      <span style={{ color: 'var(--fg3)', fontSize: 12, whiteSpace: 'nowrap' }}>{crewRange}</span>
    </div>
  );
}

function RoleButton({ role, state, onClick, styleFn }) {
  const [hover, setHover] = useState(false);
  const s = styleFn(state, hover);
  // Lower-case display + wrap-friendly type so long names ("Remote turret
  // operator") don't blow out the narrow 2-col card width.
  const display = role.toLowerCase().replace(/^./, c => c.toUpperCase());
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'block', width: '100%',
        padding: '6px 10px',
        background: s.background,
        border: s.border,
        borderRadius: 4,
        color: s.color,
        fontFamily: 'var(--font)',
        fontSize: 12, textAlign: 'left',
        fontWeight: 500,
        cursor: 'pointer',
        letterSpacing: '0.01em',
        lineHeight: 1.35,
        wordBreak: 'break-word',
        transition: 'background .12s, border-color .12s, color .12s',
      }}>
      {state.placed ? `✓ ${display}` : display}
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

  // Stable identity — passed to BootSequence, whose animation effect must
  // never restart mid-boot when this wrapper re-renders (e.g. the
  // ship_specs.json fetch resolving and calling setSpecs).
  const handleBootDone = useCallback(() => {
    setFading(true);
    setTimeout(() => { setPhase('form'); setFading(false); }, 200);
  }, []);

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
