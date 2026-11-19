# Known Issues

Tracked for future fixes. Each entry: symptom, expected behavior, where
to start digging, and current status.

---

## DESIGN PRINCIPLE — Read before working on any view-switch bug

**The two views are shells of one radio system, not two.** Full
dashboard and Radio-only are UI presentations of the same underlying
voice layer. A single operator has:

- One identity (`userId`).
- One mic chain (filter graph, voice profile, sensitivity).
- One pair of radios (Crew + Command), each with:
  - one tuned frequency,
  - one power state,
  - one voice profile / rig,
  - one PTT key binding,
  - one presence on the server-side frequency room,
  - one UDP session (or one WebRTC peer connection set).

Switching views must **never** change any of the above. The player's
frequency, peer list, power state, transmission state, and roster
identity all remain exactly as they were. The view just re-draws them
in a different shape.

The current implementation is wrong on this point — each view runs
in its own BrowserWindow, which spawns its own renderer process,
its own socket, its own UDP session, its own mic chain. Issues #3
and #4 are direct symptoms of that architectural mismatch; future
fixes should move the voice layer out of per-window state into
something shared (either keep one BrowserWindow and switch layouts
inside it, or move the entire voice engine into the Electron main
process and have each window be a thin observer).

**Treat this as the north star for any view-switch fix.** A fix
that makes the symptoms go away but keeps two parallel voice stacks
is not a real fix.

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

## 5. Add "Click and hold to disconnect" tooltips to every power-off button

**Type.** Enhancement, not a bug — the hold-to-confirm gesture works
correctly on every power/disconnect button today, but new players
don't know the gesture exists. One already-partial surface: the
Banner Disconnect icon uses a hover-hint; the radio power-off
buttons also have one on hover. This issue is about **all**
power-off surfaces having a consistent tooltip string.

**Expected behavior.** Every power-off / disconnect control — radio
power icon (Crew + Command, in Full and Radio-only), the dashboard
Banner Disconnect icon, the Radio-only gear panel Disconnect
button, and any future power-off control — shows a tooltip reading
exactly: **"Click and hold to disconnect"** on hover. Even if the
button type is non-radio (e.g. app disconnect), the same string
applies.

**Where to look first.**
- `frontend/src/components/HoldButton.jsx` — `HoldButton` takes a
  `hintText` / `title` prop; `useHold` + `HoldRing` are used inline
  elsewhere. Make sure every call site passes the same string.
- `frontend/src/components/Banner.jsx` → `DisconnectHoldButton`
  (`data-tip="Hold to disconnect"` currently) — change to
  "Click and hold to disconnect".
- `frontend/src/components/RadioModule.jsx` → `PowerBtn` (currently
  `title="Hold to turn off"` and hover-label "Hold to turn off").
  Change label + title.
- `frontend/src/components/RadioTwinTiles.jsx` → `PowerHoldIB`
  (currently `title="Hold to turn off"`).
- `frontend/src/components/RadioTwinTiles.jsx` → the Radio-only gear
  Disconnect `HoldButton` (currently `hintText="Hold to disconnect"`).

**Status.** Logged for future fix. Simple string sweep, no logic
changes required.

---

## 6. Powering off Crew radio appears to silence Command transmissions too

**Symptom (unconfirmed).** On Full dashboard: I powered off the Crew
radio and left Command radio powered on. When I keyed up and
transmitted on Command, no peers heard me. It felt as though
powering off Crew had also stopped Command's TX path — even though
the Command radio UI stayed "on."

**Expected behavior.** The two radios are independent. Powering off
Crew should only drop Crew from its frequency and stop Crew's
mic chain. Command's TX path should be completely unaffected.

**Where to look first.**
- `frontend/src/components/CrewRadioCard.jsx:52-56` — the
  power-off effect calls `leaveFrequency()`. That hook comes from
  `useRadioConnectionUDP`. If `leaveFrequency` ever tears down the
  SHARED mic/filter chain (not just the Crew-side peer connection),
  Command's TX would die with it. Audit what `leaveFrequency` cleans
  up — tracks, GainNodes, the UDP socket, etc.
- `frontend/src/hooks/useRadioConnectionUDP.js` — specifically the
  cleanup paths. There was a historical bug (`ded2fff`'s predecessor,
  the "Chromium silences cross-context audio on close") where
  closing the AudioContext killed BOTH radios. Make sure power-off
  of Crew doesn't accidentally trigger an `audioCtx.close()` or
  `filteredStreamRef.current` reset that Command depends on.
- Command's own TX chain is partially shared with Crew's mic
  (one mic, two tuners). Check whether the mic stream's `.enabled`
  flag or the active filter chain is being toggled off by Crew's
  power-down.
- Also verify the Command card's `powered` state really stayed true
  — a glance at `nexus_command_powered` in localStorage after the
  repro would confirm Command wasn't silently flipped off too.

**Status.** Logged for future fix. Needs repro + isolation. If
confirmed, high priority — directly blocks a common operator
workflow (silencing the chatter channel but keeping Command hot).

---

## 7. Hold-to-turn-off completes but power snaps back on

**Symptom.** On a powered radio (Crew or Command), press-and-hold
the power button. The ring fills, the hold completes, the radio
briefly flips off, then immediately flips back on. Repeat attempts
produce the same result — the radio is effectively stuck ON.

**Expected behavior.** A completed hold fires `onPowerToggle` exactly
once and the radio stays in the OFF state until the user single-
clicks it back on.

**Root cause (identified, not yet fixed).** In
`frontend/src/components/RadioModule.jsx`'s `PowerBtn`, the mouse
handlers are conditional on `powered`:

```jsx
onMouseUp={() => { setPressing(false); if (powered) bindProps.onMouseUp(); }}
onClick={powered ? undefined : commonHandlers.onClick}
```

Sequence when the user holds a powered radio to completion:
1. `onComplete` fires → parent calls `setPowered(false)` → React re-
   renders with `powered = false`.
2. The physical release has not happened yet, but by the time the
   user lifts the mouse, `powered` is already `false`.
3. `onMouseUp` checks `powered` (now `false`) → skips
   `bindProps.onMouseUp` (the `useHold.release` that would set
   `completedRef = false`).
4. The browser then synthesises `click` (because the press started
   on the button). Now `onClick = commonHandlers.onClick` because
   `powered` is `false` → runs `onClick?.()` → `setPowered(true)`.
5. Radio is back ON. User gives up.

**Fix sketch.**
- Capture the "was powered at press start" into a ref when `onMouseDown`
  fires, and read from THAT ref in `onMouseUp` / `onClick` instead of
  the live `powered` state. That decouples the pointer-release path
  from the fact that `powered` has already flipped.
- Alternative: on `onClick`, if `completedRef.current` is still true
  (just completed a hold), swallow the click. Requires exposing the
  completedRef from `useHold`, or guarding via a local
  `justCompletedRef` on PowerBtn that we set in the `onComplete`
  callback and clear on next mousedown.
- Same pattern should be audited in `RadioTwinTiles.jsx`'s
  `PowerHoldIB` — it uses a similar conditional-on-powered structure
  and may have the same bug.

**Status.** Logged for future fix. High priority — this makes it
functionally impossible to power off a radio with the current
build, which is what the whole hold-to-confirm gesture was designed
to make safer.

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
