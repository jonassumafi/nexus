// UpdateCard — single centered card for the whole update flow and the
// Recent fixes card. Required update states have no close affordance
// (no Escape, no scrim click). The Recent fixes surface is closeable.
//
// Surfaces:
//   update  → available | downloading | ready | installing | failed
//   recent  → one list card, closeable; eyebrow reads either
//             "LIVE NOW" (same app version, web-only lines) or
//             "UPDATED TO <version>" (after an installer update)
//
// Driven entirely by useUpdateFlow. Mount once inside the Full dashboard
// only. Radio-only and Chat popout do NOT mount this component, so they
// never surface update UI or chimes.

import { useEffect, useRef } from 'react';

// Splash-style bracket mark: circle + dot + cross. 30x30 viewBox so the
// stroke proportions match the splash exactly.
const BracketMark = ({ size = 22 }) => (
  <svg
    viewBox="0 0 30 30"
    width={size}
    height={size}
    aria-hidden="true"
    style={{ fill: 'none', stroke: 'var(--acc2)', strokeWidth: 1.6, flex: 'none' }}
  >
    <circle cx="15" cy="15" r="11" />
    <circle cx="15" cy="15" r="5" />
    <path d="M15 1v6M15 23v6M1 15h6M23 15h6" strokeLinecap="round" />
  </svg>
);

// 24-segment rule, lime-on-rim0 like the splash's segmented bar.
function SegRule({ fill = 24 }) {
  const cells = [];
  for (let i = 0; i < 24; i++) {
    cells.push(<i key={i} className={`nx-uc-seg-i ${i < fill ? 'on' : ''}`} />);
  }
  return <div className="nx-uc-seg">{cells}</div>;
}

function Brand({ label = '', trailing = '' }) {
  return (
    <div className="nx-uc-brand">
      <BracketMark />
      <b>NEXUS</b>
      {label && <span className="nx-uc-brand-lbl">{label}</span>}
      {trailing && <span className="nx-uc-brand-tr">{trailing}</span>}
    </div>
  );
}

export default function UpdateCard({ flow }) {
  const { surface, state } = flow;

  // Notification chime. Fires exactly when the badge appears on screen,
  // because this component is only mounted inside the Full dashboard;
  // Radio-only and the installer launcher never render it, so neither
  // ever makes noise. Keyed per surface so each distinct notification
  // chimes only once. Focus-gated.
  //
  //   surface=update → update_tone.wav
  //   surface=recent → feature_tone.wav
  const chimedKeyRef = useRef(null);
  useEffect(() => {
    if (surface === 'none') return;
    let src = null;
    let key = null;
    if (surface === 'update') {
      src = '/sounds/update_tone.wav';
      key = `update:${flow.version || 'unknown'}`;
    } else if (surface === 'recent') {
      src = '/sounds/feature_tone.wav';
      const newestId = flow.entries?.[0]?.id ?? null;
      key = `recent:${newestId ?? 'none'}`;
    }
    if (!src || !key || chimedKeyRef.current === key) return;

    const play = () => {
      if (chimedKeyRef.current === key) return;
      chimedKeyRef.current = key;
      try {
        const snd = new Audio(src);
        snd.volume = 0.6;
        snd.play().catch(() => {});
      } catch {}
    };

    const focused = typeof document !== 'undefined'
      && document.visibilityState !== 'hidden'
      && document.hasFocus();
    if (focused) { play(); return; }

    const onReady = () => {
      if (document.visibilityState !== 'hidden' && document.hasFocus()) {
        play();
        cleanup();
      }
    };
    const cleanup = () => {
      window.removeEventListener('focus', onReady);
      document.removeEventListener('visibilitychange', onReady);
    };
    window.addEventListener('focus', onReady);
    document.addEventListener('visibilitychange', onReady);
    return cleanup;
  }, [surface, flow.version, flow.entries]);

  // Lock Escape for required update surfaces. Recent surface handles
  // Escape via onClose.
  useEffect(() => {
    if (surface === 'none') return;
    const isRequired = surface === 'update';
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (isRequired) { e.preventDefault(); e.stopPropagation(); return; }
      flow.onClose?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [surface, flow]);

  if (surface === 'none') return null;

  const isUpdate = surface === 'update';
  const isRecent = surface === 'recent';

  return (
    <>
      <style>{CSS}</style>
      <div
        className="nx-uc-scrim"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => {
          // Block pointer events to the window behind. No backdrop
          // dismiss for any surface — close via the card button.
          e.stopPropagation();
        }}
      >
        <div className={`nx-uc ${isUpdate ? 'nx-uc--ctr' : ''}`}>
          {isUpdate && state === 'available' && (
            <AvailableBody version={flow.version} onDownload={flow.onDownload} />
          )}
          {isUpdate && state === 'downloading' && (
            <DownloadingBody
              version={flow.version}
              pct={flow.pct}
              bytes={flow.bytes}
              total={flow.totalBytes}
            />
          )}
          {isUpdate && state === 'ready' && (
            <ReadyBody version={flow.version} onInstall={flow.onInstall} />
          )}
          {isUpdate && state === 'installing' && (
            <InstallingBody version={flow.version} />
          )}
          {isUpdate && state === 'failed' && (
            <FailedBody
              version={flow.version}
              message={flow.errorMessage}
              onRetry={flow.onRetry}
            />
          )}
          {isRecent && (
            <RecentBody
              reason={flow.recentReason}
              version={flow.version}
              entries={flow.entries}
              onClose={flow.onClose}
            />
          )}
        </div>
      </div>
    </>
  );
}

function AvailableBody({ version, onDownload }) {
  return (
    <>
      <Brand label="update" />
      <SegRule fill={0} />
      <div className="nx-uc-chk nx-uc-chk--info">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 20h14" />
        </svg>
      </div>
      <div>
        <div className="nx-uc-ttl">Update available</div>
        <div className="nx-uc-sub">
          {version ? `Version ${version} is ready to download` : 'A newer version is ready to download'}
        </div>
      </div>
      <button className="nx-uc-btn nx-uc-btn--p" onClick={onDownload} autoFocus>Download</button>
    </>
  );
}

function DownloadingBody({ version, pct, bytes, total }) {
  const totalMB = total ? (total / (1024 * 1024)) : null;
  const doneMB  = bytes ? (bytes / (1024 * 1024)) : null;
  // Fill ratio for the 24-seg bar.
  const fill = Math.max(0, Math.min(24, Math.round((pct / 100) * 24)));
  return (
    <>
      <Brand label="update" />
      <div className="nx-uc-c">{version ? `Updating Nexus to ${version}` : 'Updating Nexus'}</div>
      <div className="nx-uc-big">{pct}<small>%</small></div>
      <SegRule fill={fill} />
      <div className="nx-uc-c">
        {totalMB && doneMB
          ? `${doneMB.toFixed(1)} of ${totalMB.toFixed(1)} MB`
          : 'Downloading…'}
      </div>
    </>
  );
}

function ReadyBody({ version, onInstall }) {
  return (
    <>
      <Brand label="update" />
      <SegRule fill={24} />
      <div className="nx-uc-chk">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      </div>
      <div>
        <div className="nx-uc-ttl">Update downloaded</div>
        <div className="nx-uc-sub">{version ? `Version ${version} is ready` : 'Ready to install'}</div>
      </div>
      <button className="nx-uc-btn nx-uc-btn--p" onClick={onInstall} autoFocus>Install and restart</button>
      <div className="nx-uc-c">Restarting drops the radio for about ten seconds.</div>
    </>
  );
}

function InstallingBody({ version }) {
  return (
    <>
      <Brand label="update" />
      <div className="nx-uc-c">{version ? `Installing ${version}` : 'Installing'}</div>
      <SegRule fill={12} />
      <div className="nx-uc-c">Nexus will reopen by itself</div>
    </>
  );
}

function FailedBody({ version, message, onRetry }) {
  return (
    <>
      <Brand label="update" />
      <div className="nx-uc-chk nx-uc-chk--er">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 7v6M12 16.6v.1" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </div>
      <div>
        <div className="nx-uc-ttl">Update did not finish</div>
        <div className="nx-uc-sub">Your current version still works. Check your connection and try again.</div>
      </div>
      <div className="nx-uc-code">
        update-error: {message || 'unknown'}{version ? ` · v${version}` : ''}
      </div>
      <button className="nx-uc-btn nx-uc-btn--p" onClick={onRetry} autoFocus>Retry</button>
    </>
  );
}

function RecentBody({ reason, version, entries, onClose }) {
  const eyebrow = reason === 'updated'
    ? `UPDATED TO ${version || ''}`.trim()
    : 'LIVE NOW';
  const footer = reason === 'updated'
    ? 'Installed. You are on the latest version.'
    : 'No restart needed. Already applied.';

  return (
    <>
      <Brand label="recent fixes" />
      <SegRule fill={24} />
      <div>
        <div className="nx-uc-eb">{eyebrow}</div>
        <div className="nx-uc-h2">Recent fixes</div>
      </div>
      <ul className="nx-uc-bl">
        {entries.map((e) => (
          <li key={e.id}>{e.text}</li>
        ))}
      </ul>
      <div className="nx-uc-c nx-uc-c--mono">{footer}</div>
      <button className="nx-uc-btn nx-uc-btn--p" onClick={onClose} autoFocus>Got it</button>
    </>
  );
}

const CSS = `
.nx-uc-scrim {
  position: fixed; inset: 0; z-index: 9998;
  background: color-mix(in srgb, var(--bg0) 66%, transparent);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
  padding: 14px;
  font-family: Inter, system-ui, sans-serif;
}
.nx-uc {
  width: 100%; max-width: 420px;
  padding: 18px 18px 16px;
  border-radius: 10px;
  background: var(--bg1);
  border: 1px solid var(--rim1);
  box-shadow: 0 24px 50px rgba(0,0,0,.65);
  display: grid; gap: 13px;
  text-align: left;
  color: var(--t1);
  animation: nx-uc-in .28s cubic-bezier(.2,.8,.2,1);
}
.nx-uc--ctr { text-align: center; }
.nx-uc--ctr .nx-uc-brand { justify-content: center; }
.nx-uc--ctr .nx-uc-c { text-align: center; }
@keyframes nx-uc-in { from { opacity: 0; transform: translateY(10px) scale(.97); } }
@media (prefers-reduced-motion: reduce) { .nx-uc { animation: none; } }

.nx-uc-brand {
  display: flex; align-items: center; gap: 9px;
}
.nx-uc-brand b {
  font: 800 11px Inter, system-ui, sans-serif;
  letter-spacing: .3em;
  color: var(--t1);
}
.nx-uc-brand-lbl {
  font: 700 10px Inter, system-ui, sans-serif;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--t2);
}
.nx-uc-brand-tr {
  margin-left: auto;
  font: 500 10px ui-monospace, Menlo, Consolas, monospace;
  color: var(--t3);
}

.nx-uc-seg {
  display: grid; grid-template-columns: repeat(24, 1fr); gap: 3px;
}
.nx-uc-seg-i {
  height: 4px; background: var(--rim0); border-radius: 1px;
}
.nx-uc-seg-i.on {
  background: linear-gradient(90deg, var(--lime), color-mix(in srgb, var(--lime) 55%, var(--acc2)));
}

.nx-uc-ttl { font: 700 17px Inter, system-ui, sans-serif; letter-spacing: .01em; }
.nx-uc-sub { font: 500 12px/1.5 Inter, system-ui, sans-serif; color: var(--t2); margin-top: 3px; }
.nx-uc-c {
  font: 500 12px/1.5 Inter, system-ui, sans-serif;
  color: var(--t2);
}
.nx-uc-c--mono {
  font: 500 11px ui-monospace, Menlo, Consolas, monospace;
  color: var(--t3);
}

.nx-uc-big {
  font: 800 54px/1 Inter, system-ui, sans-serif;
  letter-spacing: -.02em;
  font-variant-numeric: tabular-nums;
  color: var(--t1);
  text-align: center;
}
.nx-uc-big small { font: 600 20px Inter, system-ui, sans-serif; color: var(--t2); margin-left: 2px; }

.nx-uc-chk {
  width: 54px; height: 54px; border-radius: 50%;
  margin: 0 auto;
  display: grid; place-items: center;
  border: 2px solid var(--lime);
  color: var(--lime);
}
.nx-uc-chk--er { border-color: var(--red); color: var(--red); }
.nx-uc-chk--info { border-color: var(--acc2); color: var(--acc2); }
.nx-uc-chk svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }

.nx-uc-btn {
  width: 100%; height: 40px;
  padding: 0 16px;
  font: 700 12px Inter, system-ui, sans-serif; letter-spacing: .03em;
  border: 1px solid var(--rim1);
  border-radius: 6px;
  color: var(--t1);
  background: linear-gradient(180deg, var(--bg3), var(--bg2));
  box-shadow: 0 3px 0 var(--under);
  cursor: pointer;
  transition: transform .08s, box-shadow .08s, border-color .08s;
}
.nx-uc-btn:hover { border-color: var(--acc); }
.nx-uc-btn:active { transform: translateY(1px); box-shadow: 0 1px 0 var(--under); }
.nx-uc-btn--p {
  background: linear-gradient(180deg, color-mix(in srgb, var(--acc) 42%, var(--bg2)), color-mix(in srgb, var(--acc) 18%, var(--bg1)));
  border-color: var(--acc);
}

.nx-uc-code {
  font: 500 11px/1.5 ui-monospace, Menlo, Consolas, monospace;
  padding: 6px 8px;
  background: var(--inset);
  border: 1px solid var(--rim0);
  border-radius: 3px;
  color: var(--t2);
  text-align: left;
  overflow-wrap: anywhere;
}

.nx-uc-eb {
  font: 700 10px ui-monospace, Menlo, Consolas, monospace;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--lime);
  text-align: left;
}
.nx-uc-h2 {
  font: 800 20px/1.2 Inter, system-ui, sans-serif;
  margin-top: 2px;
  color: var(--t1);
  text-align: left;
}

.nx-uc-bl { list-style: none; display: grid; margin: 0; padding: 0; text-align: left; }
.nx-uc-bl li {
  position: relative;
  padding: 8px 0 8px 18px;
  border-top: 1px solid var(--rim0);
  font: 500 12.5px/1.45 Inter, system-ui, sans-serif;
  color: var(--t1);
}
.nx-uc-bl li:first-child { border-top: 0; }
.nx-uc-bl li::before {
  content: "";
  position: absolute; left: 2px; top: 14px;
  width: 6px; height: 6px;
  background: var(--lime);
  box-shadow: 0 0 6px color-mix(in srgb, var(--lime) 70%, transparent);
}
`;
