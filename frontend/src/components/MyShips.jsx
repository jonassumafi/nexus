import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import api from '../services/api';
import ColumnResizeHandle from './ColumnResizeHandle';

const playClick = () => {
  const file = Math.random() > 0.5 ? '/sounds/click.mp3' : '/sounds/click2.mp3';
  const snd = new Audio(file);
  snd.volume = 0.7;
  snd.play().catch(() => {});
};

// Shared style for the four IDENTIFICATION-block right-side buttons.
// HoverBtn and BackLink both spread the caller's style last so these win.
const UNIFORM_BTN_STYLE = {
  display: 'block',
  width: 220,
  textAlign: 'center',
  fontSize: 15,
  padding: '7px 0',
  letterSpacing: '0.1em',
  cursor: 'pointer',
  marginBottom: 6,
};

const ROLE_CATEGORIES = [
  { name: 'COMBAT',     roles: ['PILOT', 'CO-PILOT', 'TURRET OPERATOR', 'REMOTE TURRET OPERATOR', 'GUNNER', 'MARINE', 'BOARDING SPECIALIST'] },
  { name: 'SUPPORT',    roles: ['ENGINEER', 'SUPPORT ENGINEER', 'MEDIC', 'NAVIGATOR'] },
  { name: 'OPERATIONS', roles: ['CARGO MANAGER', 'MINING LASER OPERATOR', 'SALVAGE OPERATOR', 'SCIENCE OFFICER', 'SENSOR OPERATOR'] },
  { name: 'COMMAND',    roles: ['EXECUTIVE OFFICER', 'TACTICAL OFFICER'] },
];

function toTitleCase(s) {
  return s.split(' ').map(w =>
    w.split('-').map(p => (p[0] || '') + p.slice(1).toLowerCase()).join('-')
  ).join(' ');
}

function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function useDots(active) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN(p => (p + 1) % 4), 400);
    return () => clearInterval(id);
  }, [active]);
  return '.'.repeat(n);
}

function StatusChip({ isMission, size = 'sm' }) {
  const onMission = !!isMission;
  return (
    <span style={{
      display: 'inline-block',
      border: `1px solid ${onMission ? '#FFAA33' : '#2A6A9A'}`,
      color: onMission ? '#FFAA33' : '#66AADD',
      fontSize: 13,
      padding: '1px 6px',
      letterSpacing: '0.1em',
      fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
    }}>
      {onMission ? 'ON MISSION' : 'IDLE'}
    </span>
  );
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
        fontSize: 18,
        padding: '6px 14px',
        letterSpacing: '0.1em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

// ─── LEFT — YOUR FLEET ──────────────────────────────────────────────────────

function FleetList({ ships, loading, selectedId, onSelect, specs, onRegisterShip, setLeftWidth, borrowedShips, loanedShipIds, onSelectBorrowed }) {
  const dots = useDots(loading);
  const [registerHover, setRegisterHover] = useState(false);
  const colRef = useRef(null);

  return (
    <div ref={colRef} style={{
      width: '100%',
      position: 'relative',
      borderRight: '1px solid #1A3D55',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    }}>
      {setLeftWidth && (
        <ColumnResizeHandle side="right" columnRef={colRef} setWidth={setLeftWidth} />
      )}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid #1A3D55',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 16, color: '#66AADD', letterSpacing: '0.14em' }}>YOUR FLEET</span>
        <span style={{ fontSize: 16, color: '#66AADD' }}>({ships.length})</span>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {loading ? (
          <div style={{ padding: '20px 14px', fontSize: 16, color: '#66AADD' }}>SCANNING{dots}</div>
        ) : ships.length === 0 ? (
          <div style={{ padding: '20px 14px' }}>
            <div style={{ fontSize: 16, color: '#1A3D55', letterSpacing: '0.1em' }}>
              NO VESSELS REGISTERED
            </div>
            <div style={{ fontSize: 16, color: '#66AADD', marginTop: 6, lineHeight: 1.6 }}>
              Click ⊕ REGISTER SHIP to add your first vessel.
            </div>
          </div>
        ) : (
          ships.map(ship => {
            const selected = selectedId === ship._id;
            const display = specs?.[ship.ship_model]?.display_name || '';
            const onLoan = loanedShipIds?.includes(ship._id.toString());
            return (
              <ShipRow
                key={ship._id}
                ship={ship}
                selected={selected}
                displayName={display}
                onLoan={onLoan}
                onClick={() => { playClick(); onSelect(ship); }}
              />
            );
          })
        )}

        {borrowedShips && borrowedShips.length > 0 && (
          <>
            <div style={{
              padding: '8px 14px', borderTop: '1px solid #1A3D55', borderBottom: '1px solid #0D2030',
              fontSize: 13, color: '#33DDAA', letterSpacing: '0.12em',
            }}>
              BORROWED VESSELS ({borrowedShips.length})
            </div>
            {borrowedShips.map(ship => {
              const selected = selectedId === `borrowed-${ship._id}`;
              return (
                <ShipRow
                  key={`b-${ship._id}`}
                  ship={ship}
                  selected={selected}
                  displayName={specs?.[ship.ship_model]?.display_name || ''}
                  isBorrowed
                  onClick={() => { playClick(); onSelectBorrowed?.(ship); }}
                />
              );
            })}
          </>
        )}
      </div>

      <div style={{
        padding: '10px 14px',
        borderTop: '1px solid #1A3D55',
        flexShrink: 0,
      }}>
        <button
          onClick={() => { playClick(); onRegisterShip(); }}
          onMouseEnter={() => setRegisterHover(true)}
          onMouseLeave={() => setRegisterHover(false)}
          style={{
            width: '100%',
            border: '1px solid #00EEFF',
            color: registerHover ? '#000' : '#00EEFF',
            background: registerHover ? '#00EEFF' : '#000',
            fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
            fontSize: 16,
            padding: 6,
            letterSpacing: '0.12em',
            cursor: 'pointer',
          }}
        >
          ⊕ REGISTER SHIP
        </button>
      </div>
    </div>
  );
}

function ShipRow({ ship, selected, displayName, onClick, onLoan, isBorrowed }) {
  const [hover, setHover] = useState(false);
  const bg = selected ? '#040D15' : (hover ? '#040D15' : '#000');
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '10px 14px',
        borderBottom: '1px solid #0D2030',
        cursor: 'pointer',
        background: bg,
        borderLeft: selected ? '2px solid #66AADD' : '2px solid transparent',
      }}
    >
      <div style={{ fontSize: 17, color: '#99CCFF', letterSpacing: '0.08em' }}>
        {ship.ship_name}
      </div>
      {displayName && (
        <div style={{ fontSize: 16, color: '#66AADD', letterSpacing: '0.04em', marginTop: 2 }}>
          {displayName}
        </div>
      )}
      <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {isBorrowed ? (
          <span style={{
            display: 'inline-block', border: '1px solid #33DDAA', color: '#33DDAA',
            fontSize: 13, padding: '1px 6px', letterSpacing: '0.1em',
            fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
          }}>BORROWED</span>
        ) : (
          <StatusChip isMission={ship.is_mission} />
        )}
        {onLoan && (
          <span style={{
            display: 'inline-block', border: '1px solid #00EEFF', color: '#00EEFF',
            fontSize: 13, padding: '1px 6px', letterSpacing: '0.1em',
            fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
          }}>ON LOAN</span>
        )}
      </div>
      {!isBorrowed && (
        <div style={{ fontSize: 16, color: '#1A3D55', marginTop: 3 }}>
          {ship.missions_completed || 0} MISSIONS COMPLETED
        </div>
      )}
    </div>
  );
}

// ─── CENTER — SHIP DETAIL ───────────────────────────────────────────────────

function ShipDetail({ ship, specs, shipImages, onChanged, onDeleted, onViewLiveMission, onBack, loanInfo, isBorrowed, onLoanAction }) {
  const [stats, setStats] = useState(null);
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleteErr, setDeleteErr] = useState('');
  const [expungeMsg, setExpungeMsg] = useState(false);

  // Editor state lives here so SAVE/CANCEL buttons in the identification block
  // can drive the same nodes the NodeEditor is rendering.
  const [editorNodes, setEditorNodes] = useState([]);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState('');
  const editorNextNodeId = useRef(1);

  useEffect(() => {
    setEditing(false);
    setDeleteOpen(false);
    setDeleteText('');
    setDeleteErr('');
    setStats(null);
    setEditorNodes([]);
    setEditorSaving(false);
    setEditorError('');
    if (!ship?._id) return;
    api.get(`/ships/${ship._id}/stats`).then(({ data }) => setStats(data)).catch(() => setStats(null));
  }, [ship?._id]);

  function enterEdit() {
    const init = (ship.node_positions || []).map((n, i) => ({
      id: i + 1,
      role: (n.role || '').toUpperCase(),
      x: n.x,
      y: n.y,
    }));
    setEditorNodes(init);
    editorNextNodeId.current = init.length + 1;
    setEditorSaving(false);
    setEditorError('');
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditorError('');
  }

  async function saveNodes() {
    setEditorSaving(true);
    setEditorError('');
    try {
      const payload = {
        node_positions: editorNodes.map(n => ({ role: toTitleCase(n.role), x: n.x, y: n.y })),
      };
      await api.put(`/ships/${ship._id}/nodes`, payload);
      // Refetch FIRST so selectedShip is updated with the new node_positions,
      // THEN exit edit mode — guarantees ReadOnlySchematic mounts with the
      // fresh ship and no stale-nodes flicker.
      await onChanged?.();
      setEditing(false);
    } catch (err) {
      setEditorError(err?.response?.data?.error || 'NODE POSITIONS COULD NOT BE WRITTEN. TRY AGAIN.');
    } finally {
      setEditorSaving(false);
    }
  }

  if (expungeMsg) {
    return (
      <div style={{
        flex: 1,
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#FF5544',
        fontSize: 17,
        letterSpacing: '0.1em',
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
        textAlign: 'center',
        padding: 20,
        opacity: 1,
        transition: 'opacity 2s ease',
      }}>
        VESSEL RECORD EXPUNGED FROM NEXUS FLEET INVENTORY
      </div>
    );
  }

  if (!ship) {
    return (
      <div style={{
        flex: 1,
        borderRight: '1px solid #1A3D55',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 16,
        color: '#1A3D55',
        fontSize: 16,
        letterSpacing: '0.1em',
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
      }}>
        SELECT A VESSEL FROM YOUR FLEET
        <BackLink onClick={onBack} style={{ ...UNIFORM_BTN_STYLE }} />
      </div>
    );
  }

  const spec = specs?.[ship.ship_model] || {};
  const displayName = spec.display_name || ship.ship_model || '';
  const ownerName = ship.owner_id?.citizen_name || ship.owner_id?.username || '—';
  const schemImg = shipImages?.[ship.ship_model] || null;

  async function handleDelete() {
    if (deleteText !== 'DELETE') return;
    try {
      await api.delete(`/ships/${ship._id}`);
      setExpungeMsg(true);
      setTimeout(() => {
        setExpungeMsg(false);
        onDeleted?.(ship._id);
      }, 2000);
    } catch (err) {
      setDeleteErr(err?.response?.data?.error || 'DELETE FAILED');
    }
  }

  return (
    <div style={{
      flex: 1,
      borderRight: '1px solid #1A3D55',
      overflowY: 'auto',
      height: '100%',
      fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
    }}>
      {/* IDENTIFICATION */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: '16px 20px',
        borderBottom: '1px solid #0D2030',
        gap: 16,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 25, color: '#CCE8FF', letterSpacing: '0.12em' }}>
            {ship.ship_name}
          </div>
          <div style={{ fontSize: 16, color: '#66AADD', letterSpacing: '0.06em', marginTop: 4 }}>
            {displayName}
          </div>
          <div style={{
            display: 'flex', gap: 20, marginTop: 10,
            fontSize: 16, color: '#66AADD', flexWrap: 'wrap',
          }}>
            <span>TYPE {ship.type ? `· ${ship.type}` : '—'}</span>
            <span>REGISTERED {formatDate(ship.created_at)}</span>
            <span>OWNER {ownerName}</span>
          </div>
          <div style={{ marginTop: 8 }}>
            <StatusChip isMission={ship.is_mission} />
          </div>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 0,
          flexShrink: 0,
          paddingRight: 16,
          paddingLeft: 8,
        }}>
          {!editing ? (
            <>
              {!isBorrowed && (
                <HoverBtn
                  color="#66AADD"
                  onClick={enterEdit}
                  style={UNIFORM_BTN_STYLE}
                >
                  EDIT NODES
                </HoverBtn>
              )}
              {ship.is_mission ? (
                <HoverBtn
                  color="#FFAA33"
                  onClick={() => onViewLiveMission?.(ship.current_mission_id)}
                  style={UNIFORM_BTN_STYLE}
                >
                  VIEW LIVE MISSION
                </HoverBtn>
              ) : (
                <HoverBtn
                  color="#1A3D55"
                  disabled
                  style={UNIFORM_BTN_STYLE}
                >
                  VIEW LIVE MISSION
                </HoverBtn>
              )}
              {isBorrowed && loanInfo?.request_id ? (
                <HoverBtn
                  color="#33DDAA"
                  onClick={() => onLoanAction?.('return', loanInfo)}
                  style={UNIFORM_BTN_STYLE}
                >
                  RETURN SHIP
                </HoverBtn>
              ) : loanInfo?.request_id ? (
                <HoverBtn
                  color="#00EEFF"
                  onClick={() => onLoanAction?.('withdraw', loanInfo)}
                  style={UNIFORM_BTN_STYLE}
                >
                  WITHDRAW ACCESS
                </HoverBtn>
              ) : !isBorrowed && (
                <HoverBtn
                  color="#FF5544"
                  onClick={() => setDeleteOpen(true)}
                  style={UNIFORM_BTN_STYLE}
                >
                  DELETE VESSEL
                </HoverBtn>
              )}
            </>
          ) : (
            <>
              <HoverBtn
                color="#33DDAA"
                onClick={saveNodes}
                disabled={editorSaving}
                style={UNIFORM_BTN_STYLE}
              >
                {editorSaving ? 'SAVING...' : 'SAVE NODES'}
              </HoverBtn>
              <HoverBtn
                color="#2A6A9A"
                onClick={cancelEdit}
                disabled={editorSaving}
                style={UNIFORM_BTN_STYLE}
              >
                CANCEL
              </HoverBtn>
            </>
          )}

          <BackLink onClick={onBack} style={{ ...UNIFORM_BTN_STYLE, marginTop: 12 }} />
        </div>
      </div>

      {/* DELETE CONFIRMATION — inline below identification */}
      {deleteOpen && ship.is_mission && (
        <div style={{
          padding: '12px 20px',
          fontSize: 16, color: '#FF5544', lineHeight: 1.6,
          borderBottom: '1px solid #0D2030',
        }}>
          THIS VESSEL IS CURRENTLY ON AN ACTIVE MISSION AND CANNOT BE DELETED
          UNTIL RELEASED FROM DUTY.
        </div>
      )}
      {deleteOpen && !ship.is_mission && (
        <div style={{
          margin: '12px 20px',
          background: '#0D2030',
          border: '1px solid #FF5544',
          padding: 14,
        }}>
          <div style={{ fontSize: 16, color: '#FF5544', letterSpacing: '0.1em' }}>
            CONFIRM VESSEL DELETION
          </div>
          <div style={{ fontSize: 16, color: '#66AADD', marginTop: 4, lineHeight: 1.5 }}>
            This action is permanent and cannot be undone. Type DELETE below to confirm.
          </div>
          <input
            value={deleteText}
            onChange={(e) => setDeleteText(e.target.value.toUpperCase())}
            placeholder="TYPE DELETE TO CONFIRM"
            style={{
              width: '100%',
              background: '#000',
              border: '1px solid #FF5544',
              color: '#FF5544',
              fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
              fontSize: 17,
              padding: 8,
              marginTop: 10,
              letterSpacing: '0.1em',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {deleteErr && (
            <div style={{ fontSize: 16, color: '#FF5544', marginTop: 6 }}>{deleteErr}</div>
          )}
          <div style={{ marginTop: 10 }}>
            <HoverBtn
              color="#FF5544"
              onClick={handleDelete}
              disabled={deleteText !== 'DELETE'}
            >
              CONFIRM DELETE
            </HoverBtn>
          </div>
        </div>
      )}

      {/* SAVE-FAILED BANNER */}
      {editorError && (
        <div style={{
          width: '100%',
          background: 'rgba(255,85,68,0.08)',
          borderTop: '1px solid #FF5544',
          borderBottom: '1px solid #FF5544',
          padding: '8px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          boxSizing: 'border-box',
        }}>
          <span style={{ color: '#FF5544', fontSize: 16, flexShrink: 0 }}>✕</span>
          <span style={{
            color: '#FF5544',
            fontSize: 16,
            letterSpacing: '0.08em',
            fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
          }}>
            SAVE FAILED — {editorError}
          </span>
        </div>
      )}

      {/* SCHEMATIC */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #0D2030' }}>
        {editing ? (
          <NodeEditor
            ship={ship}
            schemImg={schemImg}
            nodes={editorNodes}
            setNodes={setEditorNodes}
            nextNodeIdRef={editorNextNodeId}
          />
        ) : (
          <ReadOnlySchematic ship={ship} schemImg={schemImg} />
        )}
      </div>

      {/* HISTORY / LORE */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #0D2030' }}>
        <div style={{ fontSize: 16, color: '#66AADD', letterSpacing: '0.14em', marginBottom: 8 }}>
          SHIP HISTORY
        </div>
        {ship.description ? (
          <div style={{ fontSize: 16, color: '#99CCFF', lineHeight: 1.9, letterSpacing: '0.04em' }}>
            {ship.description}
          </div>
        ) : (
          <div style={{ fontSize: 16, color: '#1A3D55', letterSpacing: '0.04em' }}>
            NO HISTORY RECORDED
          </div>
        )}
      </div>

      {/* STATS */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #0D2030' }}>
        <div style={{ fontSize: 16, color: '#66AADD', letterSpacing: '0.14em', marginBottom: 10 }}>
          VESSEL PERFORMANCE
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <Stat label="MISSIONS COMPLETED" value={ship.missions_completed ?? 0} color="#99CCFF" />
          <Stat
            label="AVG FILL RATE"
            value={stats?.missions_analyzed > 0 ? `${stats.avg_fill_rate}%` : '--'}
            color="#99CCFF"
          />
          <Stat
            label="LIFETIME RP"
            value={stats ? stats.lifetime_rp : 0}
            color="#33DDAA"
          />
        </div>
      </div>

    </div>
  );
}

function BackLink({ onClick, style = {} }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={() => { playClick(); onClick?.(); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        border: '1px solid #FFBB33',
        color: hover ? '#000' : '#FFBB33',
        background: hover ? '#FFBB33' : '#000',
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      ◀ BACK TO DASHBOARD
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 16, color: '#66AADD', letterSpacing: '0.1em' }}>{label}</div>
      <div style={{ fontSize: 25, color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

// ─── Read-only schematic with node overlay ──────────────────────────────────

function ReadOnlySchematic({ ship, schemImg }) {
  const [hoveredId, setHoveredId] = useState(null);
  const nodes = ship.node_positions || [];

  if (!schemImg) {
    return (
      <div style={{
        padding: 40,
        textAlign: 'center',
        color: '#1A3D55',
        fontSize: 16,
        border: '1px solid #1A3D55',
        letterSpacing: '0.1em',
      }}>
        [ NO SCHEMATIC IMAGE ]
      </div>
    );
  }

  return (
    <>
      <div style={{
        position: 'relative', width: '100%', maxWidth: 520, margin: '0 auto',
        padding: 8, background: '#040D15', boxSizing: 'border-box',
      }}>
        <img
          src={schemImg}
          alt=""
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            objectFit: 'contain',
            filter: 'invert(1) sepia(1) saturate(4) hue-rotate(170deg) brightness(0.5) contrast(1.3)',
          }}
        />
        <div style={{
          position: 'absolute', top: 8, left: 8, right: 8, bottom: 8,
          pointerEvents: 'none',
        }}>
          {nodes.map((n, i) => (
            <div
              key={i}
              className="nexus-node"
              onMouseEnter={() => setHoveredId(i)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                position: 'absolute',
                left: `${n.x}%`, top: `${n.y}%`,
                width: 48, height: 48,
                border: '2px solid #00FF66',
                background: 'rgba(0,255,102,0.2)',
                transform: 'translate(-50%, -50%)',
                animation: 'nodePulse 1.8s ease-in-out infinite',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#00FF66',
                fontSize: 20,
                fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
                pointerEvents: 'auto',
                userSelect: 'none',
              }}
            >
              {hoveredId === i && (
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
                  letterSpacing: '0.08em',
                  zIndex: 10,
                }}>
                  {n.role}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {nodes.length === 0 && (
        <div style={{ marginTop: 8, fontSize: 16, color: '#1A3D55', letterSpacing: '0.06em' }}>
          NO CREW CONFIGURATION — EDIT TO ADD NODES
        </div>
      )}
    </>
  );
}

// ─── Inline node editor (mirrors ShipRegistration's placement UX) ───────────

// `nodes`, `setNodes`, `nextNodeIdRef`, and `error` are owned by ShipDetail so the
// SAVE/CANCEL buttons in the identification block can drive the same state.
function NodeEditor({ ship, schemImg, nodes, setNodes, nextNodeIdRef }) {
  const [activeRole, setActiveRole] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);

  const schematicRef = useRef(null);
  const dragState = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const isInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (e.key === 'Delete' && selectedNodeId !== null) {
        if (isInput) return;
        e.preventDefault();
        setNodes(prev => prev.filter(n => n.id !== selectedNodeId));
        setSelectedNodeId(null);
      } else if (e.key === 'Escape') {
        if (isInput) return;
        setActiveRole(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId]);

  function placeNode(e) {
    // Right-click places a node — suppress the browser's own context menu.
    e.preventDefault();
    if (!activeRole) return;
    if (!schematicRef.current) return;
    const rect = schematicRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    const id = nextNodeIdRef.current++;
    setNodes(prev => [...prev, { id, role: activeRole, x: +x.toFixed(1), y: +y.toFixed(1) }]);
  }

  function onNodeMouseDown(e, node) {
    e.stopPropagation();
    if (e.button === 2) return;
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
        const cx = Math.max(0, Math.min(100, x));
        const cy = Math.max(0, Math.min(100, y));
        setNodes(prev => prev.map(n => n.id === ds.nodeId
          ? { ...n, x: +cx.toFixed(1), y: +cy.toFixed(1) }
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

  function nodeLabel(node) {
    const sameRole = nodes.filter(n => n.role === node.role);
    return String(sameRole.findIndex(n => n.id === node.id) + 1);
  }

  function roleState(role) {
    return {
      active: activeRole === role,
      placed: nodes.some(n => n.role === role),
    };
  }

  function roleBtnStyle(state, hover) {
    if (state.active) return { border: '1px solid #00EEFF', color: '#00EEFF', background: 'rgba(0,238,255,0.05)' };
    if (state.placed) return { border: '1px solid #00FF66', color: '#00FF66', background: '#000' };
    if (hover)        return { border: '1px solid #2A6A9A', color: '#99CCFF', background: '#000' };
    return                   { border: '1px solid #1A3D55', color: '#66AADD', background: '#000' };
  }

  return (
    <>
      {/* Instructions panel — matches ShipRegistration exactly so operators
          who registered a ship recognize the same UX when editing later. */}
      <div style={{
        background: '#0D2030', border: '1px solid #1A3D55',
        padding: '10px 14px', fontSize: 16, color: '#66AADD',
        lineHeight: 1.8, letterSpacing: '0.06em',
        marginBottom: 12,
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
      <div
        ref={schematicRef}
        onContextMenu={placeNode}
        onClick={() => setSelectedNodeId(null)}
        style={{
          position: 'relative', width: '100%', maxWidth: 520, margin: '0 auto',
          cursor: activeRole ? 'crosshair' : 'default',
        }}
      >
        {schemImg ? (
          <img
            src={schemImg}
            alt=""
            style={{
              width: '100%', height: 'auto', display: 'block',
              pointerEvents: 'none',
              filter: 'invert(1) sepia(1) saturate(4) hue-rotate(170deg) brightness(0.5) contrast(1.3)',
            }}
          />
        ) : (
          <div style={{ padding: 60, textAlign: 'center', color: '#1A3D55', fontSize: 16 }}>
            [ NO SCHEMATIC IMAGE ]
          </div>
        )}
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          pointerEvents: 'none',
        }}>
          {nodes.map(n => {
            const isSelected = selectedNodeId === n.id;
            return (
              <div
                key={n.id}
                className="nexus-node"
                onMouseDown={e => onNodeMouseDown(e, n)}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedNodeId(prev => prev === n.id ? null : n.id);
                }}
                onContextMenu={e => onNodeContextMenu(e, n)}
                onMouseEnter={() => setHoveredId(n.id)}
                onMouseLeave={() => setHoveredId(null)}
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
                  fontSize: 20,
                  fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
                  pointerEvents: 'auto',
                  userSelect: 'none',
                  zIndex: 5,
                }}
              >
                {nodeLabel(n)}
                {hoveredId === n.id && (
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
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{
          fontSize: 16, color: '#66AADD', letterSpacing: '0.14em', marginBottom: 8,
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
              <PaletteBtn
                key={role}
                role={role}
                state={roleState(role)}
                styleFn={roleBtnStyle}
                onClick={() => { playClick(); setActiveRole(prev => prev === role ? null : role); }}
              />
            ))}
          </div>
        ))}
      </div>

    </>
  );
}

function PaletteBtn({ role, state, styleFn, onClick }) {
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
      }}
    >
      {state.placed ? `✓ ${role}` : `[ ${role} ]`}
    </button>
  );
}

// ─── RIGHT — MISSION HISTORY ────────────────────────────────────────────────

function MissionHistory({ ship, setRightWidth }) {
  const colRef = useRef(null);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const dots = useDots(loading);

  useEffect(() => {
    if (!ship?._id) { setRows(null); return; }
    setLoading(true);
    api.get(`/ships/${ship._id}/missions`)
      .then(({ data }) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [ship?._id]);

  return (
    <div ref={colRef} style={{
      width: '100%',
      position: 'relative',
      overflowY: 'auto',
      height: '100%',
      fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
    }}>
      {setRightWidth && (
        <ColumnResizeHandle side="left" columnRef={colRef} setWidth={setRightWidth} />
      )}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid #1A3D55',
        fontSize: 16, color: '#66AADD',
        letterSpacing: '0.14em',
      }}>
        MISSION HISTORY
      </div>

      {!ship ? (
        <div style={{ padding: 14, fontSize: 16, color: '#1A3D55' }}>
          SELECT A VESSEL TO VIEW HISTORY
        </div>
      ) : loading ? (
        <div style={{ padding: 14, fontSize: 16, color: '#66AADD' }}>SCANNING{dots}</div>
      ) : !rows || rows.length === 0 ? (
        <div style={{ padding: 14, fontSize: 16, color: '#1A3D55' }}>
          NO MISSION RECORDS
        </div>
      ) : (
        rows.map(r => <HistoryRow key={r._id} row={r} />)
      )}
    </div>
  );
}

function HistoryRow({ row }) {
  const [hover, setHover] = useState(false);
  const isAbort = row.status === 'ABORT';
  return (
    <div
      onClick={() => { playClick(); console.log('open mission detail', row._id); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '10px 14px',
        borderBottom: '1px solid #0D2030',
        cursor: 'pointer',
        background: hover ? '#040D15' : '#000',
      }}
    >
      <span style={{
        display: 'inline-block',
        border: `1px solid ${isAbort ? '#FF5544' : '#33DDAA'}`,
        color: isAbort ? '#FF5544' : '#33DDAA',
        fontSize: 16,
        padding: '1px 5px',
        letterSpacing: '0.1em',
      }}>
        {row.status}
      </span>
      <div style={{
        fontSize: 16, color: '#99CCFF',
        marginTop: 4, letterSpacing: '0.06em',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {row.name}
      </div>
      <div style={{ fontSize: 16, color: '#66AADD', marginTop: 2 }}>{row.mission_type}</div>
      <div style={{ fontSize: 16, color: '#66AADD', marginTop: 2 }}>{formatDate(row.completed_at)}</div>
      <div style={{ fontSize: 16, color: '#1A3D55', marginTop: 2 }}>[{row.role}]</div>
    </div>
  );
}

// ─── Top-level panel ────────────────────────────────────────────────────────

export default function MyShips({
  selectedShip,
  setSelectedShip,
  onBack,
  onRegisterShip,
  onViewLiveMission,
  leftWidth = 220,
  setLeftWidth,
  rightWidth = 200,
  setRightWidth,
}) {
  const [ships, setShips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [specs, setSpecs] = useState({});
  const [shipImages, setShipImages] = useState({});
  const [borrowedShips, setBorrowedShips] = useState([]);
  // { as_owner_approved: [{ request_id, ship_id, requester_name, loan_expires_at }] }
  const [accessStatus, setAccessStatus] = useState({ as_owner_approved: [] });
  // Which view: 'owned' | 'borrowed' — for driving ShipDetail display
  const [selectedBorrowed, setSelectedBorrowed] = useState(null);

  const fetchShips = useCallback(async () => {
    try {
      const { data } = await api.get('/ships/mine');
      const list = Array.isArray(data) ? data : [];
      setShips(list);
      setSelectedShip(curr => {
        if (!curr) return curr;
        return list.find(s => s._id === curr._id) || null;
      });
    } catch {
      setShips([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAccessStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/ships/access-requests/mine');
      setAccessStatus(data || { as_owner_approved: [] });
    } catch {}
  }, []);

  const fetchBorrowed = useCallback(async () => {
    try {
      const { data } = await api.get('/ships/borrowed');
      setBorrowedShips(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchShips();
    fetchAccessStatus();
    fetchBorrowed();
    fetch('/images/ships/ship_specs.json')
      .then(r => r.json()).then(setSpecs).catch(() => setSpecs({}));
    fetch('/images/ships/ship_index_large.json')
      .then(r => r.json()).then(setShipImages).catch(() => setShipImages({}));
  }, [fetchShips, fetchAccessStatus, fetchBorrowed]);

  const handleDeleted = (deletedId) => {
    setShips(prev => prev.filter(s => s._id !== deletedId));
    setSelectedShip(null);
  };

  // ship_ids of owned ships that have active loans
  const loanedShipIds = (accessStatus.as_owner_approved || []).map(l => l.ship_id?.toString());

  // Given an owned ship, find the loan info (if any)
  const loanInfoForShip = (ship) => {
    if (!ship) return null;
    return (accessStatus.as_owner_approved || []).find(
      l => l.ship_id?.toString() === ship._id?.toString()
    ) || null;
  };

  // For a borrowed ship, its entry carries request_id
  const loanInfoForBorrowed = (ship) => {
    if (!ship) return null;
    return borrowedShips.find(b => b._id?.toString() === ship._id?.toString()) || null;
  };

  // The ship shown in the center panel: either a selected owned ship or a borrowed ship
  const displayShip = selectedBorrowed || selectedShip;
  const isBorrowed = !!selectedBorrowed;
  const loanInfo = isBorrowed
    ? loanInfoForBorrowed(selectedBorrowed)
    : loanInfoForShip(selectedShip);

  async function handleLoanAction(action, info) {
    try {
      if (action === 'return') {
        await api.post(`/ships/${info._id || info.ship_id}/return-ship`, { request_id: info.request_id });
        setSelectedBorrowed(null);
        fetchBorrowed();
        fetchAccessStatus();
      } else if (action === 'withdraw') {
        await api.post(`/ships/${info.ship_id || selectedShip._id}/withdraw-access`, { request_id: info.request_id });
        fetchAccessStatus();
      }
    } catch {}
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `${leftWidth}px 1fr ${rightWidth}px`,
      height: '100%',
      background: '#000',
      minHeight: 0,
    }}>
      <FleetList
        ships={ships}
        loading={loading}
        selectedId={selectedBorrowed ? `borrowed-${selectedBorrowed._id}` : selectedShip?._id}
        onSelect={(ship) => { setSelectedBorrowed(null); setSelectedShip(ship); }}
        specs={specs}
        onRegisterShip={onRegisterShip}
        setLeftWidth={setLeftWidth}
        borrowedShips={borrowedShips}
        loanedShipIds={loanedShipIds}
        onSelectBorrowed={(ship) => { setSelectedShip(null); setSelectedBorrowed(ship); }}
      />
      <ShipDetail
        ship={displayShip}
        specs={specs}
        shipImages={shipImages}
        onChanged={fetchShips}
        onDeleted={handleDeleted}
        onViewLiveMission={onViewLiveMission}
        onBack={onBack}
        loanInfo={loanInfo}
        isBorrowed={isBorrowed}
        onLoanAction={handleLoanAction}
      />
      <MissionHistory ship={displayShip} setRightWidth={setRightWidth} />
    </div>
  );
}
