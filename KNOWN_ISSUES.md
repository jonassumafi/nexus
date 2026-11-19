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
