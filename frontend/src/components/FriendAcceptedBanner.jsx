// Top-center lime toast shown when a friend request is accepted
// (either direction). Holds 3.4 s, honours prefers-reduced-motion.
import { useEffect, useState } from 'react';

const STYLE_ID = 'friend-accepted-banner-styles';
function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
@keyframes fab-in { from { opacity:0; transform:translate(-50%,-8px) } to { opacity:1; transform:translate(-50%,0) } }
.fab-toast{position:fixed;top:38px;left:50%;transform:translateX(-50%);z-index:9999;
  display:flex;align-items:center;gap:9px;
  background:color-mix(in srgb, var(--lime) 16%, var(--bg1));
  border:1px solid var(--lime);color:var(--lime);
  font:700 12px Inter,system-ui,sans-serif;letter-spacing:.08em;
  text-transform:uppercase;padding:8px 20px;
  box-shadow:0 10px 30px rgba(0,0,0,.5);
  animation:fab-in 280ms cubic-bezier(.2,.8,.2,1)}
.fab-toast svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2}
@media (prefers-reduced-motion:reduce){ .fab-toast{animation:none} }
`;
  document.head.appendChild(s);
}

export default function FriendAcceptedBanner({ event, onDismiss }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { injectStyles(); }, []);
  useEffect(() => {
    if (!event) return;
    setVisible(true);
    const t = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, 3400);
    return () => clearTimeout(t);
  }, [event, onDismiss]);
  if (!event || !visible) return null;
  return (
    <div role="status" aria-live="polite" className="fab-toast">
      <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="4 12 10 18 20 6" /></svg>
      <span>You and {event.name} are now friends.</span>
    </div>
  );
}
