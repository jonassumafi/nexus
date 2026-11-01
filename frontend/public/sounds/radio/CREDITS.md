# Radio audio asset credits

The audio files in this directory originate from **DCS-SimpleRadioStandalone**
(https://github.com/ciribob/DCS-SimpleRadioStandalone) by Ciribob and
contributors, and are used by Nexus under the terms of the **GNU General
Public License, version 3** (same license Nexus itself is published under
— see `/LICENSE` at the repository root).

Specific per-file attribution per the SRS repo's `Original/Sources.txt`:

- `RADIO_TRANS_START*.wav`, `RADIO_TRANS_END*.wav` — PTT keyup/keydown
  samples contributed by **Bimbac** (Discord).
- `VHF_NOISE.wav`, `UHF_NOISE.wav`, `HF_NOISE.wav`, `FM_NOISE.wav` —
  band-limited squelch backgrounds from the SRS AudioEffects collection.
- `frq-collision.wav`, `frq-collision2.wav`, `frq-collision3.wav` —
  simultaneous-transmission interference tones (from SRS Original folder).
- `KY_58_TX.wav`, `KY_58_RX.wav` — crypto sync chirps played when a
  secure-voice rig keys up / down. Though sampled from a real KY-58
  (which is an FM radio), in Nexus these are modulation-agnostic
  "crypto handshake" cues — gated on the preset's crypto flag only.

Additional SRS attributions (not currently in Nexus but acknowledged):
- HAVE QUICK frequency-hopping information: **Nicholas Landolfi**
- AM frequency-collision documentation: **Jester**
- Various reference tones: **SimPhonics Tones Collection**

Modifications: these files are used as-shipped by SRS without alteration.
If future modifications are made (trim, resample, normalize), they
will be noted here.
