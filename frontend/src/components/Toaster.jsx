// Global toast primitive. Any module can call `toast(message, { kind })`
// without importing a context. The <Toaster /> container (mounted once
// at the app root) subscribes to the store and renders stacked toasts
// bottom-right. Kinds: success | error | info. Auto-dismiss after the
// configured duration.
import { useEffect, useState } from 'react';

let _nextId = 1;
const _listeners = new Set();
let _toasts = [];

function _emit() {
  for (const l of _listeners) l(_toasts);
}

export function toast(message, { kind = 'info', duration = 3000 } = {}) {
  const id = _nextId++;
  _toasts = [..._toasts, { id, message: String(message || ''), kind }];
  _emit();
  if (duration > 0) setTimeout(() => dismissToast(id), duration);
  return id;
}
toast.success = (m, o) => toast(m, { ...(o || {}), kind: 'success' });
toast.error   = (m, o) => toast(m, { ...(o || {}), kind: 'error'   });
toast.info    = (m, o) => toast(m, { ...(o || {}), kind: 'info'    });

export function dismissToast(id) {
  _toasts = _toasts.filter(t => t.id !== id);
  _emit();
}

const STYLE_ID = 'nx-toaster-styles';
function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
@keyframes nxt-in { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:none } }
.nxt-wrap{position:fixed;right:20px;bottom:20px;z-index:9800;display:flex;flex-direction:column;gap:8px;align-items:flex-end;pointer-events:none}
.nxt{min-width:220px;max-width:360px;padding:9px 32px 9px 12px;position:relative;
  background:var(--bg2);border:1px solid var(--rim1);color:var(--fg1);
  font:12.5px/1.4 Inter,system-ui,sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.5);
  animation:nxt-in 200ms cubic-bezier(.2,.8,.2,1);pointer-events:auto}
.nxt.success{border-left:3px solid var(--lime,#43d88f)}
.nxt.error  {border-left:3px solid var(--red,#ff5555)}
.nxt.info   {border-left:3px solid var(--cyan)}
.nxt .nxt-x{position:absolute;top:4px;right:4px;width:22px;height:22px;background:none;border:0;
  color:var(--fg3);cursor:pointer;font-size:16px;line-height:1;padding:0}
.nxt .nxt-x:hover{color:var(--fg0)}
@media (prefers-reduced-motion:reduce){ .nxt{animation:none} }
`;
  document.head.appendChild(s);
}

export default function Toaster() {
  const [list, setList] = useState(_toasts);
  useEffect(() => { injectStyles(); _listeners.add(setList); return () => { _listeners.delete(setList); }; }, []);
  if (list.length === 0) return null;
  return (
    <div className="nxt-wrap" aria-live="polite">
      {list.map(t => (
        <div key={t.id} className={`nxt ${t.kind}`} role="status">
          {t.message}
          <button className="nxt-x" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
