import { useState, useEffect } from 'react';

const playClick = () => {
  const file = Math.random() > 0.5 ? '/sounds/click.mp3' : '/sounds/click2.mp3';
  const snd = new Audio(file);
  snd.volume = 0.7;
  snd.play().catch(() => {});
};

const C = {
  open:   '#44FF88',
  taken:  '#FFBB33',
  yours:  '#FF5544',
  dim:    '#2A6A9A',
  border: '#1A3D55',
  gold:   '#99CCFF',
  amber:  '#66AADD',
  bg:     '#0D2030',
  deep:   '#050A0F',
};

function sortRoles(roleNames) {
  const priority = (r) => {
    const l = r.toLowerCase();
    if (l === 'pilot') return 0;
    if (l.includes('co-pilot') || l.includes('co pilot')) return 1;
    if (l.includes('remote turret')) return 2;
    if (l.includes('turret') || l.includes('gunner')) return 3;
    if (l.includes('torpedo')) return 4;
    if (l.includes('engineer')) return 5;
    if (l.includes('hangar') || l.includes('fighter') || l.includes('support')) return 6;
    return 7;
  };
  return [...roleNames].sort((a, b) => priority(a) - priority(b));
}

// Safe zone definitions per crew count
// xStart/xEnd: horizontal bounds (% of container)
// rows: vertical positions to use
const SAFE_ZONES = {
  tiny:    { min: 1,  max: 2,  xStart: 25, xEnd: 55, rows: [50] },
  small:   { min: 3,  max: 4,  xStart: 20, xEnd: 65, rows: [50] },
  medium:  { min: 5,  max: 6,  xStart: 18, xEnd: 72, rows: [50] },
  large:   { min: 7,  max: 10, xStart: 18, xEnd: 76, rows: [38, 62] },
  heavy:   { min: 11, max: 14, xStart: 18, xEnd: 80, rows: [36, 50, 64] },
  capital: { min: 15, max: 99, xStart: 18, xEnd: 82, rows: [33, 50, 67] },
};

function getSafeZone(n) {
  return Object.values(SAFE_ZONES).find(z => n >= z.min && n <= z.max) || SAFE_ZONES.capital;
}

function computeNodePositions(roleNames) {
  const sorted = sortRoles(roleNames);
  const n = sorted.length;
  if (n === 0) return {};
  const zone = getSafeZone(n);
  const positions = {};
  const { xStart, xEnd, rows } = zone;
  const numRows = rows.length;
  const nodesPerRow = Math.ceil(n / numRows);

  sorted.forEach((role, idx) => {
    const rowIdx = Math.floor(idx / nodesPerRow);
    const posInRow = idx % nodesPerRow;
    const thisRowStart = rowIdx * nodesPerRow;
    const thisRowCount = Math.min(nodesPerRow, n - thisRowStart);
    const x = thisRowCount === 1
      ? (xStart + xEnd) / 2
      : xStart + (xEnd - xStart) * (posInRow / (thisRowCount - 1));
    const y = rows[Math.min(rowIdx, rows.length - 1)];
    positions[role] = {
      left: x.toFixed(1) + '%',
      top: y + '%',
    };
  });

  return positions;
}

function toDiscordId(entry) {
  if (entry && typeof entry === 'object') return entry.discord_id ?? '';
  return String(entry ?? '');
}

function modelSlug(ship) {
  const src = ship?.ship_model || ship?.type || '';
  return src.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function findShipThumb(ship, shipThumbs) {
  if (!ship || !shipThumbs) return null;
  const key = modelSlug(ship);
  if (shipThumbs[key]) return shipThumbs[key];
  // fallback: endsWith match for bare type names like 'polaris' → 'rsi_polaris'
  const bare = (ship.type || '').toLowerCase().replace(/\s+/g, '_');
  if (bare) {
    for (const [k, v] of Object.entries(shipThumbs)) {
      if (k.endsWith('_' + bare)) return v;
    }
  }
  return null;
}

// FIX 4 — nexus-node class for border-radius override; FIX 7 — explicit action param
function SlotNode({ posName, pos, roleData, currentUserId, canInteract, onSlotClick, me,
                   isHighlighted, showTooltip, onNodeEnter, onNodeLeave, flash }) {

  if (!roleData) {
    return (
      <div
        className="nexus-node"
        style={{
          position: 'absolute',
          left: pos.left,
          top: pos.top,
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          transform: 'translate(-50%,-50%)',
          border: `2px solid ${C.border}`,
          background: 'rgba(26,61,85,0.15)',
        }}
      />
    );
  }

  const { roleName, slots = 0, filled: filledRaw = [] } = roleData;
  const filled  = (filledRaw || []).map(entry => ({
    discord_id: toDiscordId(entry),
    citizen_name: entry?.citizen_name || null,
  }));
  const isYours = currentUserId ? filled.some(f => f.discord_id === String(currentUserId)) : false;
  const isFull  = filled.length >= slots;

  const state  = isYours ? 'yours' : isFull ? 'taken' : 'open';
  const color  = { open: C.open, taken: C.taken, yours: C.yours }[state];
  const bgRgba = {
    open:  'rgba(0,255,102,0.25)',
    taken: 'rgba(255,170,51,0.25)',
    yours: 'rgba(255,68,85,0.25)',
  }[state];

  const clickable = canInteract && (state === 'open' || state === 'yours');

  // FIX 6 — flash 'yours' nodes when already-assigned error fires
  const animation = (flash && state === 'yours')
    ? 'nodeP 0.25s ease-in-out 3'
    : state === 'open'
      ? 'nodeP 1.5s ease-in-out infinite'
      : 'none';

  return (
    <div
      className="nexus-node"
      style={{
        position: 'absolute',
        left: pos.left,
        top: pos.top,
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        transform: 'translate(-50%,-50%)',
        border: `2px solid ${color}`,
        background: bgRgba,
        animation,
        transition: 'all 0.2s ease',
        cursor: clickable ? 'pointer' : 'default',
        boxShadow: isHighlighted ? '0 0 0 3px #00EEFF44' : 'none',
        zIndex: 5,
      }}
      onMouseEnter={onNodeEnter}
      onMouseLeave={onNodeLeave}
      onClick={() => {
        console.log('[Node Click]', { roleName, clickable, state, currentUserId });
        if (!clickable) return;
        playClick();
        const action = state === 'yours' ? 'withdraw' : 'reserve';
        onSlotClick(roleName, action);
      }}
    >
      {showTooltip && (
        <div style={{
          position: 'absolute',
          background: '#0D2030',
          border: '1px solid #1A3D55',
          color: '#99CCFF',
          fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
          fontSize: 16,
          letterSpacing: '0.08em',
          padding: '5px 12px',
          whiteSpace: 'nowrap',
          zIndex: 20,
          pointerEvents: 'none',
          transform: 'translateX(-50%)',
          bottom: 'calc(100% + 8px)',
          left: '50%',
        }}>
          {roleName}
        </div>
      )}
    </div>
  );
}

export default function ShipSchematic({ ships = [], shipIndex = 0, onShipIndexChange, currentUserId, onSlotClick, missionStatus, me, flashMySlots = false }) {
  const ship        = ships[shipIndex] ?? null;
  const canInteract = missionStatus === 'WAITING FOR CREW' || missionStatus === 'FINALIZED';
  const prevShip    = shipIndex > 0                ? ships[shipIndex - 1] : null;
  const nextShip    = shipIndex < ships.length - 1 ? ships[shipIndex + 1] : null;

  const [shipThumbs,      setShipThumbs]      = useState({});
  const [hoveredNodeRole,  setHoveredNodeRole]  = useState(null);
  const [hoveredSlotIndex, setHoveredSlotIndex] = useState(null);

  // FIX 1 — fetch large ship index for schematic background (ship_index_large.json)
  useEffect(() => {
    fetch('/images/ships/ship_index_large.json')
      .then(r => r.json())
      .then(idx => setShipThumbs(idx))
      .catch(() => {});
  }, []);

  // Use ship_model (manufacturer class) for thumbnail/schematic lookup
  const thumbUrl = ship ? findShipThumb(ship, shipThumbs) : null;

  const roleKeys    = ship ? Object.keys(ship.crew_roles || {}) : [];

  // FIX 9 — compute fill % live from crew_roles, not stale ship.crew_fill_percentage
  const roleEntries = ship ? Object.values(ship.crew_roles || {}) : [];
  const totalSlots  = roleEntries.reduce((s, r) => s + (r.slots || 0), 0);
  const filledSlots = roleEntries.reduce((s, r) => s + (r.filled || []).length, 0);
  const fillPct     = totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;

  // Minimum crew indicator
  const pilotFilled = (ship?.crew_roles?.['Pilot']?.filled?.length ?? 0) > 0;
  const minCrewMet  = pilotFilled && filledSlots >= 2;

  const handleNodeEnter   = (roleName, idx) => { setHoveredNodeRole(roleName); setHoveredSlotIndex(idx); };
  const handleNodeLeave   = ()               => { setHoveredNodeRole(null);    setHoveredSlotIndex(null); };
  const handleRowEnter    = (idx)            => { setHoveredSlotIndex(idx); };
  const handleRowLeave    = ()               => { setHoveredSlotIndex(null); };

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace" }}>

      {/* FIX 3 — nav: 32px name, 16px text, 28px ◀/▶, visibility:hidden for layout stability */}
      {ships.length > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 10,
        }}>
          <div
            onClick={prevShip ? () => { playClick(); onShipIndexChange?.(shipIndex - 1); } : undefined}
            style={{
              fontSize: 16, color: C.dim, cursor: prevShip ? 'pointer' : 'default',
              userSelect: 'none', visibility: prevShip ? 'visible' : 'hidden',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span style={{ fontSize: 28, lineHeight: 1 }}>◀</span>
            {prevShip?.ship_name ?? ''}
          </div>
          <div style={{ fontSize: 32, color: C.gold, fontWeight: 'bold', textAlign: 'center' }}>
            {ship?.ship_name ?? '—'}
          </div>
          <div
            onClick={nextShip ? () => { playClick(); onShipIndexChange?.(shipIndex + 1); } : undefined}
            style={{
              fontSize: 16, color: C.dim, cursor: nextShip ? 'pointer' : 'default',
              userSelect: 'none', visibility: nextShip ? 'visible' : 'hidden',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {nextShip?.ship_name ?? ''}
            <span style={{ fontSize: 28, lineHeight: 1 }}>▶</span>
          </div>
        </div>
      )}

      {/* Schematic container: image owns the height (natural aspect) so the
          node overlay anchors to actual image bounds, not a letterboxed wrapper. */}
      <div style={{
        width: '100%',
        maxWidth: 520,
        margin: '0 auto',
        position: 'relative',
        background: '#000',
        overflow: 'hidden',
        borderBottom: '1px solid #0D2030',
        minHeight: thumbUrl ? 0 : 90,
      }}>
        {/* Layer 1 — ship image with holographic filter only on the img itself */}
        {thumbUrl && (
          <img
            src={thumbUrl}
            alt=""
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              filter: 'invert(1) sepia(1) saturate(3) hue-rotate(175deg) brightness(0.55) contrast(1.2)',
            }}
          />
        )}

        {/* Placeholder when no thumbnail matched */}
        {!thumbUrl && ship && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: C.border, fontSize: 16, letterSpacing: '0.08em',
          }}>[ NO SCHEMATIC ]</div>
        )}

        {/* No ship assigned */}
        {!ship && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: C.border, fontSize: 16, letterSpacing: '0.08em',
          }}>NO SHIP ASSIGNED</div>
        )}

        {/* Layer 2 — nodes container; absolutely positioned over the image bounds. */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
          {(() => {
            const nodePositions = computeNodePositions(roleKeys);
            return roleKeys.map((roleName, roleIndex) => {
              const pos = nodePositions[roleName];
              if (!pos) return null;
              const roleData = ship?.crew_roles?.[roleName]
                ? { roleName, ...ship.crew_roles[roleName] }
                : null;
              return (
                <SlotNode
                  key={roleName}
                  posName={roleName}
                  pos={pos}
                  roleData={roleData}
                  currentUserId={currentUserId}
                  canInteract={canInteract}
                  onSlotClick={(rn, action) => onSlotClick?.(ship._id, rn, action)}
                  me={me}
                  isHighlighted={hoveredSlotIndex !== null && roleIndex === hoveredSlotIndex}
                  showTooltip={hoveredNodeRole === roleName}
                  onNodeEnter={() => handleNodeEnter(roleName, roleIndex)}
                  onNodeLeave={handleNodeLeave}
                  flash={flashMySlots}
                />
              );
            });
          })()}
        </div>

      </div>

      {/* Min crew warning — document flow, below schematic */}
      {ship && !minCrewMet && (
        <div style={{
          fontSize: 12, color: '#FF5544', textAlign: 'center',
          marginTop: 14, letterSpacing: '0.06em',
          fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
        }}>
          MIN. CREW NOT MET — PILOT + 1 REQUIRED
        </div>
      )}

      {/* Legend row — document flow, below warning */}
      {ship && (
        <div style={{
          display: 'flex', justifyContent: 'center', gap: 24, alignItems: 'center',
          marginTop: 14, marginBottom: 20,
          fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
        }}>
          {[
            { color: C.open,  label: 'OPEN' },
            { color: C.taken, label: 'OCCUPIED' },
            { color: C.yours, label: 'YOUR SLOT' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color }}>{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* FIX 9 — crew manifest: fill % computed live; header uses #1A3D55 + #FFBB33 */}
      {ship?.crew_roles && Object.keys(ship.crew_roles).length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 16, letterSpacing: '0.08em', marginBottom: 6 }}>
            <span style={{ color: '#4488BB' }}>CREW MANIFEST — {ship.ship_name ?? ship.type ?? ''}</span>
            <span style={{ marginLeft: 8, color: '#FFBB33' }}>{fillPct}% FILLED</span>
          </div>
          {Object.entries(ship.crew_roles).map(([roleName, roleData], index) => {
            const filledRaw  = roleData.filled || [];
            const filled     = filledRaw.map(entry => ({
              discord_id: toDiscordId(entry),
              citizen_name: entry?.citizen_name || null,
            }));
            const slots      = roleData.slots || 0;
            const isYours    = currentUserId ? filled.some(f => f.discord_id === String(currentUserId)) : false;
            const isFull     = filled.length >= slots;
            const highlighted = hoveredSlotIndex === index;

            return (
              <div
                key={roleName}
                onMouseEnter={() => handleRowEnter(index)}
                onMouseLeave={handleRowLeave}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '4px 6px',
                  fontSize: 16,
                  border: highlighted ? '1px solid #00EEFF' : '1px solid transparent',
                  borderBottom: highlighted ? '1px solid #00EEFF' : '1px solid #080F18',
                  background: highlighted ? 'rgba(0,238,255,0.05)' : 'transparent',
                  transition: 'all 0.1s ease',
                }}
              >
                <span style={{ color: highlighted ? '#CCE8FF' : '#66AADD' }}>{roleName}</span>
                <span style={{ color: highlighted ? '#CCE8FF' : 'inherit' }}>
                  {isYours && (
                    <>
                      <span style={{ color: C.yours }}>{me?.citizen_name || 'YOU'}</span>
                      {canInteract && (
                        <span
                          onClick={() => { playClick(); onSlotClick?.(ship._id, roleName, 'withdraw'); }}
                          style={{ color: '#FF5544', cursor: 'pointer', marginLeft: 8 }}
                        >[ WITHDRAW ]</span>
                      )}
                    </>
                  )}
                  {!isYours && isFull && (
                    <span style={{ fontSize: 13, color: '#99CCFF', fontWeight: 'bold' }}>
                      {filled.map(f => f.citizen_name || 'UNKNOWN').join(', ')}
                    </span>
                  )}
                  {!isYours && !isFull && canInteract && (
                    <span
                      onClick={() => {
                        console.log('[Manifest Reserve]', { shipId: ship._id, roleName, canInteract });
                        playClick();
                        onSlotClick?.(ship._id, roleName, 'reserve');
                      }}
                      style={{ color: C.open, cursor: 'pointer' }}
                    >[ OPEN — CLICK TO RESERVE ]</span>
                  )}
                  {!isYours && !isFull && !canInteract && (
                    <span style={{ color: C.border }}>[ OPEN — CLICK TO RESERVE ]</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
