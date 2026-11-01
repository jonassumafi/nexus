# Nexus Interstellar Traffic System

A sci-fi roleplay web app + Electron companion for a Star Citizen
community. Players own ships, create missions, reserve crew slots,
earn Reserve Points toward ranks, and communicate via a WebRTC voice
radio with per-channel audio chrome.

## License

Nexus is **free software**, licensed under the **GNU General Public
License, version 3 or later** (GPL-3.0-or-later). See `LICENSE` at the
repository root for the full text.

In practice this means:
- You can run, read, modify, and share this software freely.
- If you distribute a modified version — or a binary built from
  modified source — you must make the modified source available under
  the same license.
- The server-side code is covered too; running it as a public service
  does not force source disclosure (that would require AGPL, not GPL).

## Third-party credits

### Radio audio
Radio effects, squelch samples, and 28 radio-model DSP presets are
from **DCS-SimpleRadioStandalone**
(https://github.com/ciribob/DCS-SimpleRadioStandalone) by Ciribob and
contributors, used under GPL v3. Specific contributor attribution:

- PTT keyup / keydown and radio effects: **Bimbac** (Discord)
- HAVE QUICK anti-jam reference: **Nicholas Landolfi**
- AM frequency-collision documentation: **Jester**
- Reference tones: **SimPhonics Tones Collection**

Per-asset detail: see
- `frontend/public/sounds/radio/CREDITS.md`
- `backend/data/radio_models/CREDITS.md`

### Fonts
Inter, JetBrains Mono, and Barlow Semi Condensed — all SIL Open Font
License (OFL), GPL-compatible.

### Icons
Activity feed uses silhouettes inspired by [Lucide](https://lucide.dev)
(ISC license). Icon SVG markup is re-authored inside this repo.

## Project layout

- `backend/` — Node + Express + Mongoose + Socket.IO server
- `frontend/` — React + Vite SPA (served at nexus-missions.space)
- `electron/` — Electron shell for the desktop companion app
- `docs/` — spec HTML files, concept bundles, aesthetic references
- `backend/data/radio_models/` — SRS DSP presets (GPL)
- `frontend/public/sounds/radio/` — SRS audio samples (GPL)

## Running locally

```
# backend (requires MongoDB on localhost:27017)
cd backend
npm install
cp .env.example .env    # fill in Discord OAuth, JWT secret, Resend key
npm run dev

# frontend
cd ../frontend
npm install
npm run dev
```

Visit http://localhost:5173.

## Reverting to a restore point

Significant milestones are tagged. To return to the known-good state
before the SRS radio integration began:

```
git reset --hard pre-srs-radio
```

## Contributing

Issues and pull requests welcome. By contributing you agree your work
is licensed under GPL v3.
