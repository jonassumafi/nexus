// Simple "what's new" splash shown once per app version.
//
// Shows only the most recent entry from RELEASE_NOTES; the user can
// expand to see earlier versions. "Last seen" version is persisted in
// localStorage so the splash never nags the same version twice.

import { useEffect, useState } from 'react';
import { RELEASE_NOTES } from '../data/releaseNotes.js';

const LS_KEY = 'nexus_last_seen_version';

/**
 * The source of truth for "what version is this build" lives in the
 * Electron companion (window.electronAPI.companion.version). When running
 * in a plain browser, we fall back to the top entry in RELEASE_NOTES so
 * dev users still see something.
 */
function currentVersion() {
  try {
    const v = window?.electronAPI?.companion?.version;
    if (v) return String(v);
  } catch {}
  return RELEASE_NOTES[0]?.version || '0.0.0';
}

export default function WhatsNewSplash() {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [version, setVersion] = useState(currentVersion());

  useEffect(() => {
    const v = currentVersion();
    setVersion(v);
    const lastSeen = (() => { try { return localStorage.getItem(LS_KEY); } catch { return null; } })();
    if (lastSeen !== v) setOpen(true);
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(LS_KEY, version); } catch {}
    setOpen(false);
  };

  if (!open) return null;

  const current = RELEASE_NOTES.find(n => n.version === version) || RELEASE_NOTES[0];
  const older = RELEASE_NOTES.filter(n => n.version !== current.version).slice(0, 9);

  return (
    <div
      onClick={dismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(520px, 100%)',
          maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg1)',
          border: '1px solid var(--rim1)',
          borderRadius: 8,
          boxShadow: '0 20px 60px rgba(0,0,0,.6)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '12px 14px',
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'linear-gradient(180deg, var(--bg3), var(--bg2))',
          borderBottom: '1px solid var(--edge, var(--rim0))',
        }}>
          <span style={{
            fontSize: 11, fontWeight: 700,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            color: 'var(--cyan)', flex: 1,
          }}>What's new · v{current.version}</span>
          <button
            className="btn"
            onClick={dismiss}
            style={{ fontSize: 11, padding: '5px 12px' }}
          >Got it</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          <div style={{
            fontSize: 10, color: 'var(--fg2)', letterSpacing: '0.12em',
            textTransform: 'uppercase', marginBottom: 8,
          }}>Released {current.date}</div>
          <ol style={{
            margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {(current.bullets || []).map((b, i) => (
              <li key={i} style={{
                fontSize: 13, color: 'var(--fg0)', lineHeight: 1.5,
              }}>{b}</li>
            ))}
          </ol>

          {older.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <button
                onClick={() => setShowAll(v => !v)}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  color: 'var(--cyan)', cursor: 'pointer',
                  fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
                  fontWeight: 600,
                }}
              >
                {showAll ? 'Hide earlier versions' : `Show earlier versions (${older.length})`}
              </button>
              {showAll && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {older.map(n => (
                    <div key={n.version} style={{
                      borderTop: '1px dashed var(--rim0)', paddingTop: 10,
                    }}>
                      <div style={{
                        fontSize: 11, color: 'var(--fg2)', letterSpacing: '0.1em',
                        textTransform: 'uppercase', fontWeight: 600, marginBottom: 6,
                      }}>v{n.version} · {n.date}</div>
                      <ol style={{
                        margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4,
                      }}>
                        {(n.bullets || []).map((b, i) => (
                          <li key={i} style={{
                            fontSize: 12, color: 'var(--fg1)', lineHeight: 1.45,
                          }}>{b}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
