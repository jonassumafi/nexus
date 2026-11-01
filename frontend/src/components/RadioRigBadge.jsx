// Compact "my rig" badge for the main dashboard topbar. Shows the
// operator's current SRS radio preset (label + band) at a glance,
// without needing to open the Voice Profile Modal. Clickable — opens
// the modal via the onClick prop.

import useMyRadio from '../hooks/useMyRadio';

export default function RadioRigBadge({ onClick }) {
  const { radio, loading } = useMyRadio();
  if (loading || !radio) return null;

  return (
    <button
      type="button"
      className="nexus-no-drag"
      onClick={onClick}
      title={`Rig: ${radio.label} (${radio.band}) — ${radio.blurb || ''}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        marginRight: 10,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        color: 'var(--fg0)',
        background: 'linear-gradient(180deg, var(--card-hi), var(--card-lo))',
        border: '1px solid var(--rim0)',
        borderRadius: 4,
        cursor: 'pointer',
        boxShadow: 'inset 0 1px 0 var(--hl), 0 2px 0 var(--edge)',
      }}
    >
      <span style={{
        fontSize: 9,
        letterSpacing: '0.14em',
        color: 'var(--cyan)',
        textTransform: 'uppercase',
      }}>
        {radio.band}
      </span>
      <span style={{ color: 'var(--rim1)' }}>·</span>
      <span style={{
        maxWidth: 140,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {radio.label}
      </span>
    </button>
  );
}
