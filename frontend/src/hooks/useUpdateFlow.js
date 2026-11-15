// useUpdateFlow — state machine that drives the Update card and the
// Recent fixes card + reopen badge. Wraps the Electron auto-updater
// IPC, the changelog endpoint, and the first-seen bookkeeping.
//
// Returned shape:
//   { surface, state, recentReason, version, pct, bytes, totalBytes,
//     errorMessage, entries, unseenCount, hasEverSeen,
//     onDownload, onInstall, onRetry, onClose, onReopen }
//
// `surface` is one of 'none' | 'update' | 'recent'.
// `state`   is one of:
//   update:   'available' | 'downloading' | 'ready' | 'installing' | 'failed'
//   recent:   'open'
// `recentReason` is 'live' | 'updated' when surface === 'recent'.
//
// Dev switch — append ?updateDev=<state> to force a surface:
//   available | downloading | ready | installing | failed |
//   recent | recentUpdated | badge | none

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
  const [recentReason, setReason]   = useState(null);  // 'live' | 'updated'
  const [version, setVersion]       = useState(null);
  const [pct, setPct]               = useState(0);
  const [bytes, setBytes]           = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [errorMessage, setErr]      = useState(null);
  const [entries, setEntries]       = useState([]);
  // Unseen count (player-visible rows newer than last-seen id). Drives
  // the title-bar badge independent of whether the card is open.
  const [unseenCount, setUnseen]    = useState(0);
  // True once the current unseen batch has been dismissed, so the badge
  // flips to its muted outlined state ("Recent fixes").
  const [hasEverSeen, setEverSeen]  = useState(false);

  // So we can delay a card's appearance while PTT is held.
  const pendingAvailableRef = useRef(null);

  // ─── PTT bridge — track hold state so required cards wait for release.
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
      { id: 142, version: '1.4.2', date: '2026-11-07', text: 'Command chime now plays reliably for listeners' },
      { id: 141, version: '1.4.2', date: '2026-11-07', text: 'Messages no longer drop on reconnect' },
      { id: 140, version: '1.4.2', date: '2026-11-07', text: 'Roster loads faster on large channels' },
      { id: 139, version: null,    date: '2026-11-05', text: 'You can now set the radio strip opacity' },
      { id: 138, version: null,    date: '2026-11-05', text: 'Tuning confirms with a soft dot wave' },
    ];
    setEntries(fakeEntries);
    setUnseen(fakeEntries.length);
    setVersion('1.4.2');
    setPct(62);
    setBytes(71.4 * 1024 * 1024);
    setTotalBytes(115.2 * 1024 * 1024);
    if (dev === 'available')         { setSurface('update'); setState('available'); }
    else if (dev === 'downloading') { setSurface('update'); setState('downloading'); }
    else if (dev === 'ready')       { setSurface('update'); setState('ready'); }
    else if (dev === 'installing')  { setSurface('update'); setState('installing'); }
    else if (dev === 'failed')      { setSurface('update'); setState('failed'); setErr('ETIMEDOUT'); }
    else if (dev === 'recent')          { setSurface('recent'); setState('open'); setReason('live'); }
    else if (dev === 'recentUpdated')   { setSurface('recent'); setState('open'); setReason('updated'); }
    else if (dev === 'badge')           { setSurface('none');   setState(null); setEverSeen(false); }
    else { setSurface('none'); setState(null); }
  }, [dev]);

  // ─── First-launch detection + Recent fixes on mount ──────────────────
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

      setEntries(trimmed);
      setUnseen(unseen.length);
      setEverSeen(false);

      if (trimmed.length > 0) {
        setSurface('recent');
        setState('open');
        setReason(versionChanged ? 'updated' : 'live');
        if (versionChanged) setVersion(appVersion);
      } else if (versionChanged) {
        // Version bumped but no unseen entries — record the new app
        // version so we don't re-fire on the next launch.
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
      pendingAvailableRef.current = info?.version || null;
      whenReleased().then(() => {
        if (pendingAvailableRef.current === null) return;
        setSurface((s) => (s === 'update' ? s : 'update'));
        setState((st) => {
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
    // Only the recent surface is closeable; required update ignores this.
    if (surface === 'recent') {
      const newestId = entries.length > 0 ? entries[0].id : null;
      if (newestId != null) writeLS(LS_LAST_SEEN, newestId);
      if (recentReason === 'updated' && appVersion) writeLS(LS_LAST_APPVER, appVersion);
      setSurface('none');
      setState(null);
      setEverSeen(true);
      setUnseen(0);
    }
  }, [surface, recentReason, entries, appVersion]);

  // Reopen handler for the title-bar badge. Opens the same card, keeps
  // the recorded reason/entries. No chime (UpdateCard gates chimes on
  // key-change, and reopen uses the same key).
  const onReopen = useCallback(() => {
    if (entries.length === 0) return;
    setSurface('recent');
    setState('open');
    if (!recentReason) setReason('live');
  }, [entries, recentReason]);

  return {
    surface, state, recentReason, version, pct, bytes, totalBytes,
    errorMessage, entries, unseenCount, hasEverSeen,
    onDownload, onInstall, onRetry, onClose, onReopen,
  };
}
