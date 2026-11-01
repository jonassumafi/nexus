// FeedIcon — Lucide-style inline SVG icons for the activity feed.
// One unique silhouette per event type so the glyph itself carries
// semantic weight, instead of relying only on the ring color.
//
// All icons:
//   • 14 px canvas, 1.6 px stroke
//   • stroke="currentColor" so they retint with the parent .ico tone
//   • no fills (except where a filled dot is semantically needed)
//
// Usage:   <FeedIcon type="mission_launched" />
// Fallback: unrecognized types render a solid dot.

const COMMON = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

// Rocket — mission_launched
const Rocket = () => (
  <svg {...COMMON}>
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </svg>
);

// File-plus — mission_created
const FilePlus = () => (
  <svg {...COMMON}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M12 11v6" />
    <path d="M9 14h6" />
  </svg>
);

// Hourglass — mission_prep
const Hourglass = () => (
  <svg {...COMMON}>
    <path d="M5 22h14" />
    <path d="M5 2h14" />
    <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
    <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
  </svg>
);

// Check-circle — mission_complete
const CheckCircle = () => (
  <svg {...COMMON}>
    <circle cx="12" cy="12" r="10" />
    <path d="M8 12l3 3 5-6" />
  </svg>
);

// X-octagon — mission_aborted
const XOctagon = () => (
  <svg {...COMMON}>
    <path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z" />
    <path d="M15 9l-6 6" />
    <path d="M9 9l6 6" />
  </svg>
);

// User-plus — slot_filled
const UserPlus = () => (
  <svg {...COMMON}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <path d="M20 8v6" />
    <path d="M23 11h-6" />
  </svg>
);

// User-minus — slot_withdrawn
const UserMinus = () => (
  <svg {...COMMON}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <path d="M23 11h-6" />
  </svg>
);

// Sparkles — ship_fill_bonus (RP bonus)
const Sparkles = () => (
  <svg {...COMMON}>
    <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
    <path d="M19 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" />
    <path d="M5 15l.7 1.4L7 17l-1.3.6L5 19l-.7-1.4L3 17l1.3-.6z" />
  </svg>
);

// Handshake — ship_borrowed (loan)
const Handshake = () => (
  <svg {...COMMON}>
    <path d="M11 17l2 2a1 1 0 1 0 3-3" />
    <path d="M14 14l2.5 2.5a1 1 0 1 0 3-3L15 9h-1c-1.5 0-2 .5-3 1l-2 2" />
    <path d="M19 15l-3-3" />
    <path d="M2 10l5-5 4 4-5 5z" />
    <path d="M9 13l-2 2" />
  </svg>
);

// Trophy — rank_advanced
const Trophy = () => (
  <svg {...COMMON}>
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2z" />
  </svg>
);

// Pen-line — post_mission_log
const PenLine = () => (
  <svg {...COMMON}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

// Wifi — player_connected
const Wifi = () => (
  <svg {...COMMON}>
    <path d="M5 12.55a11 11 0 0 1 14.08 0" />
    <path d="M1.42 9a16 16 0 0 1 21.16 0" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <circle cx="12" cy="20" r="0.8" fill="currentColor" stroke="none" />
  </svg>
);

// Wifi-off — player_disconnected
const WifiOff = () => (
  <svg {...COMMON}>
    <path d="M1 1l22 22" />
    <path d="M16.72 11.06A11 11 0 0 1 19 12.55" />
    <path d="M5 12.55a11 11 0 0 1 5.17-2.39" />
    <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
    <path d="M1.42 9a16 16 0 0 1 4.7-2.88" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <circle cx="12" cy="20" r="0.8" fill="currentColor" stroke="none" />
  </svg>
);

// Alert-triangle — queue_expired
const AlertTriangle = () => (
  <svg {...COMMON}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4" />
    <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

// Brain-circuit — ai_summary
const BrainCircuit = () => (
  <svg {...COMMON}>
    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
    <path d="M9 13a2 2 0 1 0 4 0" />
    <circle cx="9" cy="9" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="15" cy="9" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

// Dot — generic fallback
const Dot = () => (
  <svg {...COMMON}>
    <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
  </svg>
);

const ICON_BY_TYPE = {
  mission_created:     FilePlus,
  mission_prep:        Hourglass,
  mission_launched:    Rocket,
  mission_complete:    CheckCircle,
  mission_aborted:     XOctagon,
  slot_filled:         UserPlus,
  slot_withdrawn:      UserMinus,
  ship_fill_bonus:     Sparkles,
  ship_borrowed:       Handshake,
  rank_advanced:       Trophy,
  rank_advancement:    Trophy,
  post_mission_log:    PenLine,
  player_connected:    Wifi,
  player_disconnected: WifiOff,
  queue_expired:       AlertTriangle,
  ai_summary:          BrainCircuit,
};

export default function FeedIcon({ type }) {
  const Comp = ICON_BY_TYPE[type] || Dot;
  return <Comp />;
}
