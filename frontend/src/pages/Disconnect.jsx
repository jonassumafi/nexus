import { useState, useEffect } from 'react';
import { useAuthContext } from '../context/AuthContext.jsx';

const playClick = () => {
  const file = Math.random() > 0.5 ? '/sounds/click.mp3' : '/sounds/click2.mp3';
  const snd = new Audio(file);
  snd.volume = 0.7;
  snd.play().catch(() => {});
};

const BASE_LINES = [
  { text: 'Terminating session…',             tone: 'fg2' },
  { text: 'Flushing crew assignments…',       tone: 'fg2' },
  { text: 'Clearing authorization token…',    tone: 'fg2' },
  { text: 'Disconnecting from Nexus relay…',  tone: 'fg2' },
  { text: 'Connection terminated.',           tone: 'red' },
];

const TONE = { fg2: 'var(--fg2)', red: 'var(--red)', fg3: 'var(--fg3)' };

export default function Disconnect() {
  const { user } = useAuthContext();
  const [visibleCount, setVisibleCount] = useState(0);

  const lines = [
    ...BASE_LINES,
    { text: `Goodbye, ${user?.citizen_name || 'operator'}.`, tone: 'fg3' },
  ];

  useEffect(() => {
    playClick();

    // Line step bumped 200 → 400 ms and tail bumped 1200 → 2400 ms so
    // the sequence lands at exactly twice its original speed — gives
    // the user time to read each line before redirect.
    const tids = [];
    lines.forEach((_, i) => {
      tids.push(setTimeout(() => setVisibleCount(i + 1), i * 400));
    });

    const lastDelay = (lines.length - 1) * 400;
    tids.push(setTimeout(() => {
      localStorage.removeItem('nexus_token');
      // In Electron, Disconnect quits the app completely (bypasses the
      // "Minimize to tray" setting by design — Disconnect always exits).
      // In the browser, fall back to navigating home.
      const api = typeof window !== 'undefined' ? window.electronAPI : null;
      if (api?.app?.quit) {
        try { api.app.quit(); return; } catch {}
      }
      window.location.href = '/';
    }, lastDelay + 2400));

    return () => tids.forEach(clearTimeout);
  }, []);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--void)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div className="vig" />
      <div className="raised" style={{
        position: 'relative',
        zIndex: 1,
        padding: '28px 36px',
        minWidth: 420,
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--blue)',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span className="live-dot" style={{ background: 'var(--red)', boxShadow: '0 0 6px var(--red)' }} />
          Disconnect
        </div>
        {lines.slice(0, visibleCount).map((line, i) => (
          <div key={i} style={{
            color: TONE[line.tone],
            fontSize: 13,
            lineHeight: 2,
          }}>
            {line.text}
          </div>
        ))}

        {/* License + attribution footer. Shown on the Disconnect page so
            players always have a visible path to credit information
            without needing a separate About screen. */}
        <div style={{
          marginTop: 24,
          paddingTop: 14,
          borderTop: '1px solid var(--rim0)',
          fontSize: 10,
          color: 'var(--fg3)',
          lineHeight: 1.6,
          letterSpacing: '0.04em',
        }}>
          <div style={{ marginBottom: 4 }}>
            Nexus Interstellar Traffic System — free software under{' '}
            <a href="https://www.gnu.org/licenses/gpl-3.0.html"
               target="_blank" rel="noreferrer"
               style={{ color: 'var(--blue)' }}>
              GPL&nbsp;v3
            </a>{' '}·{' '}
            <a href="https://github.com/jonassumafi/nexus"
               target="_blank" rel="noreferrer"
               style={{ color: 'var(--blue)' }}>
              source
            </a>
          </div>
          <div>
            Radio effects and configurations from DCS-SimpleRadioStandalone
            by Ciribob and contributors, used under GPL v3. PTT and radio
            effects by Bimbac. HAVE QUICK by Nicholas Landolfi. AM
            frequency collision by Jester. SimPhonics tones collection.
          </div>
        </div>
      </div>
    </div>
  );
}
