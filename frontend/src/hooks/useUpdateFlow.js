// useUpdateFlow — state machine that drives the Update card and Radio
// title-bar pill. Wraps the Electron auto-updater IPC, the changelog
// endpoint, and the first-seen bookkeeping.
//
// Returned shape:
//   { surface, state, version, pct, bytes, totalBytes, errorMessage,
//     entries, previousVersion, onDownload, onInstall, onRetry, onClose }
//
// `surface` is one of 'none' | 'update' | 'whatsnew' | 'fixes'.
// `state`   is one of:
//   update:    'available' | 'downloading' | 'ready' | 'installing' | 'failed'
//   whatsnew:  'new'                 // first launch of new app version
//   fixes:     'fixes'               // web-only fixes since last visit
//
// Dev switch — append ?updateDev=<state> to force a surface:
//   available | downloading | ready | installing | failed | new | fixes | first | none

import { useCallback, useEffect, useRef, useState } from 'react';
import { pttHold, pttRelease, whenReleased } from '../utils/pttGate';

const LS_LAST_SEEN   = 'nexus_last_seen_changelog_id';
const LS_LAST_APPVER = 'nexus_last_app_version';

function readLS(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLS(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {}
}

function devOverride() {
  try {
    const q = new URLSearchParams(window.location.search).get('updateDev');
    return q || null;
  } catch { return null; }
}

async function fetchChangelog(since) {
  const url = since != null
    ? `/api/changelog?since=${encodeURIComponent(since)}&limit=50`
    : `/api/changelog?limit=50`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`changelog ${res.status}`);
  return res.json();
}

export default function useUpdateFlow() {
  const electron = typeof window !== 'undefined' ? window.electronAPI : null;
  const appVersion = electron?.companion?.version || null;

  const [surface, setSurface]       = useState('none');
  const [state, setState]           = useState(null);
  const [version, setVersion]       = useState(null);
  const [pct, setPct]               = useState(0);
  const [bytes, setBytes]           = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [errorMessage, setErr]      = useState(null);
  const [entries, setEntries]       = useState([]);
  const [previousVersion, setPrev]  = useState(null);

  // So we can delay a card's appearance while PTT is held.
  const pendingAvailableRef = useRef(null);

  // ─── PTT bridge — track hold state so required cards wait for release.
  // The Electron shell emits nexus:ptt down/up from the OS-level key hook.
  useEffect(() => {
    const off = electron?.onPTT?.((payload) => {
      if (payload?.down) pttHold();
      else pttRelease();
    });
    return () => { try { off?.(); } catch {} };
  }, [electron]);

  // ─── Dev override ────────────────────────────────────────────────────
  const dev = typeof window !== 'undefined' ? devOverride() : null;

  useEffect(() => {
    if (!dev) return;
    const fakeEntries = [
      { id: 142, version: '1.4.2', date: '2026-11-07', tag: 'new',    text: 'Compact twin tile radios' },
      { id: 141, version: '1.4.2', date: '2026-11-07', tag: 'better', text: 'Unread badge on Messages' },
      { id: 140, version: '1.4.2', date: '2026-11-07', tag: 'fix',    text: 'One window at startup' },
      { id: 139, version: null,    date: '2026-11-05', tag: 'fix',    text: 'Messages no longer drop on reconnect' },
      { id: 138, version: null,    date: '2026-11-05', tag: 'better', text: 'Faster roster loading on large channels' },
    ];
    setEntries(fakeEntries);
    setVersion('1.4.2');
    setPrev('1.4.1');
    setPct(62);
    if (dev === 'available')   { setSurface('update'); setState('available'); }
    else if (dev === 'downloading') { setSurface('update'); setState('downloading'); }
    else if (dev === 'ready')  { setSurface('update'); setState('ready'); }
    else if (dev === 'installing') { setSurface('update'); setState('installing'); }
    else if (dev === 'failed') { setSurface('update'); setState('failed'); setErr('update-error: ETIMEDOUT · v1.4.2'); }
    else if (dev === 'new')    { setSurface('whatsnew'); setState('new'); }
    else if (dev === 'fixes')  { setSurface('fixes'); setState('fixes'); }
    else { setSurface('none'); setState(null); }
  }, [dev]);

  // ─── First-launch detection + "what's new" / fixes on mount ────────
  useEffect(() => {
    if (dev) return;
    let cancelled = false;

    (async () => {
      const lastVer = readLS(LS_LAST_APPVER);
      const lastSeenRaw = readLS(LS_LAST_SEEN);
      const lastSeen = lastSeenRaw != null ? Number(lastSeenRaw) : null;
      const firstEver = lastVer == null && lastSeenRaw == null;

      let data;
      try { data = await fetchChangelog(); }
      catch { return; }
      if (cancelled) return;

      const all = Array.isArray(data?.entries) ? data.entries : [];
      const newestId = data?.newestId ?? (all[0]?.id ?? 0);

      // Brand new install — mark everything seen, show nothing.
      if (firstEver) {
        writeLS(LS_LAST_SEEN, newestId);
        if (appVersion) writeLS(LS_LAST_APPVER, appVersion);
        return;
      }

      const versionChanged = !!(appVersion && lastVer && appVersion !== lastVer);
      const unseen = Number.isFinite(lastSeen)
        ? all.filter(e => e.id > lastSeen)
        : [];
      const trimmed = unseen.slice(0, 5);

      if (versionChanged && trimmed.length > 0) {
        setEntries(trimmed);
        setPrev(lastVer);
        setVersion(appVersion);
        setSurface('whatsnew');
        setState('new');
      } else if (!versionChanged && trimmed.length > 0) {
        setEntries(trimmed);
        setSurface('fixes');
        setState('fixes');
      } else if (versionChanged) {
        // Version bumped but no unseen entries — nothing to show, but
        // still record the new app version.
        writeLS(LS_LAST_APPVER, appVersion);
      }
    })();

    return () => { cancelled = true; };
  }, [dev, appVersion]);

  // ─── Auto-updater IPC subscription ─────────────────────────────────
  useEffect(() => {
    if (dev) return;
    const api = electron?.update;
    if (!api) return;

    const offs = [];

    offs.push(api.on('available', (info) => {
      setVersion(info?.version || null);
      setErr(null);
      // Defer card open if PTT is held — the player is mid-transmission.
      pendingAvailableRef.current = info?.version || null;
      whenReleased().then(() => {
        if (pendingAvailableRef.current === null) return;
        setSurface((s) => (s === 'update' ? s : 'update'));
        setState((st) => {
          // Don't stomp a later state (downloading/ready) that may have
          // raced ahead between release and resume.
          if (st === 'downloading' || st === 'ready' || st === 'installing') return st;
          return 'available';
        });
        pendingAvailableRef.current = null;
      });
    }));

    offs.push(api.on('progress', (p) => {
      setSurface('update');
      setState('downloading');
      setPct(Math.max(0, Math.min(100, Math.round(p?.percent || 0))));
      setBytes(p?.transferred || 0);
      setTotalBytes(p?.total || 0);
    }));

    offs.push(api.on('ready', (info) => {
      setVersion(info?.version || null);
      setSurface('update');
      setState('ready');
    }));

    offs.push(api.on('error', (e) => {
      // Only a failed *download* flips the card to Failed. Offline/
      // transient errors while sitting on Available or Ready (including
      // the 0.9.25 shell's periodic re-checks, which skip while ready)
      // leave those surfaces alone — the download itself hasn't gone
      // wrong. Idle errors (no active surface) never open a card.
      setState((st) => {
        if (st === 'downloading') {
          setSurface('update');
          setErr(e?.message || 'Update error');
          return 'failed';
        }
        return st;
      });
    }));

    return () => { for (const off of offs) try { off?.(); } catch {} };
  }, [dev, electron]);

  // ─── Actions ───────────────────────────────────────────────────────
  const onDownload = useCallback(async () => {
    if (dev) { setState('downloading'); return; }
    try {
      setErr(null);
      setPct(0);
      setState('downloading');
      await electron?.update?.download?.();
    } catch (err) {
      setErr(err?.message || String(err));
      setState('failed');
    }
  }, [dev, electron]);

  const onInstall = useCallback(() => {
    if (dev) { setState('installing'); return; }
    setState('installing');
    try { electron?.update?.installNow?.(); } catch {}
  }, [dev, electron]);

  const onRetry = useCallback(() => { onDownload(); }, [onDownload]);

  const onClose = useCallback(() => {
    // Only the whatsnew/fixes surfaces are closeable; required updates
    // ignore this call.
    if (surface === 'whatsnew' || surface === 'fixes') {
      // Record the newest id as seen so we don't show again.
      const newestId = entries.length > 0 ? entries[0].id : null;
      if (newestId != null) writeLS(LS_LAST_SEEN, newestId);
      if (surface === 'whatsnew' && appVersion) writeLS(LS_LAST_APPVER, appVersion);
      setSurface('none');
      setState(null);
    }
  }, [surface, entries, appVersion]);

  return {
    surface, state, version, pct, bytes, totalBytes,
    errorMessage, entries, previousVersion,
    onDownload, onInstall, onRetry, onClose,
  };
}
