# Radio-model preset credits

The 28 `*.json` files in this directory originate from
**DCS-SimpleRadioStandalone**
(https://github.com/ciribob/DCS-SimpleRadioStandalone) by Ciribob and
contributors, and are used by Nexus under the terms of the **GNU
General Public License, version 3** (same license Nexus itself is
published under — see `/LICENSE` at the repository root).

Each JSON file describes a DSP recipe (filter chain, compressor
settings, saturation parameters, CVSD-codec simulation flags, gain
staging) that produces the characteristic audio behavior of a specific
real-world military radio.

**Modern voice radios (23):**
- US / Western: ARC-27, ARC-51, ARC-131, ARC-134, ARC-164, ARC-186,
  ARC-201D, ARC-210, ARC-220, ARC-222
- Soviet / Russian: Baklan-5, Jadro-1A, R-800, R-828, R-832M, R-852,
  R-862, R-863, R-864, RSI-6K
- WWII: ARC-5, FuG 16ZY, R.1155, SCR-522A, T.1154

**Non-voice presets (3):**
- `link16.json` — Link-16 MIDS data link (carries voice as a side use)
- `intercom.json` — aircraft internal intercom
- `hfnoise.json` — shared HF noise helper (not a radio by itself)

Modifications: all 28 files are shipped as-authored by the SRS project.
If future Nexus-specific tuning is added, modifications will be noted
inline in the affected JSON files and summarized here.
