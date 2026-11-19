# Known Issues

Tracked for future fixes. Each entry: symptom, expected behavior, where
to start digging, and current status.

---

## 1. Command radio pre-chirp doesn't play on the RX side

**Symptom.** When I receive a transmission on the Command radio, I do
NOT hear the "beep-beep-beep-beep" cue that's supposed to play before
the transmitter's voice. The people receiving my transmissions,
however, do hear it correctly. So the chime fires on the sender's
side but not on the listener's side for me.

**Expected behavior.** The pre-chirp should play in BOTH directions —
sender hears it when they key up, and receivers hear it before the
transmitter's voice arrives. The sound should precede the voice by a
short moment, not overlap with it.

**Where to look first.**
- `frontend/src/hooks/useCommandTunerRx.js:584-600` — `onPttStart`
  handler already comments that it fires the RX-side chime but only
  when `prev.length === 0 && !isPTTActive` (first peer going live and
  I'm not transmitting myself). That gate may be too tight; if any
  earlier transmission left a stale id in `transmittingIds`, the
  branch is skipped on the next real incoming peer.
- Compare to the Crew UDP equivalent in `useRadioConnectionUDP.js`
  receive handler — the Crew side appears to work for the user, so
  the two code paths probably diverged.
- Also verify `audioCtxRef.current.state === 'running'` at the moment
  of playback — a suspended context will consume the play call but
  emit nothing. The comment at line 596 says Chromium can auto-suspend
  the context even when the chain was alive moments earlier.

**Status.** Logged for future fix. Not yet triaged with live
reproduction.

---

## 3. Voice doesn't cross Full ↔ Radio-only views

**Symptom.** Three operators testing Crew voice together. They can
hear each other ONLY when all three are in the same view. The moment
one jumps from Radio-only to Full (or vice versa), that person is
lost to the other two — no voice in either direction until they come
back to the same view.

**Expected behavior.** A player on Full and a player on Radio-only
tuned to the same frequency should hear each other. View choice is
just UI; the voice layer should be identical.

**Where to look first.**
- Full and Radio-only mount DIFFERENT top-level components:
  `pages/Dashboard.jsx` → `useRadioConnectionUDP` for Crew.
  `components/RadioTwinTiles.jsx` → also calls `useRadioConnectionUDP`,
  but as a separate hook instance in a separate window.
- The two views each live in their own BrowserWindow (`mainWindow` vs
  `radioWindow`, see `electron/src/main.js:createRadioWindow`). Each
  window's renderer is a separate Chromium process with its own socket
  and its own UDP session. On a view switch the active window
  changes; the inactive one's socket disconnects and leaves the
  frequency room. The newly-active window joins fresh.
- That handoff is where the race is. Probable candidates:
  1. Both windows briefly claim to be in the same frequency room, or
     the leaving window's `radio:leave` fires AFTER the new window's
     `radio:join`, making the server kick the new session out as a
     duplicate.
  2. Server-side (`backend/services/socketManager.js` `radio:join`
     handler + any dedupe-per-user logic) may evict existing sockets
     on the same frequency for the same userId, taking the old one
     down after the new one tried to join. Grep for `evict`, `kick`,
     `replace`, `dup`.
  3. The `electronAPI.udp.open` / `close` IPC in `main.js` only tracks
     ONE live session globally. When the second view opens UDP it
     closes the first — but if the first is still the "current" one
     in the udp-voice module, the second's RX forwarder gets
     installed on a session the main process immediately closes.
- Historical context: commits `6953dc1` (Companion removal) and
  `2e0a266` (stop closing AudioContext) were landed specifically to
  fix a version of this bug for Companion. The same class of race
  may have re-surfaced for the Full ↔ Radio-only pair.

**Status.** Logged for future fix. Not yet triaged with live
reproduction.

---

## 4. Stale peer list + possibly empty frequency field after view switch

**Symptom.** After switching between Full dashboard and Radio-only
and back, the roster/peer list on Full shows the player names from a
previous frequency rather than the ones on the currently-tuned
frequency. The frequency itself appears to be preserved across the
switch (as expected), BUT the user suspects they had to re-type
their frequency back into the LCD input after returning from
Radio-only to Full. This second half is unconfirmed — may just be a
display glitch where the input renders empty even though the engine
is still tuned.

**Expected behavior.** On a view switch:
- Tuned frequency persists and is displayed correctly in every input
  field (no re-typing required).
- Peer / roster list reflects only the peers currently on that
  frequency — no stale names from a prior session.

**Where to look first.**
- Roster staleness is very likely connected to issue #3 — when the
  arriving window joins the room, the departing window hasn't fully
  left, so both roster snapshots are in flight and the newcomer
  shows a mix. Check how `radioPeers` is seeded on the newly-active
  window:
  `frontend/src/hooks/useRadioConnectionUDP.js` — the join handler
  should wipe `peersRef.current` and seed from the server's latest
  room members. If the hook re-uses a persisted state from a prior
  mount, that's the stale list.
- The dedupe helper `frontend/src/utils/peerList.js` (added in
  `27b0115`) should still be deduping by userId; verify it isn't
  letting stale entries from the old frequency through.
- For the LCD-field display question: check whether
  `pages/Dashboard.jsx`'s radio-state lift (`tunedFrequency`) is
  being re-read from the persisted saved-frequency store on view
  remount. The RadioModule's `freqInput` starts from the `freq`
  prop (see `components/RadioModule.jsx`); if the parent passes an
  empty string during the brief re-mount window, the LCD shows
  empty even though the engine is tuned. Compare to how
  `components/CrewRadioCard.jsx` seeds `freq` from
  `tunedFrequency` on mount.
- Also check that the `nexus:window-state` broadcast to the newly-
  active window fires BEFORE the renderer renders its first frame,
  otherwise the freq input won't have its initial value.

**Status.** Logged for future fix. Not yet triaged. Possibly
partially overlaps with issue #3's root cause.

---

## 2. Player names don't light up when transmitting on Command (maybe Crew too)

**Symptom.** On the Command radio, when a peer is transmitting, their
name in the roster / peer list doesn't light up or get a TX indicator.
Unclear whether Crew has the same bug — needs confirmation on the
next test.

**Expected behavior.** Any peer currently transmitting should be
visually highlighted in the roster — lime dot, color change, or
whatever the existing TX indicator is. Matches how Crew is
documented to behave.

**Where to look first.**
- `frontend/src/hooks/useCommandTunerRx.js` — `transmittingIds` state
  is set from `onPttStart` / `onPttStop` payloads. Verify it's being
  populated.
- `frontend/src/components/CommandRadioCard.jsx` — check the
  `transmittingPeerIds` prop flow from the hook to the UI; the roster
  render may be reading a stale or wrong field.
- Compare the Crew flow in `useRadioConnectionUDP.js` and
  `CrewRadioCard.jsx` — if Crew works, the difference between the
  two paths is the fix.
- Could also be a server-side emit issue: check that `radio:ptt-start`
  is being broadcast to the Command frequency's room in
  `backend/services/socketManager.js` with the right tuner id.

**Status.** Logged for future fix. Not yet triaged with live
reproduction.
