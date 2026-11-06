// Horizontal or stacked lockup: NexusMark + "NEXUS" wordmark (+ optional
// "SHIP MANAGEMENT" subtitle). All sizes derive from `height` so the
// lockup scales cleanly. Per logo_e_spec section 4.

import NexusMark from './NexusMark';

export default function NexusLockup({
  height = 48,
  orientation = 'horizontal',    // 'horizontal' | 'stacked'
  subtitle = true,               // show "SHIP MANAGEMENT"
  animate = false,
  mono = false,
}) {
  const H = height;
  const showSub = subtitle && H >= 32;   // subtitle only above 32 px
  const stacked = orientation === 'stacked';
  const wordSize = stacked ? H * 0.5 : H * 0.56;
  const subSize  = H * 0.235;
  const subGap   = H * 0.12;
  const markGap  = (stacked ? 0.35 : 0.30) * H;

  const wordmark = (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: stacked ? 'center' : 'flex-start',
      // Add tracking compensation when stacked so the text stays centered.
      paddingLeft: stacked ? '0.2em' : 0,
      lineHeight: 1,
    }}>
      <span style={{
        font: `800 ${wordSize}px Inter, system-ui, sans-serif`,
        letterSpacing: '0.2em',
        color: 'var(--fg1)',
      }}>NEXUS</span>
      {showSub && (
        <span style={{
          font: `600 ${subSize}px Inter, system-ui, sans-serif`,
          letterSpacing: '0.3em',
          color: 'var(--fg2)',
          marginTop: subGap,
        }}>SHIP MANAGEMENT</span>
      )}
    </div>
  );

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: stacked ? 'column' : 'row',
        alignItems: 'center',
        gap: markGap,
      }}
      role="img"
      aria-label="Nexus Ship Management"
    >
      <NexusMark size={H} animate={animate} mono={mono} />
      {wordmark}
    </div>
  );
}
