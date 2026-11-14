// New dashboard nav row (Layout A). Three right-hand groups separated
// by vertical rules: chat/friends | pin/radio | settings/bug/power.
// The brand row + window bar above it stay untouched and are rendered
// by the Dashboard page as before.
//
// This component owns its own CSS for the nav; higher-level app CSS is
// unaffected. Icon glyphs are inlined SVG so no dep on an icon lib.
import { useEffect, useRef, useState } from 'react';
import { useHold, HoldRing } from './HoldButton';

const STYLE_ID = 'banner-styles';
function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
.nxb{display:flex;align-items:center;gap:6px;padding:8px 16px;min-height:50px;
  background:var(--bg1);border-bottom:1px solid var(--rim0);flex:none}
.nxb .nb{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 13px;
  border:1px solid var(--rim1);background:linear-gradient(180deg,var(--bg3),var(--bg2));
  font:600 12px Inter,system-ui,sans-serif;color:var(--cyan);white-space:nowrap;cursor:pointer;
  transition:background 160ms,border-color 160ms}
.nxb .nb:hover{background:var(--bg3);border-color:var(--blue)}
.nxb .nb[aria-current=page],.nxb .nb[aria-pressed=true]{background:var(--bg3);border-color:var(--cyan);box-shadow:inset 0 -2px 0 var(--cyan)}
.nxb .nb svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex:none}
.nxb .nb.ghost{background:transparent;border-style:dashed;color:var(--fg3)}
.nxb .nb.ghost:hover{color:var(--cyan)}
.nxb .sep{width:1px;height:22px;background:var(--rim0);margin:0 6px;flex:none}
.nxb .sp{flex:1}
.nxb .ib{position:relative;width:32px;height:32px;display:grid;place-items:center;
  border:1px solid var(--rim0);background:var(--bg2);color:var(--fg2);cursor:pointer;
  transition:background 160ms,color 160ms,border-color 160ms}
.nxb .ib:hover{background:var(--bg3);color:var(--cyan);border-color:var(--rim1)}
.nxb .ib[aria-pressed=true]{color:var(--cyan);border-color:var(--cyan);background:var(--bg3)}
.nxb .ib[disabled]{opacity:.4;cursor:default}
.nxb .ib svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.nxb .ib.sm{width:26px;height:26px}
.nxb .ib.sm svg{width:14px;height:14px}
.nxb .ib.dng:hover{color:var(--red);border-color:var(--red)}
.nxb .ib:hover::after,.nxb .ib:focus-visible::after{content:attr(data-tip);position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%);
  white-space:nowrap;background:var(--bg3);border:1px solid var(--rim1);color:var(--fg1);font:600 10px Inter;padding:3px 7px;z-index:40;pointer-events:none}
.nxb .cnt{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--cyan);color:#001418;font:800 10px/16px Inter;text-align:center}
.nxb .cnt[hidden]{display:none}
.nxb .nb small{font:600 10px Inter;color:var(--fg3);margin-left:4px}
.nxb .ponline{font:600 10px Inter;color:var(--fg3);margin-left:6px;letter-spacing:.06em}
@media (max-width:1320px){ .nxb .hide-md{display:none} }
@media (max-width:1180px){ .nxb{overflow-x:auto} }
@media (prefers-reduced-motion:reduce){ .nxb *{transition:none !important;animation:none !important} }
`;
  document.head.appendChild(s);
}

// Disconnect icon button with a 6-second press-and-hold. The old
// behavior was click → popover-confirm → disconnect; now the confirm
// gesture is the hold itself. Early release shows a "Hold" hint.
function DisconnectHoldButton({ powerBtnRef, onConfirm }) {
  const { bindProps, progress, holding, showHint } = useHold({
    holdMs: 6000,
    hintText: 'Hold to disconnect',
    onComplete: () => { try { onConfirm?.(); } catch {} },
  });
  return (
    <button
      ref={powerBtnRef}
      className="ib sm dng"
      data-tip={showHint ? 'Hold to disconnect' : 'Hold to disconnect'}
      aria-label="Disconnect (hold 6 seconds)"
      {...bindProps}
      style={{
        position: 'relative',
        ...(holding ? { color: 'var(--red)', borderColor: 'var(--red)' } : null),
      }}
    >
      <HoldRing progress={progress} variant="danger" size={26} />
      <I name="power" />
    </button>
  );
}

function I({ name }) {
  const common = { viewBox: '0 0 24 24', 'aria-hidden': 'true' };
  switch (name) {
    case 'missions':   return <svg {...common}><rect x="4" y="5" width="16" height="14" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>;
    case 'mymission':  return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 7v6l4 2" /></svg>;
    case 'myships':    return <svg {...common}><path d="M3 15c3 2 6 2 9 0s6-2 9 0" /><path d="M5 11h14l-2-4H7l-2 4z" /></svg>;
    case 'registry':   return <svg {...common}><rect x="4" y="4" width="16" height="16" /><path d="M8 4v16M4 8h16" /></svg>;
    case 'plus':       return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case 'chat':       return <svg {...common}><path d="M4 5h16v12H9l-5 4V5z" /></svg>;
    case 'mail':       return <svg {...common}><rect x="3" y="6" width="18" height="12" /><path d="M3 7l9 7 9-7" /></svg>;
    case 'friends':    return <svg {...common}><circle cx="9" cy="9" r="3.2" /><circle cx="17" cy="10" r="2.5" /><path d="M3 20c.6-3.4 3.3-5.5 6-5.5s5.4 2.1 6 5.5" /><path d="M15 20c.5-2.5 2.3-4.2 4.5-4.3" /></svg>;
    case 'pin':        return <svg {...common}><path d="M12 3v10l4 4v3H8v-3l4-4V3z" /></svg>;
    case 'companion':  return <svg {...common}><rect x="3" y="5" width="18" height="14" /><rect x="7" y="9" width="10" height="6" /></svg>;
    case 'radio':      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M5 12a7 7 0 0 1 14 0" /><path d="M8 12a4 4 0 0 1 8 0" /></svg>;
    case 'skin':       return <svg {...common}><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2.5-1 2.5-2.3 0-.7-.3-1-.7-1.6-.3-.4-.3-1 .2-1.4.4-.3 1-.4 1.5-.4h1.5A4 4 0 0 0 21 11c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/></svg>;
    case 'gear':       return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.2-1.7l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.9-1.7L13 2h-4l-.6 2.6A7 7 0 0 0 5.5 6.3L3.2 5.4 1.2 8.8l2 1.5A7 7 0 0 0 3 12c0 .6.1 1.1.2 1.7l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.9 1.7L9 22h4l.6-2.6a7 7 0 0 0 2.9-1.7l2.3.9 2-3.4-2-1.5c.1-.6.2-1.1.2-1.7z" /></svg>;
    case 'bug':        return <svg {...common}><rect x="7" y="8" width="10" height="11" rx="5" /><path d="M9 7l-2-2M15 7l2-2M4 14h3M17 14h3M4 19h3M17 19h3" /></svg>;
    case 'power':      return <svg {...common}><path d="M12 3v9" /><path d="M7 7a7 7 0 1 0 10 0" /></svg>;
    case 'close':      return <svg {...common}><path d="M6 6l12 12M18 6L6 18" /></svg>;
    default: return null;
  }
}

function Badge({ n }) {
  if (!n || n <= 0) return null;
  const txt = n > 9 ? '9+' : String(n);
  return <span className="cnt">{txt}</span>;
}

export default function Banner({
  // page state
  page,                       // 'missions'|'mymission'|'myships'|'registry'|'register'
  canMyMission,
  onMissions, onMyMission, onMyShips, onRegistry, onRegister,
  // comms
  chatOpen, onToggleChat, chatUnread,
  friendsOpen, onToggleFriends, friendsUnread, friendsOnline,
  friendsBtnRef,
  // window toggles (Electron)
  pinned, onTogglePin,
  radioOnly, onToggleRadio,
  hasElectron,
  // admin popovers
  settingsBtnRef, bugBtnRef, powerBtnRef, skinBtnRef, messagesBtnRef,
  onOpenSettings, onOpenBug, onOpenDisconnect, onOpenSkin, onOpenMessages,
  messagesUnread,
  // misc
  bannerRef,
}) {
  useEffect(() => { injectStyles(); }, []);

  const current = (k) => (page === k ? 'page' : undefined);

  return (
    <nav ref={bannerRef} className="nxb" aria-label="Primary">
      <button className="nb" aria-current={current('missions')} onClick={onMissions}>
        <I name="missions" /> Missions
      </button>
      {canMyMission && (
        <button className="nb" aria-current={current('mymission')} onClick={onMyMission}>
          <I name="mymission" /> My mission
        </button>
      )}
      <button className="nb" aria-current={current('myships')} onClick={onMyShips}>
        <I name="myships" /> My ships
      </button>
      <button className="nb" aria-current={current('registry')} onClick={onRegistry}>
        <I name="registry" /> Ship registry
      </button>
      <button className="nb ghost" aria-current={current('register')} onClick={onRegister} title="Register a new ship">
        <I name="plus" /> <span className="hide-md">Register ship</span>
      </button>

      <div className="sp" />

      <button
        className="nb"
        style={{ position: 'relative' }}
        aria-pressed={chatOpen || undefined}
        aria-label={`Global Chat${chatUnread > 0 ? `, ${chatUnread} unread` : ''}`}
        onClick={onToggleChat}
      >
        <I name="chat" /> Global Chat
        <Badge n={chatUnread} />
      </button>
      <button
        ref={friendsBtnRef}
        className="nb"
        style={{ position: 'relative' }}
        aria-pressed={friendsOpen || undefined}
        aria-label={`Friends${friendsUnread > 0 ? `, ${friendsUnread} request${friendsUnread > 1 ? 's' : ''}` : ''}`}
        onClick={onToggleFriends}
      >
        <I name="friends" /> Friends
        <Badge n={friendsUnread} />
        {friendsOnline != null && <span className="ponline hide-md">{friendsOnline} online</span>}
      </button>

      <button
        ref={messagesBtnRef}
        className="nb"
        style={{ position: 'relative' }}
        aria-label={`Messages${messagesUnread > 0 ? `, ${messagesUnread} unread` : ''}`}
        onClick={onOpenMessages}
      >
        <I name="mail" /> Messages
        <Badge n={messagesUnread} />
      </button>

      <div className="sep" />

      {hasElectron && (
        <>
          <button className="ib" data-tip={pinned ? 'Unpin' : 'Pin on top'}
            aria-label="Pin window on top" aria-pressed={pinned || undefined} onClick={onTogglePin}><I name="pin" /></button>
          <button className="ib" data-tip="Radio-only window" aria-label="Switch to radio-only window"
            aria-pressed={radioOnly || undefined} onClick={onToggleRadio}><I name="radio" /></button>
        </>
      )}

      <div className="sep" />

      <button ref={skinBtnRef}     className="ib sm" data-tip="Skin"     aria-label="Skin"     onClick={onOpenSkin}><I name="skin" /></button>
      <button ref={settingsBtnRef} className="ib sm" data-tip="Settings" aria-label="Settings" onClick={onOpenSettings}><I name="gear" /></button>
      <button ref={bugBtnRef}      className="ib sm" data-tip="Report a bug" aria-label="Report a bug" onClick={onOpenBug}><I name="bug" /></button>
      <DisconnectHoldButton powerBtnRef={powerBtnRef} onConfirm={onOpenDisconnect} />
    </nav>
  );
}

// Popovers anchored under the bug/power icons. Kept in this file so
// callers can mount them without a second import.
const POP_STYLE_ID = 'banner-popover-styles';
function injectPopStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(POP_STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = POP_STYLE_ID;
  s.textContent = `
@keyframes nxpop-in { from { opacity:0; transform:translateY(-4px) scale(.96) } to { opacity:1; transform:none } }
.nxpop{position:fixed;z-index:9500;background:var(--bg1);border:1px solid var(--rim1);
  box-shadow:0 18px 40px rgba(0,0,0,.6);color:var(--fg1);
  font:12px/1.45 Inter,system-ui,sans-serif;animation:nxpop-in 160ms cubic-bezier(.2,.8,.2,1)}
.nxpop h4{font:700 11px Inter;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);padding:10px 12px;border-bottom:1px solid var(--rim0)}
.nxpop .nxp-body{padding:12px}
.nxpop textarea{width:100%;height:74px;background:var(--bg0);border:1px solid var(--rim1);color:var(--fg1);padding:7px 9px;font:12px Inter;resize:vertical}
.nxpop .nxp-acts{display:flex;justify-content:flex-end;gap:8px;padding:8px 12px 12px}
.nxpop .nxp-btn{height:28px;padding:0 12px;border:1px solid var(--rim1);
  background:linear-gradient(180deg,var(--bg3),var(--bg2));color:var(--cyan);
  font:700 11px Inter;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
.nxpop .nxp-btn:hover{border-color:var(--cyan)}
.nxpop .nxp-btn.danger{color:var(--red);border-color:color-mix(in srgb,var(--red) 55%,transparent)}
.nxpop .nxp-btn.danger:hover{border-color:var(--red)}
.nxpop .nxp-link{background:none;border:0;color:var(--fg3);font:600 11px Inter;cursor:pointer}
.nxpop .nxp-link:hover{color:var(--fg0)}
.nxpop p{color:var(--fg2);font-size:12px;margin-bottom:8px}
@media (prefers-reduced-motion:reduce){ .nxpop{animation:none} }
`;
  document.head.appendChild(s);
}

export function AnchoredPopover({ anchorRef, width = 300, children, onClose, label }) {
  const panelRef = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });
  useEffect(() => { injectPopStyles(); }, []);
  useEffect(() => {
    const el = anchorRef?.current;
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const PAD = 8;
      let left = r.right - width;
      if (left < PAD) left = PAD;
      if (left + width > vw - PAD) left = vw - width - PAD;
      setPos({ top: r.bottom + 6, left });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
    // eslint-disable-next-line
  }, [anchorRef]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    const onDown = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target) &&
          !(anchorRef?.current && anchorRef.current.contains(e.target))) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [onClose, anchorRef]);
  return (
    <div ref={panelRef} className="nxpop" role="dialog" aria-label={label} style={{ top: pos.top, left: pos.left, width }}>
      {children}
    </div>
  );
}
