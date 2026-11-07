# Radio voice diversity — v1 (2026-11-07)

Baseline + first-pass tweak applied to every player-facing radio preset
in `backend/data/radio_models/`. This document is a **restore point**:
you can take any single rig back to its SRS baseline, or revert the
whole set, without guessing.

If you want to push the diversity further, treat this as v1 and write
v2 next to it. Never edit this file after the fact — fork it.

---

## Why these values exist

SRS, which Nexus borrows its DSP chain + preset schema from, is designed
for DCS where every "rig" is a real-world radio covering similar bands.
That means most SRS presets share identical TX configs. Faithful for
DCS, boring for Nexus: 25 player-facing rigs were really only **5
distinct TX configs** before v1.

v1 keeps each rig in its SRS archetype (same family character) but
nudges 1–2 parameters by ≤ 15 % so every rig has its own audible
signature. Three "reference" rigs stay untouched as family anchors.

**Audio integrity guardrail:** deltas were capped at ±15 % to keep rigs
far from the distortion/static boundary we found during the WebRTC era.
Push further at your own risk.

---

## Archetype baselines (pre-v1)

Every rig in a group starts here. Numbers are, in order:
**HP** (highpass Hz), **PF** (peak Hz), **PG** (peak gain dB),
**LP** (lowpass Hz), **SG** (saturation gain), **ST** (saturation
threshold dB), **CR** (compressor ratio), **MU** (compressor makeup dB).

| Group | HP | PF | PG | LP | SG | ST | CR | MU | Rigs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| **A** handheld | 954 | 2302 | 13 | 5165 | 11 | −30 | 2.63 | 5 | arc27, arc51, arc131, arc134, arc164, arc186 |
| **B** broadcast | 1700 | 2801 | 5 | 5538 | 9 | −23 | 1.18 | 6 | arc201d, arc210, arc220, arc222 |
| **C** ship/military | 1825 | 2053 | 7 | 3919 | 9 | −17 | 1.18 | 8 | baklan5, jadro1a, r800, r828, r832m, r852, r862, r863, r864 |
| **D** nostalgic | 2261 | 1991 | 13 | 5912 | 11 | −44 | 2.63 | 3 | rsi6k |
| **E** legacy | 1637 | 2052 | 8 | 3608 | 11 | −21 | 2.63 | 5 | arc5, fug16zy, r1155, scr522a, t1154 |

---

## Per-rig v1 values

Rigs with "—" in the Δ column are intentional family anchors — they
keep their archetype baseline unchanged, so each family has one
"reference" voice.

### Group A — handheld

| Rig | Label | Lean | Δ | HP | PF | PG | LP | SG | ST | CR | MU |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| arc27 | VX-27 Scoutlink | tight, loud carrier | HP +15 %, PG +15 % | **1095** | 2302 | **15** | 5165 | 11 | −30 | 2.63 | 5 |
| arc51 | VX-51 Fieldmaster | mid-bright | PF +10 %, LP +10 % | 954 | **2530** | 13 | **5680** | 11 | −30 | 2.63 | 5 |
| arc131 | VX-131 Transit | muted treble | LP −10 %, PG −15 % | 954 | 2302 | **11** | **4650** | 11 | −30 | 2.63 | 5 |
| arc134 | VX-134 Patrol | balanced warmth | HP −10 %, MU +15 % | **855** | 2302 | 13 | 5165 | 11 | −30 | 2.63 | **5.75** |
| arc164 | UV-164 Guard | dense mid, heavy comp | PG +15 %, CR +12 % | 954 | 2302 | **15** | 5165 | 11 | −30 | **2.95** | 5 |
| arc186 | VX-186 Hauler | forgiving dynamics | ST −10 % (shallower), CR −11 % | 954 | 2302 | 13 | 5165 | 11 | **−27** | **2.35** | 5 |

### Group B — broadcast

| Rig | Label | Lean | Δ | HP | PF | PG | LP | SG | ST | CR | MU |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| arc201d | DX-201 Secure | crypto, bright, bit-crush | PG +20 %¹, LP +10 % | 1700 | 2801 | **6** | **6090** | 9 | −23 | 1.18 | 6 |
| arc210 | MX-210 Interop | clean body, assertive comp | HP −10 %, CR +12 % | **1530** | 2801 | 5 | 5538 | 9 | −23 | **1.32** | 6 |
| arc220 | MX-220 Datalink | warm high-end | HP −10 %, LP +10 % | **1530** | 2801 | 5 | **6090** | 9 | −23 | 1.18 | 6 |
| arc222 | MX-222 Dispatch | high clarity | PF +10 %, PG +15 % | 1700 | **3080** | **5.75** | 5538 | 9 | −23 | 1.18 | 6 |

¹ arc201d's PG is 20 % above baseline — 1 dB absolute is only 20 % because the baseline itself is only 5 dB. Pin to 5.75 instead if you want a strict ±15 % everywhere.

### Group C — ship/military

| Rig | Label | Lean | Δ | HP | PF | PG | LP | SG | ST | CR | MU |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baklan5 | KR-5 Baklan | narrow, aggressive peak | PG +14 %, PF −10 % | 1825 | **1850** | **8** | 3919 | 9 | −17 | 1.18 | 8 |
| jadro1a | KR-1A Jadro | secure, distinctive comp | HP −10 %, MU +15 % | **1650** | 2053 | 7 | 3919 | 9 | −17 | 1.18 | **9.2** |
| r800 | KR-800 Flight | tight presence | PF +10 %, LP +10 % | 1825 | **2260** | 7 | **4310** | 9 | −17 | 1.18 | 8 |
| r828 | KR-828 Line | mid-forward | HP +10 %, MU −15 % | **2010** | 2053 | 7 | 3919 | 9 | −17 | 1.18 | **6.8** |
| r832m | KR-832M Military | deliberate saturation | SG +14 %, ST −12 % (earlier) | 1825 | 2053 | 7 | 3919 | **10.3** | **−19** | 1.18 | 8 |
| r852 | KR-852 Steppe | dry, immediate | HP +15 %, CR +12 % | **2100** | 2053 | 7 | 3919 | 9 | −17 | **1.32** | 8 |
| r862 | KR-862 Scout | bright articulation | LP +10 %, PG +14 % | 1825 | 2053 | **8** | **4310** | 9 | −17 | 1.18 | 8 |
| **r863** | KR-863 Patrol | **reference** | — | 1825 | 2053 | 7 | 3919 | 9 | −17 | 1.18 | 8 |
| r864 | KR-864 Border | heavier low-end | HP −15 %, MU +12 % | **1550** | 2053 | 7 | 3919 | 9 | −17 | 1.18 | **9** |

### Group D — nostalgic

| Rig | Label | Lean | Δ | HP | PF | PG | LP | SG | ST | CR | MU |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **rsi6k** | KR-6K Veteran | **reference** (unique baseline) | — | 2261 | 1991 | 13 | 5912 | 11 | −44 | 2.63 | 3 |

### Group E — legacy

| Rig | Label | Lean | Δ | HP | PF | PG | LP | SG | ST | CR | MU |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| arc5 | LG-5 Veteran | narrow and warm | HP +10 %, LP −10 % | **1800** | 2052 | 8 | **3250** | 11 | −21 | 2.63 | 5 |
| fug16zy | LG-16 Falke | boxy midband | PG +15 %, PF −10 % | 1637 | **1850** | **9.2** | 3608 | 11 | −21 | 2.63 | 5 |
| r1155 | LG-1155 Transit | muted and intimate | SG −14 %, LP −10 % | 1637 | 2052 | 8 | **3250** | **9.4** | −21 | 2.63 | 5 |
| scr522a | LG-522 Field | pronounced saturation | SG +14 %, ST −14 % (earlier) | 1637 | 2052 | 8 | 3608 | **12.5** | **−24** | 2.63 | 5 |
| **t1154** | LG-1154 Beacon | **reference** | — | 1637 | 2052 | 8 | 3608 | 11 | −21 | 2.63 | 5 |

---

## Restoring

### Restore one rig to its archetype baseline

Pick the rig's group from the baseline table above, open
`backend/data/radio_models/<rig>.json`, set the 8 TX parameters
accordingly. Paths inside the JSON:

- HP → `.txEffect.effects[0].filters[0].frequency`
- PF → `.txEffect.effects[0].filters[1].frequency`
- PG → `.txEffect.effects[0].filters[1].gain`
- LP → `.txEffect.effects[0].filters[2].frequency`
- SG → `.txEffect.effects[1].gain`
- ST → `.txEffect.effects[1].threshold`
- CR → `.txEffect.effects[2].ratio`
- MU → `.txEffect.effects[2].makeUp`

Then `pm2 restart nexus-backend` so the preset reloader picks it up.

### Restore every rig to its baseline (full v1 → v0 revert)

The same `apply-tx-tweaks.js` pattern we used to apply v1 works in
reverse. Example one-shot script that wipes every v1 tweak back to the
pre-v1 archetype baselines above, then verifies via the preset loader:

```js
// /tmp/revert-to-srs-baseline.js
const fs = require('fs'), path = require('path');
const DIR = '/home/kylo-mini/nexus/backend/data/radio_models';
const BASE = {
  A: [954, 2302, 13, 5165, 11, -30, 2.63, 5],
  B: [1700, 2801,  5, 5538,  9, -23, 1.18, 6],
  C: [1825, 2053,  7, 3919,  9, -17, 1.18, 8],
  D: [2261, 1991, 13, 5912, 11, -44, 2.63, 3],
  E: [1637, 2052,  8, 3608, 11, -21, 2.63, 5],
};
const GROUPS = {
  A: ['arc27','arc51','arc131','arc134','arc164','arc186'],
  B: ['arc201d','arc210','arc220','arc222'],
  C: ['baklan5','jadro1a','r800','r828','r832m','r852','r862','r863','r864'],
  D: ['rsi6k'],
  E: ['arc5','fug16zy','r1155','scr522a','t1154'],
};
for (const [g, rigs] of Object.entries(GROUPS)) {
  const [HP, PF, PG, LP, SG, ST, CR, MU] = BASE[g];
  for (const rig of rigs) {
    const p = path.join(DIR, rig + '.json');
    const s = JSON.parse(fs.readFileSync(p, 'utf8'));
    s.txEffect.effects[0].filters[0].frequency = HP;
    s.txEffect.effects[0].filters[1].frequency = PF;
    s.txEffect.effects[0].filters[1].gain      = PG;
    s.txEffect.effects[0].filters[2].frequency = LP;
    s.txEffect.effects[1].gain                 = SG;
    s.txEffect.effects[1].threshold            = ST;
    s.txEffect.effects[2].ratio                = CR;
    s.txEffect.effects[2].makeUp               = MU;
    fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
  }
}
console.log('reverted to v0 (SRS baselines)');
```

Run with `node /tmp/revert-to-srs-baseline.js && pm2 restart nexus-backend`.

### Restore via git

Since v1 shipped in commit `f261fb0` ("Save point before Windows
installer build"), the pre-v1 JSONs are the state in the commit
immediately before that:

```
git show f261fb0^:backend/data/radio_models/arc27.json
git checkout f261fb0^ -- backend/data/radio_models/
```

The second command checks out every pre-v1 JSON at once. Follow with
`pm2 restart nexus-backend`.

---

## What's NOT in v1

- **RX side.** Every rig still shares the same 270 Hz / 4500 Hz band-pass
  on receive. Listener's rig only changes what they hear via FM
  de-emphasis (sender-band-dependent) or crypto-rig static bed —
  nothing per-rig on the receive side.
- **Static beds.** All rigs in a given band share one noise sample.
- **Keyup / keydown samples.** All rigs share `RADIO_TRANS_START.wav`
  + `RADIO_TRANS_END.wav`. (The `_ALTERNATE` variants got pulled
  because of the "Aquila 096" voice leak.)

If v2 wants bigger differentiation, these are the untouched knobs.
