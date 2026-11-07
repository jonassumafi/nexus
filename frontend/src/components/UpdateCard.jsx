// UpdateCard — single centered card for the whole update flow plus the
// "what is new" and "fixes since your last visit" surfaces. Required
// update states have no close affordance (no Escape, no scrim click).
//
// Surfaces:
//   update     → available | downloading | ready | installing | failed
//   whatsnew   → list card, closeable
//   fixes      → list card, closeable
//
// Driven entirely by useUpdateFlow. Mount once per view (Full, Companion).

import { useEffect } from 'react';

const TAG_LABEL = { new: 'New', better: 'Better', fix: 'Fix' };
const TAG_COLOR = { new: 'var(--lime, #44dd88)', better: 'var(--acc2, #00eeff)', fix: 'var(--amber, #ffbb33)' };
const TAG_CLASS = { new: 'n', better: 'i', fix: 'f' };

export default function UpdateCard({ flow, compact = false }) {
  const { surface, state } = flow;

  // Lock Escape for required update surfaces. Closeable surfaces handle
  // Escape themselves via onClose.
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

  const sizeClass = compact ? 'nx-uc nx-uc--sm' : 'nx-uc';
  const dismissable = surface === 'whatsnew' || surface === 'fixes';

  return (
    <>
      <style>{CSS}</style>
      <div
        className="nx-uc-scrim"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => {
          // Block pointer events to the window behind. Closeable surfaces
          // do NOT dismiss on backdrop click — only via their button.
          e.stopPropagation();
        }}
      >
        <div className={sizeClass}>
          {surface === 'update' && state === 'available' && (
            <AvailableBody version={flow.version} onDownload={flow.onDownload} />
          )}
          {surface === 'update' && state === 'downloading' && (
            <DownloadingBody
              version={flow.version}
              pct={flow.pct}
              bytes={flow.bytes}
              total={flow.totalBytes}
            />
          )}
          {surface === 'update' && state === 'ready' && (
            <ReadyBody version={flow.version} onInstall={flow.onInstall} />
          )}
          {surface === 'update' && state === 'installing' && (
            <InstallingBody version={flow.version} />
          )}
          {surface === 'update' && state === 'failed' && (
            <FailedBody
              version={flow.version}
              message={flow.errorMessage}
              onRetry={flow.onRetry}
            />
          )}
          {surface === 'whatsnew' && (
            <ListBody
              kind="new"
              version={flow.version}
              entries={flow.entries}
              onClose={flow.onClose}
            />
          )}
          {surface === 'fixes' && (
            <ListBody
              kind="fixes"
              entries={flow.entries}
              onClose={flow.onClose}
            />
          )}
          {!dismissable && null}
        </div>
      </div>
    </>
  );
}

function AvailableBody({ version, onDownload }) {
  return (
    <>
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
      <div className="nx-uc-c">Download to adopt the most recent features and fixes.</div>
      <button className="nx-uc-btn nx-uc-btn--p" onClick={onDownload} autoFocus>Download</button>
    </>
  );
}

function DownloadingBody({ version, pct, bytes, total }) {
  const totalMB = total ? (total / (1024 * 1024)) : null;
  const doneMB  = bytes ? (bytes / (1024 * 1024)) : null;
  return (
    <>
      <div className="nx-uc-c">{version ? `Updating Nexus to ${version}` : 'Updating Nexus'}</div>
      <div className="nx-uc-big">{pct}<small>%</small></div>
      <div className="nx-uc-thin"><u style={{ width: `${pct}%` }} /></div>
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
      <div className="nx-uc-c">{version ? `Installing ${version}` : 'Installing'}</div>
      <div className="nx-uc-thin nx-uc-thin--ind"><u /></div>
      <div className="nx-uc-c">Nexus will reopen by itself</div>
    </>
  );
}

function FailedBody({ version, message, onRetry }) {
  return (
    <>
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
      {(message || version) && (
        <div className="nx-uc-code">
          {message ? `${message}` : 'update-error'}{version ? ` · v${version}` : ''}
        </div>
      )}
      <button className="nx-uc-btn nx-uc-btn--p" onClick={onRetry} autoFocus>Retry</button>
    </>
  );
}

function ListBody({ kind, version, entries, onClose }) {
  const eyebrow = kind === 'new'
    ? { className: 'nx-uc-eb nx-uc-eb--g', text: version ? `Updated to ${version}` : 'Updated' }
    : { className: 'nx-uc-eb', text: 'Fixes since your last visit' };
  const title = kind === 'new' ? 'What is new' : 'Recent fixes';
  const btnText = kind === 'new' ? 'Continue' : 'Got it';
  const footer = kind === 'new' ? null : 'Already applied. No restart needed.';

  return (
    <div className="nx-uc-list">
      <div>
        <div className={eyebrow.className}>{eyebrow.text}</div>
        <div className="nx-uc-h2">{title}</div>
      </div>
      <ul className="nx-uc-nl">
        {entries.map((e) => (
          <li key={e.id}>
            <span className={`nx-uc-tag nx-uc-tag--${TAG_CLASS[e.tag] || 'i'}`}>
              {TAG_LABEL[e.tag] || e.tag}
            </span>
            <span>{e.text}</span>
          </li>
        ))}
      </ul>
      {footer && <div className="nx-uc-c">{footer}</div>}
      <button className="nx-uc-btn nx-uc-btn--p" onClick={onClose} autoFocus>{btnText}</button>
    </div>
  );
}

const CSS = `
.nx-uc-scrim {
  position: fixed; inset: 0; z-index: 9998;
  background: color-mix(in srgb, var(--bg0, #020C14) 66%, transparent);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
  padding: 14px;
  font-family: Inter, system-ui, sans-serif;
}
.nx-uc {
  width: 100%; max-width: 420px;
  padding: 36px 32px 28px;
  border-radius: 10px;
  background: var(--bg1, #061018);
  border: 1px solid var(--rim1, #2A5A7A);
  box-shadow: 0 24px 50px rgba(0,0,0,.65);
  display: grid; gap: 18px;
  text-align: center;
  color: var(--fg0, #f2f6f8);
  animation: nx-uc-in .28s cubic-bezier(.2,.8,.2,1);
}
.nx-uc--sm {
  max-width: 300px; padding: 18px 14px 14px; gap: 11px;
}
@keyframes nx-uc-in { from { opacity: 0; transform: translateY(10px) scale(.97); } }
@media (prefers-reduced-motion: reduce) { .nx-uc { animation: none; } }

.nx-uc-ttl { font: 700 17px Inter, system-ui, sans-serif; letter-spacing: .01em; }
.nx-uc--sm .nx-uc-ttl { font-size: 15px; }
.nx-uc-sub { font: 500 12px/1.5 Inter, system-ui, sans-serif; color: var(--fg2, #8a98a4); margin-top: 3px; }
.nx-uc-c { font: 500 12px/1.5 Inter, system-ui, sans-serif; color: var(--fg2, #8a98a4); }
.nx-uc-c--center { text-align: center; }

.nx-uc-big {
  font: 800 66px/1 Inter, system-ui, sans-serif;
  letter-spacing: -.02em;
  font-variant-numeric: tabular-nums;
  color: var(--fg0, #f2f6f8);
}
.nx-uc-big small { font: 600 20px Inter, system-ui, sans-serif; color: var(--fg2, #8a98a4); margin-left: 2px; }
.nx-uc--sm .nx-uc-big { font-size: 44px; }
.nx-uc--sm .nx-uc-big small { font-size: 16px; }

.nx-uc-thin {
  height: 4px; border-radius: 2px;
  background: var(--rim0, #1A3A50); overflow: hidden;
}
.nx-uc-thin u {
  display: block; height: 100%;
  background: linear-gradient(90deg, var(--acc, #66AADD), var(--acc2, #00EEFF));
  transition: width .25s linear;
}
.nx-uc-thin--ind u { width: 30%; animation: nx-uc-sl 1.1s ease-in-out infinite; }
@keyframes nx-uc-sl { 0% { margin-left: -30%; } 100% { margin-left: 100%; } }

.nx-uc-chk {
  width: 62px; height: 62px; border-radius: 50%;
  margin: 0 auto;
  display: grid; place-items: center;
  border: 2px solid var(--lime, #44dd88);
  color: var(--lime, #44dd88);
}
.nx-uc--sm .nx-uc-chk { width: 48px; height: 48px; }
.nx-uc-chk--er { border-color: var(--red, #ff5544); color: var(--red, #ff5544); }
.nx-uc-chk--info { border-color: var(--acc2, #00EEFF); color: var(--acc2, #00EEFF); }
.nx-uc-chk svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.nx-uc--sm .nx-uc-chk svg { width: 20px; height: 20px; }

.nx-uc-btn {
  width: 100%; height: 42px;
  padding: 0 16px;
  font: 700 12px Inter, system-ui, sans-serif; letter-spacing: .03em;
  border: 1px solid var(--rim1, #2A5A7A);
  border-radius: 6px;
  color: var(--fg0, #f2f6f8);
  background: linear-gradient(180deg, var(--bg3, #12263A), var(--bg2, #0A1828));
  cursor: pointer;
  transition: transform .08s, box-shadow .08s, border-color .08s;
}
.nx-uc--sm .nx-uc-btn { height: 38px; font-size: 11px; }
.nx-uc-btn:hover { border-color: var(--acc, #66AADD); }
.nx-uc-btn:active { transform: translateY(1px); }
.nx-uc-btn--p {
  background: linear-gradient(180deg, color-mix(in srgb, var(--acc, #66AADD) 42%, var(--bg2, #0A1828)), color-mix(in srgb, var(--acc, #66AADD) 18%, var(--bg1, #061018)));
  border-color: var(--acc, #66AADD);
}

.nx-uc-code {
  font: 500 11px/1.5 ui-monospace, Menlo, Consolas, monospace;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--bg0, #020C14) 60%, #000);
  border: 1px solid var(--rim0, #1A3A50);
  border-radius: 3px;
  color: var(--fg2, #8a98a4);
  text-align: left;
  overflow-wrap: anywhere;
}

.nx-uc-list { text-align: left; display: grid; gap: 14px; }
.nx-uc-eb {
  font: 700 10.5px Inter, system-ui, sans-serif;
  letter-spacing: .1em; text-transform: uppercase;
  color: var(--fg2, #8a98a4);
}
.nx-uc-eb--g { color: var(--lime, #44dd88); }
.nx-uc-h2 {
  font: 800 22px/1.2 Inter, system-ui, sans-serif;
  margin-top: 2px;
  color: var(--fg0, #f2f6f8);
}
.nx-uc--sm .nx-uc-h2 { font-size: 18px; }

.nx-uc-nl { list-style: none; display: grid; }
.nx-uc-nl li {
  display: flex; gap: 10px; align-items: baseline;
  padding: 9px 0;
  border-top: 1px solid var(--rim0, #1A3A50);
  font: 500 12.5px/1.4 Inter, system-ui, sans-serif;
  color: var(--fg0, #f2f6f8);
}
.nx-uc-nl li:first-child { border-top: 0; }
.nx-uc-nl li span:last-child { min-width: 0; overflow-wrap: anywhere; }
.nx-uc-tag {
  flex: none; width: 62px;
  font: 700 9px Inter, system-ui, sans-serif;
  letter-spacing: .1em; text-transform: uppercase;
  text-align: center;
  padding: 2px 0;
  border-radius: 2px;
  border: 1px solid;
}
.nx-uc-tag--n { color: var(--lime, #44dd88); border-color: color-mix(in srgb, var(--lime, #44dd88) 50%, transparent); }
.nx-uc-tag--f { color: var(--amber, #ffbb33); border-color: color-mix(in srgb, var(--amber, #ffbb33) 50%, transparent); }
.nx-uc-tag--i { color: var(--acc2, #00EEFF); border-color: color-mix(in srgb, var(--acc2, #00EEFF) 45%, transparent); }
.nx-uc--sm .nx-uc-tag { width: 52px; }

`;
