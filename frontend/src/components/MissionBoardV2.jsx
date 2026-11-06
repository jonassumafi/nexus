import { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } from 'react';

// Mission Board v2 — sticky collapsible status groups of hero-ship cards.
// Visual spec: /mission_board_spec.html. Colors resolved from global.css
// custom properties so active skin recolors the board automatically.

const STYLE_ID = 'mb-v2-styles';
const CSS = `
.mb-list{display:flex;flex-direction:column;background:var(--bg1)}
.mb-group{display:flex;flex-direction:column;position:relative}
.mb-group-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;
  padding:6px 12px;width:100%;text-align:left;background:var(--inset);
  border-bottom:1px solid var(--rim0);
  font:700 10px Inter,system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;
  color:var(--fg2);cursor:pointer}
.mb-group-head:focus-visible{outline:2px solid var(--cyan);outline-offset:-2px}
.mb-group-head .mb-dot{width:7px;height:7px;border-radius:50%;background:var(--mb-c)}
.mb-group-head .mb-n{margin-left:auto;letter-spacing:.04em;color:var(--fg3)}
.mb-group-head .mb-cv{width:10px;height:10px;transition:transform .28s cubic-bezier(.2,.8,.2,1);color:var(--fg3)}
.mb-group.mb-shut .mb-group-head .mb-cv{transform:rotate(-90deg)}
.mb-group-body{display:grid;grid-template-rows:1fr;transition:grid-template-rows .28s cubic-bezier(.2,.8,.2,1)}
.mb-group-body>div{overflow:hidden}
.mb-group.mb-shut .mb-group-body{grid-template-rows:0fr}

.mb-card{position:relative;display:grid;grid-template-columns:72px minmax(0,1fr);gap:3px 12px;
  padding:10px 12px 10px 15px;border-bottom:1px solid var(--rim0);cursor:pointer;
  transition:background .16s}
.mb-card:hover{background:var(--bg2)}
.mb-card.mb-sel{background:color-mix(in srgb,var(--cyan) 8%,var(--bg2))}
.mb-card:focus-visible{outline:2px solid var(--cyan);outline-offset:-2px}
.mb-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--mb-c)}

.mb-hero{position:relative;width:68px;height:44px;background:var(--inset);
  border:1px solid var(--blue);box-shadow:0 0 0 1px color-mix(in srgb,var(--blue) 35%,transparent);
  align-self:start;display:grid;place-items:center;overflow:visible}
.mb-hero img{filter:grayscale(1) brightness(1.35) contrast(1.05);width:100%;height:100%;object-fit:contain;display:block}
.mb-hero .mb-noimg{font:700 11px Inter,system-ui,sans-serif;color:var(--fg3);letter-spacing:.08em}
.mb-hero i{position:absolute;left:0;bottom:-4px;height:3px;background:var(--mb-fill);width:var(--mb-w,0%);
  transition:width .28s ease,background-color .28s ease}
.mb-hc{display:flex;flex-direction:column;align-items:center;gap:5px;align-self:start}
.mb-plab{font:700 10px Inter,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;
  color:var(--blue);margin-top:9px}

.mb-rt{display:flex;flex-direction:column;gap:5px;min-width:0}
.mb-r1{display:flex;align-items:center;gap:8px}
.mb-r1 .mb-ttl{flex:1;font:600 13px/1.3 Inter,system-ui,sans-serif;color:var(--fg1);
  text-transform:uppercase;letter-spacing:.02em;min-width:0;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.mb-ty{font:700 10px Inter,system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;
  padding:1px 6px;border:1px solid color-mix(in srgb,var(--blue) 55%,transparent);color:var(--blue);
  white-space:nowrap}

.mb-r2{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.mb-r2 .mb-meta{color:var(--fg3);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mb-r2 .mb-meta b{color:var(--fg1);font-weight:600}
.mb-r2 .mb-pc{flex:none;font:700 12px Inter,system-ui,sans-serif;color:var(--fg1);font-variant-numeric:tabular-nums;
  transition:color .28s ease}

.mb-r3{display:flex;align-items:center;gap:8px;padding-bottom:3px;min-height:25px;min-width:0}
.mb-r3 .mb-ships{display:flex;align-items:flex-start;gap:6px;min-width:0;flex:1;overflow:hidden}
.mb-r3 .mb-solo{color:var(--fg3);font-size:11px}
.mb-r3 .mb-crew{flex:none;color:var(--fg3);font:500 10px Inter,system-ui,sans-serif;
  letter-spacing:.04em;font-variant-numeric:tabular-nums}
.mb-r3 .mb-crew b{color:var(--fg1);font-weight:600}

.mb-sh{position:relative;flex:none;width:30px;height:20px;background:var(--inset);
  border:1px solid var(--rim0);display:grid;place-items:center;overflow:visible}
.mb-sh img{filter:grayscale(1) brightness(1.35) contrast(1.05);width:100%;height:100%;object-fit:contain;display:block}
.mb-sh .mb-noimg{font:700 8px Inter,system-ui,sans-serif;color:var(--fg3)}
.mb-sh i{position:absolute;left:0;bottom:-3px;height:2px;background:var(--mb-fill);width:var(--mb-w,0%);
  transition:width .28s ease,background-color .28s ease}
.mb-more{flex:none;height:20px;min-width:28px;padding:0 6px;display:grid;place-items:center;
  border:1px dashed var(--rim1);color:var(--fg3);font:700 10px Inter,system-ui,sans-serif}

.mb-fillc{--mb-fill:var(--red)}
.mb-fillm{--mb-fill:var(--amber)}
.mb-fillh{--mb-fill:var(--lime)}

@keyframes mb-new-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
@keyframes mb-new-wash{0%{box-shadow:inset 3px 0 0 var(--mb-c),inset 0 0 0 9999px color-mix(in srgb,var(--lime) 18%,transparent)}100%{box-shadow:inset 0 0 0 0 transparent}}
.mb-new{animation:mb-new-in .28s cubic-bezier(.2,.8,.2,1),mb-new-wash .7s ease-out}
@keyframes mb-leave{to{opacity:0;transform:translateX(12px)}}
.mb-moving{animation:mb-leave .24s ease-in forwards;pointer-events:none}

@media (prefers-reduced-motion:reduce){
  *[class^="mb-"],*[class*=" mb-"]{animation-duration:.001ms!important;transition-duration:.001ms!important}
}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

function stripMissionPrefix(name = '') {
  const idx = name.indexOf(':');
  return idx >= 0 ? name.slice(idx + 1).trim() : name;
}

function findShipThumb(ship, shipThumbs) {
  if (!ship || !shipThumbs) return null;
  const src = ship.ship_model || ship.type || '';
  const key = src.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (shipThumbs[key]) return shipThumbs[key];
  const bare = (ship.type || '').toLowerCase().replace(/\s+/g, '_');
  if (bare) {
    for (const [k, v] of Object.entries(shipThumbs)) {
      if (k.endsWith('_' + bare)) return v;
    }
  }
  return null;
}

// Sum crew slots on a ship — supports either the plain crew_roles form
// (`{slots, filled:[]}`) or the structured map form.
function shipSlotCounts(ship) {
  let total = 0, filled = 0;
  if (!ship) return { total, filled };
  const roles = ship.crew_roles ?? ship.crew_roles_structured;
  if (!roles) return { total, filled };
  const iter = roles instanceof Map ? Array.from(roles.values()) : Object.values(roles);
  for (const r of iter) {
    if (!r) continue;
    total += r.slots ?? r.capacity ?? 0;
    filled += Array.isArray(r.filled) ? r.filled.length : 0;
  }
  return { total, filled };
}

function fillBucketClass(pct) {
  if (pct < 34) return 'mb-fillc';
  if (pct < 67) return 'mb-fillm';
  return 'mb-fillh';
}

// Map a mission.status string to one of waiting/active/completed. Any
// unknown status falls into waiting per the spec default.
function statusKey(s) {
  switch (s) {
    case 'IN PROGRESS': return 'active';
    case 'COMPLETE':
    case 'ABORT':
    case 'ABORTED':
    case 'EXPIRED':
      return 'completed';
    case 'WAITING FOR CREW':
    case 'FINALIZED':
    default:
      return 'waiting';
  }
}

const GROUP_DEFS = [
  { key: 'waiting',   label: 'Waiting',   color: 'var(--amber)' },
  { key: 'active',    label: 'Active',    color: 'var(--lime)'  },
  { key: 'completed', label: 'Completed', color: 'var(--fg3)'   },
];

function relativeTime(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const delta = Math.max(0, Date.now() - t);
  const sec = Math.floor(delta / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 12) return `${hr} h ago`;
  // after ~12h show weekday + date
  const d = new Date(t);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return `${hr} h ago`;
  if (sameDay(d, yesterday)) return 'yesterday';
  try {
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function useRelativeTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);
}

function ShipThumb({ ship, shipThumbs, isHero, fillPct, fillBucket }) {
  const url = findShipThumb(ship, shipThumbs);
  const label = ship?.ship_name
    ? `${ship.ship_model || ship.type || 'Ship'}, ${ship.ship_name}`
    : (ship?.ship_model || ship?.type || 'Ship');
  const { total, filled } = shipSlotCounts(ship);
  const crewText = total > 0 ? `, ${filled} of ${total} crew` : '';
  const title = `${label}${crewText}`;
  const cls = `${isHero ? 'mb-hero' : 'mb-sh'} ${fillBucket}`;
  const style = { '--mb-w': total > 0 ? `${fillPct}%` : '0%' };
  const bare = (ship?.ship_model || ship?.type || '???').slice(0, 3).toUpperCase();
  return (
    <div className={cls} style={style} title={title} aria-label={title}>
      {url ? <img src={url} alt="" /> : <span className="mb-noimg">{bare}</span>}
      {total > 0 && <i />}
    </div>
  );
}

// Secondary ship strip that hides overflow thumbnails behind a +N chip.
// Uses ResizeObserver to recompute when the card width changes.
function ShipStrip({ ships, shipThumbs }) {
  const containerRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(ships.length);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const width = el.clientWidth;
    // Thumbs are 30 wide, +N chip ~28 wide, gap 6
    const thumbW = 30, chipW = 32, gap = 6;
    // How many fit if we need to leave room for a chip (for all cases except full fit)?
    const fullFit = Math.floor((width + gap) / (thumbW + gap));
    if (fullFit >= ships.length) {
      setVisibleCount(ships.length);
      return;
    }
    // Need chip, so subtract chip space
    const withChip = Math.max(0, Math.floor((width - chipW) / (thumbW + gap)));
    setVisibleCount(Math.min(ships.length, withChip));
  }, [ships.length]);

  useLayoutEffect(() => { measure(); }, [measure]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const shown = ships.slice(0, visibleCount);
  const hidden = ships.length - visibleCount;

  return (
    <div className="mb-ships" ref={containerRef}>
      {shown.map((s, i) => {
        const { total, filled } = shipSlotCounts(s);
        const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
        return (
          <ShipThumb
            key={s?._id ?? i}
            ship={s}
            shipThumbs={shipThumbs}
            isHero={false}
            fillPct={pct}
            fillBucket={fillBucketClass(pct)}
          />
        );
      })}
      {hidden > 0 && <div className="mb-more" title={`${hidden} more`}>+{hidden}</div>}
    </div>
  );
}

function MissionCardV2({ mission, selected, onSelect, missionTypes, shipThumbs, animClass }) {
  const ships = [mission.primary_ship, ...(mission.supporting_ships ?? [])].filter(Boolean);
  const primary = ships[0];
  const secondary = ships.slice(1);

  const pCounts = shipSlotCounts(primary);
  const hasSlots = pCounts.total > 0;
  const pct = hasSlots ? Math.round((pCounts.filled / pCounts.total) * 100) : 0;
  const bucket = fillBucketClass(pct);

  const typeInfo = missionTypes?.[mission.mission_type] ?? {};
  const typeLabel = typeInfo.short_name || typeInfo.name || mission.mission_type || '';
  const title = stripMissionPrefix(mission.name) || mission.name || 'UNTITLED';
  const shipName = primary?.ship_name || primary?.ship_model || primary?.type || '—';

  const posted = mission.created_at ? relativeTime(mission.created_at) : '';

  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(mission._id);
    }
  };

  return (
    <div
      className={`mb-card ${selected ? 'mb-sel' : ''} ${animClass || ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(mission._id)}
      onKeyDown={handleKey}
      aria-label={title}
    >
      <div className="mb-hc">
        <ShipThumb
          ship={primary}
          shipThumbs={shipThumbs}
          isHero={true}
          fillPct={pct}
          fillBucket={bucket}
        />
        <span className="mb-plab">Primary</span>
      </div>
      <div className="mb-rt">
        <div className="mb-r1">
          <span className="mb-ttl" title={title}>{title}</span>
          {typeLabel && <span className="mb-ty">{typeLabel}</span>}
        </div>
        <div className="mb-r2">
          <span className="mb-meta">
            <b>{shipName}</b>{posted ? ` · ${posted}` : ''}
          </span>
          <span className={`mb-pc ${bucket}`} style={{ color: hasSlots ? undefined : 'var(--fg3)' }}>
            {hasSlots ? `${pct}%` : '—'}
          </span>
        </div>
        <div className="mb-r3">
          {secondary.length > 0 ? (
            <ShipStrip ships={secondary} shipThumbs={shipThumbs} />
          ) : (
            <span className="mb-solo">Solo</span>
          )}
          <span className="mb-crew">
            {hasSlots ? <><b>{pCounts.filled}</b>/{pCounts.total}</> : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

const GROUP_STATE_KEY = 'nexus_mb_groups';

function loadGroupState() {
  try {
    const raw = localStorage.getItem(GROUP_STATE_KEY);
    if (!raw) return { waiting: false, active: false, completed: true };
    const parsed = JSON.parse(raw);
    return {
      waiting: !!parsed.waiting,
      active: !!parsed.active,
      completed: parsed.completed !== false,
    };
  } catch {
    return { waiting: false, active: false, completed: true };
  }
}

export default function MissionBoardV2({ missions, selectedMissionId, onSelect, missionTypes = {}, shipThumbs = {}, onNewMission }) {
  useEffect(() => { injectStyles(); }, []);
  useRelativeTick();

  const [shut, setShut] = useState(loadGroupState);
  useEffect(() => {
    try { localStorage.setItem(GROUP_STATE_KEY, JSON.stringify(shut)); } catch {}
  }, [shut]);

  // Grouping
  const groups = useMemo(() => {
    const out = { waiting: [], active: [], completed: [] };
    for (const m of missions) out[statusKey(m.status)].push(m);
    return out;
  }, [missions]);

  // Transient animation tracking.
  //  - New cards flash in the group they arrived to (mb-new).
  //  - Cards whose status changed render twice for 240 ms: a ghost in the
  //    old group with .mb-moving (fade + slide 12 px right), plus the real
  //    card in the new group with .mb-new (entry flash).
  const prevMapRef = useRef(new Map()); // id -> { status, mission }
  const [animMap, setAnimMap]   = useState({}); // id -> 'mb-new'
  const [leaving, setLeaving]   = useState({}); // id -> { oldGroup, mission }

  useEffect(() => {
    const prev = prevMapRef.current;
    const next = new Map();
    const additions = [];
    const movers = [];     // id -> { oldStatus, oldMission, newMission }
    for (const m of missions) {
      next.set(m._id, { status: m.status, mission: m });
      const was = prev.get(m._id);
      if (!was) {
        additions.push(m._id);
      } else if (statusKey(was.status) !== statusKey(m.status)) {
        movers.push({ id: m._id, oldMission: was.mission });
      }
    }
    prevMapRef.current = next;
    if (!additions.length && !movers.length) return;

    setAnimMap(curr => {
      const upd = { ...curr };
      for (const id of additions) upd[id] = 'mb-new';
      for (const mv of movers)    upd[mv.id] = 'mb-new';
      return upd;
    });
    if (movers.length) {
      setLeaving(curr => {
        const upd = { ...curr };
        for (const mv of movers) {
          upd[mv.id] = {
            oldGroup: statusKey(mv.oldMission?.status),
            mission:  mv.oldMission,
          };
        }
        return upd;
      });
    }

    const timers = [];
    // Clear the "new" flash after its full duration (0.28 s enter + 0.7 s wash).
    for (const id of [...additions, ...movers.map(m => m.id)]) {
      timers.push(setTimeout(() => {
        setAnimMap(curr => {
          if (!curr[id]) return curr;
          const upd = { ...curr };
          delete upd[id];
          return upd;
        });
      }, 750));
    }
    // Clear the ghost after its leave animation (240 ms + a tiny buffer).
    for (const mv of movers) {
      timers.push(setTimeout(() => {
        setLeaving(curr => {
          if (!curr[mv.id]) return curr;
          const upd = { ...curr };
          delete upd[mv.id];
          return upd;
        });
      }, 280));
    }
    return () => { timers.forEach(clearTimeout); };
  }, [missions]);

  const toggle = (key) => setShut(s => ({ ...s, [key]: !s[key] }));

  // Build the per-group list of ghost cards (cards animating out of this
  // group because their status just changed).
  const ghostsByGroup = useMemo(() => {
    const out = { waiting: [], active: [], completed: [] };
    for (const entry of Object.values(leaving)) {
      if (entry?.oldGroup && out[entry.oldGroup]) {
        out[entry.oldGroup].push(entry.mission);
      }
    }
    return out;
  }, [leaving]);

  return (
    <div className="mb-list">
      {onNewMission && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px', borderBottom: '1px solid var(--rim0)',
          background: 'var(--bg1)',
        }}>
          <button
            type="button"
            onClick={onNewMission}
            style={{
              height: 26, padding: '0 12px',
              background: 'linear-gradient(180deg,#2fbd7c,#1e9a5e)',
              border: '1px solid #43d88f',
              color: '#04140b',
              font: '700 11px Inter,system-ui,sans-serif',
              letterSpacing: '0.06em',
              cursor: 'pointer',
            }}
          >+ NEW MISSION</button>
        </div>
      )}
      {GROUP_DEFS.map(g => {
        const items = groups[g.key];
        const ghosts = ghostsByGroup[g.key] || [];
        // Render the group if it has real items OR a ghost mid-exit.
        if (!items.length && !ghosts.length) return null;
        const isShut = !!shut[g.key];
        return (
          <section
            key={g.key}
            className={`mb-group ${isShut ? 'mb-shut' : ''}`}
            style={{ '--mb-c': g.color }}
          >
            <button
              type="button"
              className="mb-group-head"
              aria-expanded={!isShut}
              onClick={() => toggle(g.key)}
            >
              <span className="mb-dot" />
              <span>{g.label}</span>
              <span className="mb-n">{items.length}</span>
              <svg className="mb-cv" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 3l3 4 3-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="mb-group-body" aria-hidden={isShut}>
              <div>
                {/* Ghost cards leaving this group — rendered with the stale
                    mission snapshot from the previous render so the stripe
                    color matches the group being left behind. */}
                {ghosts.map(m => (
                  <MissionCardV2
                    key={`ghost-${m._id}`}
                    mission={m}
                    selected={false}
                    onSelect={() => {}}
                    missionTypes={missionTypes}
                    shipThumbs={shipThumbs}
                    animClass="mb-moving"
                  />
                ))}
                {items.map(m => (
                  <MissionCardV2
                    key={m._id}
                    mission={m}
                    selected={selectedMissionId === m._id}
                    onSelect={onSelect}
                    missionTypes={missionTypes}
                    shipThumbs={shipThumbs}
                    animClass={animMap[m._id]}
                  />
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
