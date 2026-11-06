// Skin picker anchored under the Banner's palette icon. Theme-only —
// radio rigs live under the gear.
import { useState } from 'react';
import { AnchoredPopover } from './Banner';

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

const readTheme = () => (typeof localStorage !== 'undefined' && localStorage.getItem('nexus_theme')) || 'deepblue';
function applyTheme(id) {
  if (id === 'deepblue') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', id);
  try { localStorage.setItem('nexus_theme', id); } catch {}
  try { window.electronAPI?.saveSkin?.(id); } catch {}
}

export default function SkinPopover({ anchorRef, onClose }) {
  const [theme, setTheme] = useState(readTheme);
  const pick = (id) => { setTheme(id); applyTheme(id); };
  return (
    <AnchoredPopover anchorRef={anchorRef} width={260} onClose={onClose} label="Skin">
      <h4>Skin</h4>
      <div className="nxp-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => pick(t.id)}
              title={t.label}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                padding: '6px 4px',
                background: theme === t.id ? 'var(--bg3)' : 'var(--bg2)',
                border: theme === t.id ? '1px solid var(--cyan)' : '1px solid var(--rim0)',
                cursor: 'pointer', color: 'var(--fg1)',
                font: '600 10px Inter', letterSpacing: '.04em',
              }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: '50%',
                background: t.swatch,
                boxShadow: 'inset 0 1px 1px rgba(255,255,255,.25), 0 0 0 1px rgba(0,0,0,.5)',
              }} />
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </AnchoredPopover>
  );
}
