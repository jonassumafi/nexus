// Load the SRS radio-model JSON presets once at startup and keep the
// catalog in memory. Each file in backend/data/radio_models/ describes
// one radio's DSP recipe (txEffect / rxEffect / encryptionEffect / noiseGain).
// See backend/data/radio_models/CREDITS.md for license + attribution.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'radio_models');

// Non-player presets kept out of the user-facing picker. link16 /
// intercom are infrastructure, hfnoise is a shared noise helper.
const HIDE_FROM_PICKER = new Set(['link16', 'intercom', 'hfnoise']);

// Nexus-flavored display names + narrative blurbs for each real-world
// radio. The underlying JSON spec stays authentic to SRS so the DSP
// behaves faithfully; only the player-facing labels are reskinned to fit
// the in-universe fiction (we're a Star Citizen fan project, not a
// military sim, so an "ARC-164" would feel out of place).
// `band` maps the preset to one of the four SRS noise-bed .wav samples
// in frontend/public/sounds/radio/. Rough logic:
//   UHF   → tight 3 kHz band-limit, handheld / consumer character
//   VHF   → standard 5 kHz, ship-fit and broadcast
//   HF    → wider 8 kHz with atmospheric fade, legacy / long-range
//   FM    → full-spectrum, military FM data-capable rigs
const META = {
  arc27:    { label: 'VX-27 Scoutlink',       family: 'personal',  band: 'UHF', blurb: 'Lightweight scout handheld — tight bandwidth, loud carrier.' },
  arc51:    { label: 'VX-51 Fieldmaster',     family: 'personal',  band: 'VHF', blurb: 'Field-grade handheld, mid-brightness voice.' },
  arc131:   { label: 'VX-131 Transit',        family: 'personal',  band: 'UHF', blurb: 'Short-range transit unit, muted treble.' },
  arc134:   { label: 'VX-134 Patrol',         family: 'ship',      band: 'VHF', blurb: 'Patrol-class rig, balanced warmth.' },
  arc164:   { label: 'UV-164 Guard',          family: 'ship',      band: 'UHF', blurb: 'Guard-channel broadcast, dense mid-range, prominent sidechain compression.' },
  arc186:   { label: 'VX-186 Hauler',         family: 'ship',      band: 'VHF', blurb: 'Civilian hauler fit-standard, forgiving dynamics.' },
  arc201d:  { label: 'DX-201 Secure',         family: 'ship',      band: 'FM',  blurb: 'Secure-voice rig with crypto discipline. Bright, bit-crushed.' },
  arc210:   { label: 'MX-210 Interop',        family: 'broadcast', band: 'VHF', blurb: 'Multi-band interop broadcaster. Clean body, assertive compression.' },
  arc220:   { label: 'MX-220 Datalink',       family: 'broadcast', band: 'FM',  blurb: 'Data-capable broadcast rig, warm high-end.' },
  arc222:   { label: 'MX-222 Dispatch',       family: 'broadcast', band: 'VHF', blurb: 'Dispatch-grade broadcast, high clarity.' },
  baklan5:  { label: 'KR-5 Baklan',           family: 'ship',      band: 'VHF', blurb: 'Soviet-pattern cockpit rig. Narrow midband, aggressive peak.' },
  jadro1a:  { label: 'KR-1A Jadro',           family: 'ship',      band: 'FM',  blurb: 'Secure cockpit set with distinctive compression curve.' },
  r800:     { label: 'KR-800 Flight',         family: 'ship',      band: 'VHF', blurb: 'Flight-standard transceiver, tight presence.' },
  r828:     { label: 'KR-828 Line',           family: 'ship',      band: 'UHF', blurb: 'Line-of-sight pattern, mid-forward voicing.' },
  r832m:    { label: 'KR-832M Military',      family: 'ship',      band: 'VHF', blurb: 'Military-pattern voice, deliberate saturation.' },
  r852:     { label: 'KR-852 Steppe',         family: 'personal',  band: 'UHF', blurb: 'Steppe-service handheld. Dry and immediate.' },
  r862:     { label: 'KR-862 Scout',          family: 'ship',      band: 'VHF', blurb: 'Scout cockpit rig, bright articulation.' },
  r863:     { label: 'KR-863 Patrol',         family: 'ship',      band: 'VHF', blurb: 'Patrol fitment, moderate compression.' },
  r864:     { label: 'KR-864 Border',         family: 'ship',      band: 'UHF', blurb: 'Border-service variant, heavier low-end.' },
  rsi6k:    { label: 'KR-6K Veteran',         family: 'personal',  band: 'HF',  blurb: 'Veteran handheld, nostalgic 1960s voicing.' },
  arc5:     { label: 'LG-5 Veteran',          family: 'legacy',    band: 'HF',  blurb: 'Legacy prop-era transceiver. Narrow and warm.' },
  fug16zy:  { label: 'LG-16 Falke',           family: 'legacy',    band: 'HF',  blurb: 'Interwar continental voice, boxy midband.' },
  r1155:    { label: 'LG-1155 Transit',       family: 'legacy',    band: 'HF',  blurb: 'Civilian transit relic, muted and intimate.' },
  scr522a:  { label: 'LG-522 Field',          family: 'legacy',    band: 'HF',  blurb: 'Mid-century field rig with pronounced saturation.' },
  t1154:    { label: 'LG-1154 Beacon',        family: 'legacy',    band: 'HF',  blurb: 'Beacon-service oldlink. Dim, honest.' },
};

const FAMILY_LABEL = {
  personal:  'Personal',
  ship:      'Ship-fit',
  broadcast: 'Broadcast',
  legacy:    'Legacy',
};

let CATALOG = [];
let BY_ID = new Map();

function load() {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    const id = path.basename(f, '.json');
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      const meta = META[id] || { label: id, family: 'ship', blurb: '' };
      out.push({
        id,
        label: meta.label,
        family: meta.family,
        family_label: FAMILY_LABEL[meta.family] || meta.family,
        band: meta.band || 'VHF',
        blurb: meta.blurb,
        hidden: HIDE_FROM_PICKER.has(id),
        spec,
      });
    } catch (err) {
      console.error('[radio] failed to load', f, err.message);
    }
  }
  CATALOG = out;
  BY_ID = new Map(out.map(r => [r.id, r]));
  console.log(`[radio] loaded ${out.length} radio presets (${out.filter(r => !r.hidden).length} player-selectable)`);
}

/** Full catalog shaped for the picker UI (hidden entries filtered). */
function pickerList() {
  return CATALOG.filter(r => !r.hidden).map(({ spec, ...rest }) => rest);
}

/** Resolve a radio by id. Returns the full entry including spec. */
function byId(id) { return BY_ID.get(String(id || '')); }

/** All visible radio IDs — useful for random assignment. */
function pickerIds() { return pickerList().map(r => r.id); }

/** Pick a random player-selectable radio. */
function randomRadio() {
  const ids = pickerIds();
  return ids[Math.floor(Math.random() * ids.length)];
}

load();

module.exports = { pickerList, byId, pickerIds, randomRadio, reload: load };
