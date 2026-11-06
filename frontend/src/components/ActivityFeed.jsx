// ActivityFeed — day-grouped two-line event rows.
//
// Matches `/radio_activity_feed_spec.html` exactly:
//   - Sticky day label per calendar day in viewer's local time
//     (Today / Yesterday / "Sun 1 Nov")
//   - Each row: 1px rail + 7px type-colored dot + two-line clamped text
//     + right-aligned HH:MM time
//   - Type dots: new=blue, log=lime, join=teal (accent), done=amber
//   - Text emphasis: person bold+bright, action muted, target tinted+semibold
//   - Full text in the row's title attribute for overflow readability
//
// The outer card header (live dot + title + collapse button) stays in
// Dashboard. This component renders just the list body + empty state.

import { useMemo } from 'react';

// Map event_type → dot category. Fallback 'new' for unknown types.
function catOf(eventType) {
  switch (eventType) {
    case 'mission_created':
    case 'mission_prep':
    case 'mission_launched':
      return 'new';
    case 'slot_filled':
    case 'player_connected':
      return 'join';
    case 'post_mission_log':
    case 'ai_summary':
      return 'log';
    case 'mission_complete':
    case 'mission_aborted':
    case 'slot_withdrawn':
    case 'player_disconnected':
    case 'rank_advanced':
    case 'rank_advancement':
    case 'ship_fill_bonus':
    case 'ship_borrowed':
    case 'queue_expired':
      return 'done';
    default:
      return 'new';
  }
}

// Decompose an event into (who, action, target) so the renderer can
// apply the spec's three-tier emphasis. If a piece is missing, it
// renders as pure muted body text.
function decompose(ev) {
  switch (ev.event_type) {
    case 'mission_created':
      return { who: ev.citizen_name, action: 'created', target: ev.mission_name };
    case 'mission_launched': {
      const suffix = ev.rp_awarded ? ` · +${ev.rp_awarded} RP` : '';
      return { who: ev.citizen_name, action: 'launched', target: `${ev.mission_name}${suffix}` };
    }
    case 'mission_prep':
      return { who: null, action: null, target: `${ev.mission_name} is preparing for launch` };
    case 'mission_complete': {
      const suffix = ev.total_rp_awarded ? ` · +${ev.total_rp_awarded} RP to crew` : '';
      return { who: ev.citizen_name || 'Commander', action: 'completed', target: `${ev.mission_name}${suffix}` };
    }
    case 'mission_aborted':
      return { who: ev.citizen_name || 'Commander', action: 'aborted', target: ev.mission_name };
    case 'slot_filled': {
      const suffix = ev.rp_earned ? ` · +${ev.rp_earned} RP` : '';
      return { who: ev.citizen_name, action: `joined ${ev.ship_name} as`, target: `${ev.role_name}${suffix}` };
    }
    case 'slot_withdrawn': {
      const suffix = ev.rp_deducted ? ` · -${ev.rp_deducted} RP` : '';
      return { who: ev.citizen_name, action: `withdrew from ${ev.ship_name} as`, target: `${ev.role_name}${suffix}` };
    }
    case 'post_mission_log': {
      const suffix = ev.rp_earned ? ` · +${ev.rp_earned} RP` : '';
      return { who: ev.citizen_name, action: 'submitted a post-mission log for', target: `${ev.mission_name}${suffix}` };
    }
    case 'rank_advanced':
    case 'rank_advancement':
      return { who: ev.citizen_name, action: 'advanced to', target: ev.new_rank ?? ev.rank_name };
    case 'player_connected':
      return { who: ev.citizen_name, action: 'connected to', target: 'Nexus' };
    case 'player_disconnected':
      return { who: ev.citizen_name, action: 'disconnected from', target: 'Nexus' };
    case 'ship_fill_bonus': {
      const pts = ev.rp_awarded ?? ev.rp_earned;
      return pts
        ? { who: null, action: null, target: `${ev.ship_name} earned +${pts} Ship RP · fill threshold reached` }
        : { who: null, action: null, target: `${ev.ship_name} reached fill threshold` };
    }
    case 'queue_expired':
      return { who: null, action: null, target: `${ev.mission_name} expired — crew queue closed` };
    case 'ai_summary':
      return { who: null, action: null, target: ev.summary || 'AI summary' };
    default:
      return { who: null, action: null, target: ev.event_type };
  }
}

// YYYY-MM-DD in viewer's local time — used as the group key and for
// day-arithmetic comparisons (Today / Yesterday).
function localDayKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function dayLabelForKey(key, nowKey) {
  if (key === nowKey) return 'Today';
  // Yesterday test: construct a Date from the nowKey and subtract 1 day,
  // then compare keys. Timezone-agnostic because both sides are local.
  const [ny, nm, nd] = nowKey.split('-').map(Number);
  const yesterday = new Date(ny, nm - 1, nd - 1);
  const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  if (key === yKey) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const wk = dt.toLocaleDateString(undefined, { weekday: 'short' });
  const mon = dt.toLocaleDateString(undefined, { month: 'short' });
  return `${wk} ${d} ${mon}`;
}

function hhmm(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fullLineFor(ev, parts) {
  const { who, action, target } = parts;
  const pieces = [who, action, target].filter(Boolean);
  return pieces.length ? pieces.join(' ') : ev.event_type;
}

export default function ActivityFeed({ events = [], loading = false, loadingHint = '' }) {
  // Pre-group events into { dayKey → events[] } preserving input order.
  // The API returns descending by timestamp; we trust that and only group.
  const sections = useMemo(() => {
    const out = [];
    let last = null;
    for (const ev of events) {
      if (!ev?.timestamp) continue;
      const key = localDayKey(ev.timestamp);
      if (key !== last) { out.push({ dayKey: key, items: [] }); last = key; }
      out[out.length - 1].items.push(ev);
    }
    return out;
  }, [events]);

  const nowKey = useMemo(() => localDayKey(Date.now()), [
    // Recompute once per minute so "Today" doesn't rot across midnight.
    Math.floor(Date.now() / 60000),
  ]);

  if (loading) {
    return <div className="af-empty">Scanning{loadingHint}</div>;
  }
  if (!events.length) {
    return <div className="af-empty">No activity yet.</div>;
  }

  return (
    <div className="af-feed">
      <style>{AF_CSS}</style>
      <div className="af-list">
        {sections.map((sec) => (
          <div key={sec.dayKey}>
            <div className="af-day">{dayLabelForKey(sec.dayKey, nowKey)}</div>
            {sec.items.map((ev, i) => {
              const parts = decompose(ev);
              const cat = catOf(ev.event_type);
              const title = fullLineFor(ev, parts);
              return (
                <div
                  key={ev._id ?? `${ev.event_type}-${ev.timestamp}-${i}`}
                  className={`af-it af-${cat}`}
                  title={title}
                >
                  <div className="af-tx">
                    {parts.who && <b>{parts.who}</b>}
                    {parts.who && parts.action && ' '}
                    {parts.action}
                    {parts.action && parts.target && ' '}
                    {parts.target && <em>{parts.target}</em>}
                    {!parts.who && !parts.action && !parts.target && ev.event_type}
                  </div>
                  <time>{hhmm(ev.timestamp)}</time>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const AF_CSS = `
.af-feed {
  --af-text: 11px;
  --af-time: 10px;
  --af-day: 10px;
  --af-lines: 2;
  --af-row-py: 5px;
  --af-row-pr: 9px;
  --af-rail-x: 11px;
  --af-dot: 7px;
  --af-text-left: 24px;
  --af-gap: 8px;
  --af-day-py: 5px;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.af-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.af-day {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: var(--af-day-py) 10px calc(var(--af-day-py) - 2px);
  font: 700 var(--af-day) Inter, system-ui, sans-serif;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--fg2, #8db8b2);
  background: color-mix(in srgb, var(--bg0, #050f0e) 78%, #000);
  border-bottom: 1px solid color-mix(in srgb, var(--bg0, #050f0e) 55%, #000);
}
.af-it {
  position: relative;
  display: flex;
  gap: var(--af-gap);
  padding: var(--af-row-py) var(--af-row-pr) var(--af-row-py) var(--af-text-left);
  align-items: baseline;
  transition: background 160ms cubic-bezier(.2,.8,.2,1);
}
.af-it:hover {
  background: color-mix(in srgb, var(--cyan, #7ef0dc) 7%, var(--bg1, #0a1918));
}
.af-it::before {
  content: "";
  position: absolute;
  left: var(--af-rail-x);
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--rim0, #234441);
}
.af-it::after {
  content: "";
  position: absolute;
  left: calc(var(--af-rail-x) - var(--af-dot) / 2 + 0.5px);
  top: calc(var(--af-row-py) + 5px);
  width: var(--af-dot);
  height: var(--af-dot);
  border-radius: 50%;
  background: var(--af-dotcolor, var(--blue, #6fb4ff));
  box-shadow: 0 0 0 2px var(--bg1, #0a1918);
}
.af-it.af-new  { --af-dotcolor: var(--blue, #6fb4ff); }
.af-it.af-log  { --af-dotcolor: var(--lime, #44FF88); }
.af-it.af-join { --af-dotcolor: var(--cyan, #7ef0dc); }
.af-it.af-done { --af-dotcolor: var(--amber, #FFBB33); }
.af-tx {
  flex: 1;
  min-width: 0;
  font: 500 var(--af-text)/1.4 Inter, system-ui, sans-serif;
  color: var(--fg2, #8db8b2);
  display: -webkit-box;
  -webkit-line-clamp: var(--af-lines);
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.af-tx b {
  font-weight: 700;
  color: var(--fg0, var(--fg1, #e3faf6));
}
.af-tx em {
  font-style: normal;
  font-weight: 600;
  color: var(--cyan2, var(--cyan, #c4faf0));
}
.af-it time {
  font-size: var(--af-time);
  color: var(--fg2, #8db8b2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.af-empty {
  padding: 12px 10px;
  color: var(--fg2, #8db8b2);
  font-size: 11px;
}
@media (prefers-reduced-motion: reduce) {
  .af-it { transition-duration: 0.001ms; }
}
`;
