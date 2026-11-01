// Shared placeholder panel for routes that haven't been built as top-level pages
// yet (their functionality currently lives inside the Dashboard view).
export default function StubPanel({ title, subtitle }) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--void)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 40,
    }}>
      <div className="vig" />
      <div className="raised" style={{
        position: 'relative',
        zIndex: 1,
        width: '100%',
        maxWidth: 480,
        padding: '26px 32px',
        textAlign: 'center',
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--blue)',
          marginBottom: 10,
        }}>
          Nexus
        </div>
        <div style={{
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--fg0)',
          marginBottom: 6,
        }}>
          {title}
        </div>
        {subtitle && (
          <div style={{
            fontSize: 13,
            color: 'var(--fg2)',
            marginBottom: 18,
            lineHeight: 1.6,
          }}>
            {subtitle}
          </div>
        )}
        <span className="badge b-amber">Coming soon</span>
      </div>
    </div>
  );
}
