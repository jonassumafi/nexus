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
