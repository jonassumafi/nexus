# NEXUS 1.0 — HANDOFF DOCUMENT V3

**Generated**: 2026-06-30  
**Session**: 15+ (Sessions 1–15 completed; ongoing)  
**Author**: Claude Code (claude-opus-4-7)

---

## 1. PROJECT OVERVIEW

### Platform Identity

**Name**: Nexus 1.0  
**Lore name**: NEXUS INTERSTELLAR TRAFFIC SYSTEM  
**Lore tagline**: The first standardized crew coordination protocol for independent operators.  
**Lore date**: 2956  
**Org name**: FRONTIER OPERATORS GUILD  
**Universe**: Star Citizen  

Nexus 1.0 is a web-based successor to the Hopewell Continuum Discord bot. It provides real-time mission coordination, crew slot management, RP progression, WebRTC voice comms, and ship registration for Star Citizen players — accessible through a browser without needing the Discord bot interface.

### Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 18 + Vite | `/home/kylo-mini/nexus/frontend/` |
| Backend | Node.js + Express 4 | `/home/kylo-mini/nexus/backend/` |
| Database | MongoDB (local) | `NexusDB` on `localhost:27017` |
| ODM | Mongoose 8 | All models in `backend/models/` |
| Auth | Discord OAuth2 + JWT | 7-day token expiry, `localStorage` |
| Real-time | Socket.IO 4 | Org rooms + global + user rooms |
| Image storage | Cloudinary | Portraits + ship model images |
| AI | OpenAI GPT-4o-mini | 72hr batch mission summaries |
| Scheduling | node-cron (in-process) | 4 cron jobs in `scheduler.js` |
| Voice | WebRTC (mesh) | STUN: Google, TURN: Coturn on kylo-mini |
| Hosting | kylo-mini (Ubuntu 24.04) | Cloudflare Tunnel for public HTTPS |
| Process mgr | PM2 | `nexus-backend` (id 7), `nexus-frontend` (id 6) |

### Deployment

```
kylo-mini (Ubuntu 24.04)
├── PM2: nexus-backend    → node backend/server.js  (port 3099)
├── PM2: nexus-frontend   → serve dist/             (port 4173)
├── Cloudflare Tunnel     → routes HTTPS to local ports
├── Coturn                → TURN server on port 3478 / TURNS on 5349
└── MongoDB               → localhost:27017 / NexusDB
```

**IMPORTANT — Port conflict**: Port 3000 is still occupied by `raleigh_distance/server.js` (PID 2223). Backend runs on port 3099. Before going public: kill PID 2223 and update `backend/.env PORT` + `frontend/vite.config.js` proxy target to 3000 simultaneously.

### Key File Paths

```
~/nexus/
├── backend/
│   ├── server.js              main Express app + Socket.IO init
│   ├── .env                   all secrets (PORT, JWT, Discord, Cloudinary, TURN, OPENAI)
│   ├── models/                11 Mongoose models
│   ├── routes/                9 route files (~45 endpoints)
│   ├── services/
│   │   ├── rpService.js       all RP award functions + rank advancement
│   │   ├── missionService.js  completeMission, abortMission, validateMissionForLaunch
│   │   └── socketManager.js   JWT auth on handshake, room join, emitToAll/emitToOrg/emitToUser
│   ├── middleware/
│   │   └── permissions.js     isAuthenticated, isPlatformOwner, isOrgCommander
│   ├── jobs/scheduler.js      4 cron jobs
│   └── utils/seed.js          PlatformConfig auto-seed on cold start
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Gate.jsx       entrance screen (user gesture for HDD audio)
│   │   │   ├── Splash.jsx     DOS boot sequence + comms.mp3
│   │   │   ├── Onboarding.jsx 8-step onboarding wizard
│   │   │   └── Dashboard.jsx  main app shell (mission board, ship schematic, activity feed)
│   │   ├── components/
│   │   │   ├── ShipSchematic.jsx  interactive crew schematic with slot nodes
│   │   │   ├── RadioPanel.jsx     WebRTC voice panel (tune/PTT/disconnect)
│   │   │   └── AsciiBox.jsx       reusable terminal-style bordered box
│   │   ├── hooks/
│   │   │   └── useRadioConnection.js  full WebRTC + audio chain lifecycle
│   │   └── styles/global.css  all design tokens, animations, scrollbar, scanlines
│   └── public/
│       ├── images/ships/
│       │   ├── thumbnails/    260 top-down ship images (200px, from scorg.tools)
│       │   ├── ship_index.json
│       │   └── ship_specs.json  184 ships with crew_min/crew_max/career/role/size
│       └── sounds/            placeholder MP3s
├── docs/                      DECISIONS.md, FEATURES.md, PROJECT_LOG.md, SCHEMA.md, SPEC.md
└── discord bot/               reference source for the original Hopewell bot
```

---

## 2. COMPLETED FEATURES

### Feature 1 — Backend Foundation (Session 1)
Full Node/Express backend with 11 Mongoose models, 9 route files (~45 endpoints), Discord OAuth2 + JWT auth, Socket.IO real-time, Cloudinary integration, GPT-4o-mini AI summaries, 4 cron jobs, and seed data (PlatformConfig with 13 ranks, 11 mission types, 19 ship types, 5 crew roles).

### Feature 2 — Gate Screen
`/` route renders a pulsing entrance screen that captures the user gesture needed to autoplay HDD audio on Splash. Transitions to `/splash` after button interaction. `sessionStorage` flag prevents double-play.

### Feature 3 — Splash Screen / DOS Boot Sequence
`/splash` — animated terminal boot sequence with scanlines, vignette, and `comms.mp3` (18.4s, plays in full). `PRESS ANY KEY` prompt appears after boot; keypress/click fades to Dashboard. Skip is disabled until full sequence completes.

### Feature 4 — Discord OAuth2 + JWT Auth
`GET /api/auth/discord` → redirects to Discord. Callback at `/api/auth/discord/callback` issues a 7-day JWT, redirects to `FRONTEND_URL`. First login matching `PLATFORM_OWNER_DISCORD_ID` env var gets `is_platform_owner: true`. Token stored in `localStorage`.

### Feature 5 — Onboarding Wizard (8 steps)
Multi-screen wizard: citizen name, place of birth, citizenship, biography, appearance, first ship registration, rank confirmation, UEE ID card issue. Custom vocabulary: "STEP 04 / 08 — BIOGRAPHY" format. Completes by setting `onboarding_complete: true` on User.

### Feature 6 — UEE ID Card
Screen 6 of onboarding renders a static `UEE-IDCard.png` background (320×198px) with citizen name, citizenship, rank, and issue date absolutely positioned over it. Also appears as a thumbnail in the Dashboard top bar (no hover/popover — static only).

### Feature 7 — Dashboard (Main App Shell)
Three-panel layout:
- **Left** (20%): MY SHIPS panel listing the user's registered ships
- **Center** (50%): MISSION BOARD card list → MISSION DETAIL view with ship schematic
- **Right** (30%): ACTIVITY FEED + VOICE COMMS (RadioPanel)

Top bar: citizen name, UEE ID card thumbnail, DISCONNECT button.

### Feature 8 — Ship Registration
Users register ships via the MY SHIPS panel (ship name, type, description). Ships store `ship_model` (string, e.g., "RSI Polaris") for thumbnail and schematic lookups. Maximum ships per player configurable via PlatformConfig.

### Feature 9 — MY SHIPS Panel
Left panel lists the current user's ships with thumbnail (from `ship_index.json`), type badge, and registration date. Click selects a ship (future: ship detail view).

### Feature 10 — Create Mission Wizard
Multi-step modal for creating missions: name (with real-time uniqueness check via `/api/missions/check-name`), type (from PlatformConfig), objectives, primary ship, supporting ships (up to `maxShips - 1`), scheduled time, crew queue expiry. Creates mission in `WAITING FOR CREW` status, marks all ships as `is_mission: true`.

### Feature 11 — Mission Detail View
Center panel detail view for a selected mission:
- Header: mission name, type badge (color-coded), creator, date, status badge (animated pulse)
- Creator controls: FINALIZE / LAUNCH / COMPLETE / ABORT buttons (visible only to mission creator; gate-locked by status)
- Ship schematic with interactive crew slot nodes
- Crew manifest table below schematic

### Feature 12 — Activity Feed
Right panel streams real-time Socket.IO events into a reverse-chronological feed. Event types displayed: `slot_filled`, `slot_withdrawn`, `mission_created`, `mission_prep` (finalized), `mission_launched`, `mission_complete`, `mission_aborted`, `post_mission_log`, `ship_fill_bonus`, `ship_borrowed`.  
Format function: `formatFeedText()` in `Dashboard.jsx`. RP suffix suppressed when `rp_earned`/`rp_awarded` is 0 or falsy.

### Feature 13 — Ship Schematic with Crew Nodes
`ShipSchematic.jsx` — interactive schematic viewer:
- Holographic blue filter over ship thumbnail image (CSS filter chain)
- Dynamic node positions computed by `computeNodePositions(roleNames)` using 12 pre-defined `POS_TEMPLATES` grids
- Node states: OPEN (green pulse), TAKEN (red), YOURS (cyan), DIM (no match)
- Click: reserve or withdraw based on state
- Bottom legend: OPEN / OCCUPIED / YOUR SLOT
- Multi-ship nav (← PREV / CURRENT / NEXT →) for missions with supporting ships
- Crew manifest table: role, filled/slots, action button

### Feature 14 — WebRTC Radio (RadioPanel)
See **Section 6 — RADIO SYSTEM** for full details.

### Feature 15 — Mission Status System + Creator Controls
`PATCH /api/missions/:id/status` — creator-only status transitions with validation:
- WAITING FOR CREW → FINALIZED (requires ≥1 crew; pilot check temporarily disabled)
- FINALIZED → IN PROGRESS (launch)
- Any non-terminal → ABORTED
Status badge in mission header is animated (pulse-dot, pulse-btn-blue, pulse-btn-green keyframes). Terminal missions (COMPLETE/ABORT) are hidden from the board after 5 minutes via `hidden_at` field + cron backfill.

### Feature 16 — Mission Type Badges
`TypeBadge` component: 11 mission types each with unique background/border/text accent color. Tooltips use `position:fixed` + `getBoundingClientRect()` to escape overflow clipping from the center panel container.

### Feature 17 — Ship Specs Database
184 ships scraped from starcitizen.tools wiki (`scrapeShipSpecs.js`). Data saved as `frontend/public/images/ships/ship_specs.json` with `crew_min`, `crew_max`, `career`, `role`, `size` per ship slug.

### Feature 18 — Disconnect Screen
`/disconnect` route — DOS-style "CONNECTION TERMINATED" sequence, then auto-redirects to Splash.

---

## 3. DESIGN SYSTEM

### Color Palette (RSI Blue — adopted Session 7)

| Role | Value | Usage |
|---|---|---|
| Background | `#000000` | All panels |
| Primary (RSI Blue) | `#66AADD` | Primary text, labels, UI chrome |
| Bright / Headings | `#99CCFF` | Panel headers, titles |
| Nexus Cyan | `#00EEFF` | Selection glow, PRESS ANY KEY, YOUR SLOT node, focus rings |
| Dim / Secondary | `#2A6A9A` | Borders, secondary labels |
| Deep border | `#1A3D55` | Container borders |
| Success | `#33DDAA` | COMPLETE status, success states |
| Warning | `#FFBB33` | WAITING FOR CREW status, fill % bar |
| Danger | `#FF5544` | ABORT, TAKEN nodes, errors |
| Node Open | `#00FF66` | OPEN crew slot nodes (pulsing) |

**Important**: `box-shadow: none !important` was removed from the global reset to allow `#00EEFF` selection glow on mission cards. Focus ring is handled via CSS pseudo-selector on `input/textarea/select:focus`.

### Typography

- **Font**: JetBrains Mono (primary), fallback `monospace`
- **Base size**: 20px (`body` in `global.css`)
- **AsciiBox**: 18px
- **Line height**: 1.6
- Raw pixel look — no anti-aliasing tweaks intentional

### Effects

- **Scanlines**: CSS `repeating-linear-gradient` overlay, ~4% opacity, 2px pitch
- **Vignette**: CSS `radial-gradient`, transparent center → semi-opaque black edges
- **Cursor blink**: CSS `@keyframes blink`, 0.8s on active input lines
- **Node pulse**: `@keyframes nodeP` — OPEN crew slot nodes pulse green
- **Status pulse**: `@keyframes pulse-dot`, `pulse-btn-blue`, `pulse-btn-green` for status badges
- **Thin scrollbar**: 4px, `#1A3D55` thumb, `#000` track (global.css)
- **Holographic ship**: CSS filter on inner div: `invert(1) sepia(1) saturate(3) hue-rotate(175deg) brightness(0.55) contrast(1.2)`

### Button Conventions

- All buttons use the terminal-style border with Nexus Blue tones
- Primary action: `#66AADD` border, `#000` background, hover: `#66AADD` bg, `#000` text
- Danger: `#FF5544` border, hover: `#FF5544` bg
- Disabled / locked state: grayed out, `pointer-events: none`
- No border-radius — square corners throughout

### Sound System

Sound files in `~/nexus/frontend/public/sounds/` (placeholders present):
- `comms.mp3` — splash screen boot audio (18.4s, fully plays)
- `HDD_sound.mp3` — played on Gate screen, continues through Splash
- `mechanical_button2.mp3` — button click
- `typing.mp3` — typing animation
- `download_sound.mp3` — onboarding transitions
- `various_modem_sounds.mp3` — misc modem effects
- Filter chain clicks: `playClick('open')` / `playClick('close')` — hardcoded in `useRadioConnection.js`

---

## 4. DATABASE SCHEMA SUMMARY

**Database**: `NexusDB` on `localhost:27017`  
**ODM**: Mongoose 8. All schemas in `~/nexus/backend/models/`. Full schemas in `docs/SCHEMA.md`.

### Model Summary

| Model | Purpose | Key Fields |
|---|---|---|
| **PlatformConfig** | Singleton config document | `rp_settings`, `rp_ranks[13]`, `mission_types[11]`, `ship_types[19]`, `crew_roles[5]`, limits |
| **User** | Player account | `discord_id` (unique), `citizen_name`, `total_rp`, `rp_rank` (Mixed), `is_platform_owner`, `org_id`, `voice_profile` (Mixed), `current_mission_assignment` (Mixed) |
| **Organization** | Player org | `name` (unique), `prefix`, `invite_code` (6-char auto), `commander_id → User` |
| **Ship** | Registered ship | `ship_name`, `type`, `ship_model` (string, e.g. "RSI Polaris"), `crew_roles` (Mixed), `node_positions` ([{role, x, y}]), `crew_fill_percentage`, `is_mission`, `current_mission_id` |
| **Mission** | Active mission | `name` (unique), `status` (enum), `primary_ship`, `supporting_ships[]`, `frequency`, `hidden_at`, `queue_expires_at` |
| **MissionArchive** | Immutable post-mission snapshot | `primary_ship_snapshot` (Mixed), `crew_snapshot` (Mixed), `total_rp_awarded` |
| **MissionLog** | Post-mission text log | `mission_id`, `user_id`, `log_text` |
| **RPLedger** | Per-player RP events | `player_id`, `mission_id`, `event_code`, `points` |
| **ShipRPLedger** | Per-ship fill bonus records | `ship_id`, `mission_id`, `fill_rate`, `points_awarded` |
| **ShipModel** | Admin-uploaded ship model images | `category`, `model_name`, `image_url`, `scorg_ship_id` |
| **AISummary** | GPT-4o-mini generated summaries | `summary_text`, `period_start`, `period_end` |

### Notable Schema Details

- **`crew_roles` on Ship**: `mongoose.Schema.Types.Mixed` — keyed object `{ "Pilot": { slots: 1, filled: ["discord_id_or_objectid"] } }`. Requires `ship.markModified('crew_roles')` before save.
- **`filled[]` entries**: Can be MongoDB ObjectIds (web users) or Discord ID strings (legacy/seed). All crew route logic handles both via `OID_RE = /^[a-f0-9]{24}$/i` check. A startup migration in `seedMissions.js` converts ObjectId entries to discord_id strings.
- **`voice_profile` on User**: Mixed field storing per-user radio voice filter settings (filter type, intensity, etc.).
- **`node_positions` on Ship**: `[{ role: String, x: Number, y: Number }]` — manually placed schematic node positions (overridden by `computeNodePositions` dynamic layout in practice).
- **`ship_model` on Ship**: String, e.g. `"RSI Polaris"`. Used by frontend for thumbnail and schematic image lookup via `ship_index.json`.
- **`hidden_at` on Mission**: Set on COMPLETE/ABORT. Missions are excluded from the board 5 minutes after this timestamp. Backfilled by scheduler cron.
- **`frequency` on Mission**: Auto-generated string (format: `"119.1"`) at mission creation. Used as the WebRTC radio room identifier.

### Relationships

```
User ──── org_id ──────────────► Organization
Ship ──── owner_id ────────────► User
Ship ──── org_id ──────────────► Organization (optional)
Mission ── created_by ─────────► User
Mission ── primary_ship ───────► Ship
Mission ── supporting_ships[] ─► Ship[]
RPLedger ─ player_id ──────────► User
RPLedger ─ mission_id ─────────► Mission
ShipRPLedger ─ ship_id ────────► Ship
MissionArchive ─ (ships/crew embedded as Mixed snapshots, not references)
```

---

## 5. RP SYSTEM

RP (Reputation Points) drive rank progression. All awards go through `rpService.js`.

### Point Events

| Event Code | Points | Trigger | Awarded To |
|---|---|---|---|
| `MISSION_LAUNCHED` | 1 | Mission transitions to IN PROGRESS | Mission creator |
| `POST_MISSION_LOG` | 3 | Player submits post-mission log (`POST /api/logs`) | Submitting player |
| `CREW_SLOT_FILLED` | 1 or 2 | Player reserves a crew slot (`POST /api/crew/reserve`) | Reserving player |
| `SHIP_FILL_BONUS` | 3 | Ship reaches fill threshold at mission launch | Recorded on ShipRPLedger (not player RP) |

### Crew Fill Thresholds (configurable in PlatformConfig)

| Ship Fill % | Points Awarded |
|---|---|
| Below 50% | 0 (no ledger entry created) |
| 50% – 69% | 1 |
| 70%+ | 2 |

### Ship Fill Bonus

Calculated per role per ship at mission completion. If `filled_at_launch / capacity_at_launch >= ship_fill_threshold` (default 75%), a `ShipRPLedger` record is created. This is ship-level RP (not player RP), recorded for analytics.

### Rank Progression

13 ranks stored in `PlatformConfig.rp_ranks`. Each has `min_rp`, `max_rp` (null for highest), `title`, `emoji`, `unlocks[]`. After every RP award, `incrementUserRPAndUpdateRank()`:
1. Atomically increments `user.total_rp`
2. Calls `determineRank()` against all 13 ranks
3. Updates `user.rp_rank`
4. If rank title changed, emits `rank_advanced` to `user_<userId>` socket room

### Bot vs. Nexus RP Timing Difference

| Event | Discord Bot | Nexus 1.0 |
|---|---|---|
| `CREW_SLOT_FILLED` | Awarded at mission **completion** | Awarded at slot **reservation** |
| `MISSION_LAUNCHED` | Awarded **twice** (launch + complete) | Awarded **once** (launch only) |
| `POST_MISSION_LOG` | Key: `AFTERMATH_LOG` | Key: `POST_MISSION_LOG` |

The Nexus timing (award on reserve, not on complete) is intentional — provides earlier positive feedback. This divergence is documented but not considered a bug.

### Key Functions (backend/services/rpService.js)

- `addRPForCrewSlotFilled(userId, missionId, shipId, crewFillPercent)` — returns points awarded (0 if below threshold)
- `addRPForMissionLaunch(userId, missionId)` — returns points awarded
- `addRPForPostMissionLog(userId, missionId)` — also increments `MissionArchive.total_rp_awarded`
- `awardShipFillBonus(shipId, missionId, capacity, filled, role)` — creates ShipRPLedger entry only
- `incrementUserRPAndUpdateRank(userId, points)` — called by all of the above; handles rank emit

---

## 6. RADIO SYSTEM

### Architecture

WebRTC mesh via Socket.IO signaling. No SFU — each peer connects directly to every other peer in the frequency room. Works for small crews (2–6); at scale, an SFU (Mediasoup, LiveKit) would be needed.

**Signaling**: Socket.IO events — `radio:join`, `radio:leave`, `radio:ptt-start`, `radio:ptt-stop`, `radio:offer`, `radio:answer`, `radio:ice-candidate`  
**ICE**: Google STUN (`stun:stun.l.google.com:19302`) + Coturn TURN on kylo-mini (`turn:nexus.app-palette.com:3478`, TURNS on 5349)  
**TURN credentials**: Generated server-side via HMAC-SHA1 time-limited token (`GET /api/radio/turn-credentials`). Secret in `backend/.env` as `TURN_SECRET`.

### Frequency Format

Auto-generated at mission creation: random integer 1180–1369, divided by 10, formatted to 1 decimal place. Example: `"119.1"`. Stored in `Mission.frequency`. Frequency doubles as the Socket.IO room name for the radio channel.

### Access Control

Frequency is gated: `GET /api/radio/frequency/:missionId` checks that the requesting user has a filled crew slot on any ship assigned to the mission. Returns 403 `ACCESS DENIED — CREW ONLY` if not.

### Voice Filter Chain

`AudioFilterChain` class (in `useRadioConnection.js`) built on Web Audio API:
- Mic → AudioContext → GainNode (mic gain) → BiquadFilter (bandpass ~300–3400 Hz) → DynamicsCompressor → destination
- `setProfile(profile)` applies per-user voice settings from `user.voice_profile`
- PTT mutes/unmutes: when PTT not pressed, `micGainRef.current.gain.value = 0`
- Click sounds: `playClick('open')` / `playClick('close')` fire on PTT press/release

### PTT (Push-to-Talk)

- Spacebar or RadioPanel button: calls `startPTT()` → sets `micGainRef.current.gain.value = 1`, emits `radio:ptt-start`
- Release: calls `stopPTT()` → gain back to 0, emits `radio:ptt-stop`
- Remote PTT events drive visual "TRANSMITTING" indicator for other users in the room

### Teardown (leaveFrequency)

`leaveFrequency()` → `cleanupAllPeers()` → `teardownAudioChain()`:
1. Stops all `filteredStreamRef` tracks (releases browser mic indicator)
2. Disposes filter chain
3. Disconnects gain + analyser nodes
4. Stops all `micStreamRef` tracks
5. Closes `AudioContext`
6. Nulls all audio refs so re-tune starts clean
7. Sets `micGranted: false`

**Rationale**: Without explicit track stop, the browser's microphone indicator remains active indefinitely after disconnect. Without nulling refs, the next `ensureMicAndChain()` call returns a stale dead stream.

### Key Files

- `frontend/src/hooks/useRadioConnection.js` — full WebRTC + audio lifecycle
- `frontend/src/components/RadioPanel.jsx` — UI panel (TUNE, PTT, DISCONNECT, participant list)
- `backend/routes/radio.js` — TURN credentials + frequency access gate
- `backend/.env` — `TURN_SERVER`, `TURN_SECRET`

---

## 7. KNOWN ISSUES / BUGS OPEN

### P1 — Port Conflict (Blocks Public Launch)
Port 3000 occupied by `raleigh_distance/server.js` (PID 2223). Backend on 3099 works but is non-standard. Must kill PID 2223 and update `backend/.env PORT` + `frontend/vite.config.js` proxy target before public exposure.

### P2 — DNS Not Configured
`nexus.app-palette.com` CNAME not yet pointing to kylo-mini. Cloudflare Tunnel is running but the public URL is not yet set.

### P3 — Discord OAuth2 Redirect URI Not Updated
`DISCORD_REDIRECT_URI` in `backend/.env` must match the final public domain before Discord OAuth will work from the public URL.

### P4 — Console.logs Not Removed
Debug `console.log` statements remain in:
- `frontend/src/components/ShipSchematic.jsx` (Node Click, Manifest Reserve)
- `frontend/src/pages/Dashboard.jsx` (Reserve)
- `backend/routes/crew.js` (Crew Reserve, Withdraw)  
Remove after slot reservation is confirmed stable in production.

### P5 — Pilot Requirement Disabled (Temporary)
Pilot check in `validateMissionForLaunch` and `PATCH /:id/status` FINALIZED branch is commented out for solo testing. Minimum crew is set to 1 (was 2). Restore before public launch. See `TODO: re-enable Pilot check` comments in `missionService.js` and `missions.js`.

### P6 — Ship Schematic PNG Not Placed
`/public/images/ships/polaris_schematic.png` referenced in old code but the holographic style now uses thumbnails from `ship_index.json`. Verify no dead image references remain.

### P7 — node_positions May Need Tuning
`Ship.node_positions` array exists but the schematic now uses `computeNodePositions(roleNames)` dynamic layout. The manual coordinates in `node_positions` are unused in practice. Either deprecate the field or wire it into the schematic renderer.

### P8 — WebRTC Mesh Scalability
Current mesh topology means N*(N-1)/2 peer connections for N users. Works for 2–6 players. If crews exceed 8+, switch to SFU architecture (Mediasoup or LiveKit).

---

## 8. PLANNED FEATURES (NEXT)

Priority order as of 2026-06-30:

1. **DNS + OAuth fix** — CNAME `nexus.app-palette.com`, update Discord redirect URI, kill port 3000 conflict. Required before any external testing.

2. **Remove debug console.logs** — Clean up all debug statements listed in Known Issues P4.

3. **Re-enable pilot check + min crew = 2** — Restore production launch validation. Uncomment the 4 `TODO: re-enable Pilot check` blocks.

4. **Ship specs auto-populate on registration** — When a player registers a ship, `ship_specs.json` should pre-populate `crew_roles` based on the selected ship model's crew count. Currently `crew_roles` defaults to empty and must be set manually or via the mission wizard.

5. **Wire `ship_model` into Discord bot** — Bot ship creation flow should set `ship_model` field to enable thumbnail lookups from the web UI.

6. **Post-mission log UI** — Players need a UI to submit mission logs (`POST /api/logs`) to earn `POST_MISSION_LOG` RP. Currently the backend endpoint exists but the frontend submit flow is not connected.

7. **AI summary display** — GPT-4o-mini generates summaries every 72hrs. No UI exists to surface them. Add to Dashboard or a dedicated "Briefing" panel.

8. **Leaderboard page** — `/leaderboard` route with paginated RP rankings. Backend `GET /api/rp/leaderboard` exists.

9. **Admin panel** — `/admin` for Platform Owner to update PlatformConfig (mission types, ship types, crew roles, RP settings, ranks, ship limits, AI toggle).

10. **Org management panel** — Org Commander view: member list, invite code display, org ship roster.

11. **SFU upgrade for radio** — Replace mesh WebRTC with Mediasoup or LiveKit for crews > 6.

12. **Sound system completion** — Wire remaining ~25 placeholder MP3s to UI events (crew join, mission launch, rank up, alert, keypress).

13. **Three.js ship viewer** — Holographic orbital camera viewer for ship detail pages (was in original spec, deferred).

---

## 9. ACTIVE PLAYERS / TESTERS

**Platform Owner**: `jonassumafi` (Discord ID set in `PLATFORM_OWNER_DISCORD_ID` env var)

External testers: Not yet onboarded. DNS and OAuth redirect must be fixed before external testing is possible.

Seed data active in NexusDB:
- 5 missions (mix of WAITING FOR CREW, IN PROGRESS, COMPLETE)
- 7 ships (all `ship_model: 'RSI Polaris'`)
- 3 seed users
- 1 org

Seed script: `~/nexus/backend/utils/seedMissions.js` — re-runnable, idempotent via `updateMany`.

---

## 10. CLAUDE CODE SESSION

### How to Resume

```bash
cd ~/nexus
# Check PM2 status
pm2 list

# Backend logs
pm2 logs nexus-backend --lines 50

# Frontend logs
pm2 logs nexus-frontend --lines 50

# Restart after backend changes
pm2 restart nexus-backend && pm2 save

# Rebuild + restart after frontend changes
cd ~/nexus/frontend && npm run build && pm2 restart nexus-frontend && pm2 save
```

### Claude Code Conventions (from DECISIONS.md)

**Session summary format** — always two sections only:
- **CHANGES** — what was built or modified, files touched, line counts where relevant
- **FUTURE DESIGN CONSIDERATIONS** — architectural improvements, refactoring opportunities

Do not include OBSTACLES or ISSUES TO REMEDY sections.

### Reference Files for Next Session

When resuming, read these files in order:
1. `docs/HANDOFF_V3.md` (this file) — full context
2. `backend/routes/missions.js` — mission lifecycle + socket emit payloads
3. `backend/services/missionService.js` — completeMission / abortMission
4. `backend/services/rpService.js` — all RP award functions
5. `frontend/src/pages/Dashboard.jsx` — main app logic, formatFeedText, all socket handlers
6. `frontend/src/hooks/useRadioConnection.js` — radio + WebRTC lifecycle
7. `discord bot/` directory — authoritative reference for business rules (D-018)

### Active PM2 Processes

| Name | PM2 ID | Port | Command |
|---|---|---|---|
| nexus-backend | 7 | 3099 | `node server.js` |
| nexus-frontend | 6 | 4173 | `serve dist/` |

### Environment

- OS: Ubuntu 24.04 on kylo-mini
- Node: check with `node --version`
- MongoDB: local on `localhost:27017`, database `NexusDB`
- Cloudflare Tunnel: running (check with `cloudflared tunnel list`)
- Coturn: running on ports 3478 / 5349

### Recent Sessions (15+)

Sessions covered in `docs/PROJECT_LOG.md`. Most recent work (Session 15+, 2026-06-30):
- Fixed WebRTC `leaveFrequency()` — complete audio teardown (mic tracks, AudioContext, filter chain, all refs nulled)
- Fixed `mission_launched` / `mission_finalized` socket emit field names (`name` → `mission_name`)
- Fixed `mission_complete` / `mission_aborted` field names (`missionName` → `mission_name`)
- Added `citizen_name` fallback (`?? req.user.username ?? 'UNKNOWN OPERATOR'`) in all crew route emits
- Suppressed `+0 RP` in activity feed for all event types
- Made `addRPForMissionLaunch` return points so launch route can include `rp_awarded` in socket emit
- Completed bot RP audit (side-by-side comparison of bot `rp_handler.py` vs Nexus `rpService.js`)
