// Theme + density picker — a floating cog that opens a popover with the
// 9 Chassis Studio themes and a comfort/compact density toggle.
// Persists choice to localStorage and applies to <html> immediately.

import { useEffect, useRef, useState } from 'react';

const THEMES = [
  { id: 'deepblue', label: 'Deep Blue', swatch: '#66AADD' },
  { id: 'obsidian', label: 'Obsidian',  swatch: '#b4c2d3' },
  { id: 'ember',    label: 'Ember',     swatch: '#e3a655' },
  { id: 'oxide',    label: 'Oxide',     swatch: '#e2806a' },
  { id: 'olive',    label: 'Olive',     swatch: '#aec86f' },
  { id: 'violet',   label: 'Violet',    swatch: '#ae92ee' },
  { id: 'abyss',    label: 'Abyss',     swatch: '#52c6b3' },
  { id: 'dune',     label: 'Dune',      swatch: '#d8bd90' },
  { id: 'carbon',   label: 'Carbon',    swatch: '#ff5fae' },
];

function readTheme()   { return localStorage.getItem('nexus_theme')   || 'deepblue'; }
function readDensity() { return localStorage.getItem('nexus_density') || 'comfort'; }

function applyTheme(id) {
  if (id === 'deepblue') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', id);
  try { localStorage.setItem('nexus_theme', id); } catch {}
}
function applyDensity(d) {
  document.documentElement.setAttribute('data-dens', d);
  try { localStorage.setItem('nexus_density', d); } catch {}
}

export default function ThemePicker({ compact = false }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(readTheme);
  const [density, setDensity] = useState(readDensity);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pickTheme = (id) => { setTheme(id); applyTheme(id); };
  const pickDensity = (d) => { setDensity(d); applyDensity(d); };

  return (
    <div ref={ref} style={{ position: 'relative' }} className="nexus-no-drag">
      <button
        className="btn"
        onClick={() => setOpen(o => !o)}
        title="Theme & density"
        style={compact
          ? { width: 26, height: 22, padding: 0, fontSize: 11 }
          : { padding: '6px 10px', fontSize: 12 }}
      >
        ⚙
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          minWidth: 220,
          background: 'linear-gradient(180deg, var(--bz1,#172636), var(--bz2,#0f1b27))',
          border: '1px solid var(--edge, var(--rim0))',
          borderRadius: 7,
          boxShadow: '0 10px 24px rgba(0,0,0,.6), inset 0 1px 0 var(--bz-hi, rgba(190,224,255,.2))',
          padding: 10,
          zIndex: 9500,
        }}>
          <div className="eng" style={{ marginBottom: 6 }}>Theme</div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 6,
            marginBottom: 10,
          }}>
            {THEMES.map(t => (
              <button
                key={t.id}
                onClick={() => pickTheme(t.id)}
                title={t.label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  padding: '6px 4px',
                  borderRadius: 5,
                  background: theme === t.id ? 'var(--bg2)' : 'transparent',
                  border: theme === t.id ? '1px solid var(--rim2)' : '1px solid var(--edge, var(--rim0))',
                  cursor: 'pointer',
                  color: 'var(--fg1)',
                  fontSize: 10,
                  letterSpacing: '0.04em',
                }}
              >
                <span style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: t.swatch,
                  boxShadow: 'inset 0 1px 1px rgba(255,255,255,.25), 0 0 0 1px var(--edge,#04090f)',
                }} />
                {t.label}
              </button>
            ))}
          </div>

          <div className="eng" style={{ marginBottom: 6 }}>Density</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['comfort', 'compact'].map(d => (
              <button
                key={d}
                onClick={() => pickDensity(d)}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: 5,
                  background: density === d ? 'var(--bg2)' : 'transparent',
                  border: density === d ? '1px solid var(--rim2)' : '1px solid var(--edge, var(--rim0))',
                  color: density === d ? 'var(--fg0)' : 'var(--fg2)',
                  cursor: 'pointer',
                  fontSize: 11,
                  textTransform: 'capitalize',
                  letterSpacing: '0.06em',
                }}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
