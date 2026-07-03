# Nexus 1.0 — Feature Registry

Numbered registry of every discrete feature or implementation prompt across all layers of the stack. One entry per feature. Referenced by PROJECT_LOG.md session entries.

---

## Feature 1 — Backend Foundation

**Date**: 2026-06-27  
**Layer**: backend  
**Description**: Full Node/Express backend scaffolded with all models, routes, services, jobs, and seed data.

**Implementation**:
- 11 Mongoose models created with complete schemas: PlatformConfig (singleton), User, Organization, Ship, Mission, MissionArchive, MissionLog, RPLedger, ShipRPLedger, ShipModel, AISummary
- 9 route files covering all API surface — 45 endpoints total
- `rpService.js` — mirrors Discord bot RpHandler exactly: MISSION_LAUNCHED (+1), POST_MISSION_LOG (+3), CREW_SLOT_FILLED (+1 or +2 based on fill %), SHIP_FILL_BONUS (+3); atomic rank advancement emits `rank_advanced` socket event
- `missionService.js` — validateMissionForLaunch (pilot check, min 2 crew), completeMission (archive snapshot, reset, RP awards), resetMissionAssociations
- `socketManager.js` — JWT auth on handshake, users join `global` + `org_<id>` + `user_<id>` rooms, 11 event types
- `cloudinaryService.js` — portrait upload (profiles/user_{id}), ship model upload (ship_models/{category}/{name}), delete, info
- `aiService.js` — GPT-4o-mini, max_tokens 350, temperature 0.2, 72hr batch summary
- `scheduler.js` — 4 cron jobs: crew fill % recalc (*/2), queue expiry (*/5), stale mission cleanup (0 *), AI summary (0 0 */3)
- `seed.js` — auto-inserts PlatformConfig on cold start with 13 ranks, 11 mission types, 19 ship types, 5 crew roles
- Discord OAuth2 + JWT (7-day) auth flow; first login matching PLATFORM_OWNER_DISCORD_ID gets is_platform_owner
- Permission middleware: isAuthenticated, isPlatformOwner, isOrgCommander

**Files touched**: All files under `~/nexus/backend/` (29 files created)

**Notes**: Running on port 3099. Port 3000 occupied by raleigh_distance (PID 2223); kill PID 2223 to free it for production.

---

## Feature 2 — Splash Screen Design

**Date**: 2026-06-27  
**Layer**: design  
**Description**: DOS boot sequence splash screen with embedded comms.mp3 audio, designed as a static HTML mockup.

**Implementation**:
- 16-line staggered boot sequence over ~8.5s using CSS animation delays
- `comms.mp3` (18.4s) plays in full from the moment the page loads — no fade, no trim
- Amber `#FFB800` on pure black (`#000000`), Courier New monospace, font-size 14px
- CSS scanlines overlay (repeating-linear-gradient) + radial vignette for CRT aesthetic
- Blinking cursor (`|`) on the final "WELCOME TO NEXUS 1.0" line, implemented via CSS `@keyframes blink`
- "PRESS ANY KEY TO CONTINUE" prompt fades in after all 16 boot lines appear
- Keypress handler: `audio.pause()`, CSS fade-to-black transition over 800ms, placeholder text "LOADING DASHBOARD..."
- Delivered as standalone `nexus_splash.html` with base64-encoded audio embedded in `<audio>` src

**Files touched**: `nexus_splash.html` (static mockup, not yet in repo)

**Notes**: Production build will reference `/public/sounds/comms.mp3` rather than base64. Integration into React/Vite frontend deferred to a future feature.

---

## Feature 3 — Frontend Scaffold

**Date**: 2026-06-27  
**Layer**: frontend  
**Description**: React/Vite frontend scaffolded with routing, auth hooks, socket hook, API service, global DOS styles, AsciiBox component, and Splash screen fully implemented.

**Implementation**:
- Installed dependencies: react-router-dom, axios, socket.io-client, three, @react-three/fiber, @react-three/drei
- `vite.config.js` — server port 5173, proxy `/api/*` and `/socket.io/*` → `http://localhost:3099`
- `src/styles/global.css` — full DOS terminal design system: `#000` bg, `#FFB800` amber, `#FFD44D` highlight, `#7A5C00` dim, `#00BB55` green, `#3A2800` border, Courier New font, scanlines utility class, vignette utility class, `.cursor` blink animation, `.prompt-pulse` pulse animation, terminal scrollbar
- `src/utils/constants.js` — BACKEND_URL, EVENTS map (11 socket events), MISSION_STATUS enum
- `src/services/api.js` — axios instance with baseURL `/api`, request interceptor attaches JWT from localStorage, response interceptor clears token and redirects to `/` on 401
- `src/hooks/useAuth.js` — reads JWT from localStorage on mount, exposes user (decoded payload), token, login(), logout(), isAuthenticated; decodes JWT with native atob() (no library)
- `src/hooks/useSocket.js` — connects socket.io-client to `/` with `{ auth: { token } }`, exposes socket ref and connected boolean, disconnects on unmount
- `src/context/AuthContext.jsx` — AuthProvider wrapping useAuth, useAuthContext() hook
- `src/context/SocketContext.jsx` — SocketProvider (reads token from AuthContext) wrapping useSocket, useSocketContext() hook
- `src/components/AsciiBox.jsx` — ASCII border wrapper using box-drawing chars (╔═╗║╚╝╠╣), ResizeObserver-based width measurement, 8.4px/char calculation, optional title with ╠═╣ divider, border color `#3A2800`
- `src/pages/Splash.jsx` — full DOS boot sequence: 9 animated lines with randomized durations (scaled to ≤28s), dot animation 80ms tick cycling 20 slots, sequential group execution, gaps after groups 1 and 2, WELCOME line with blinking cursor, PRESS ANY KEY prompt with pulse, audio wiring for hdd.mp3 (loop), keyboard.mp3 (per resolve), uplink.mp3 (line 8 only), fade-to-black + navigate on keypress/click
- `src/pages/Dashboard.jsx` — stub with AsciiBox wrapper
- `src/pages/MissionBoard.jsx` — stub
- `src/pages/ShipViewer.jsx` — stub
- `src/pages/CrewPanel.jsx` — stub
- `src/pages/Onboarding.jsx` — stub
- `src/pages/Admin.jsx` — stub
- `src/main.jsx` — AuthProvider → SocketProvider → BrowserRouter with all 7 routes; imports global.css

**Files touched**:
```
frontend/vite.config.js
frontend/src/main.jsx
frontend/src/styles/global.css
frontend/src/utils/constants.js
frontend/src/services/api.js
frontend/src/hooks/useAuth.js
frontend/src/hooks/useSocket.js
frontend/src/context/AuthContext.jsx
frontend/src/context/SocketContext.jsx
frontend/src/components/AsciiBox.jsx
frontend/src/pages/Splash.jsx
frontend/src/pages/Dashboard.jsx
frontend/src/pages/MissionBoard.jsx
frontend/src/pages/ShipViewer.jsx
frontend/src/pages/CrewPanel.jsx
frontend/src/pages/Onboarding.jsx
frontend/src/pages/Admin.jsx
```

**Notes**: `npm run dev` starts cleanly on port 5173. Audio files (`hdd.mp3`, `keyboard.mp3`, `uplink.mp3`) not yet in `/public/sounds/` — audio calls are wrapped in try/catch and fail silently. Sound wiring is complete; files to be added separately.

---

## Feature 4 — Onboarding Wizard

**Date**: 2026-06-27  
**Layer**: frontend + backend  
**Description**: 8-screen citizen registration wizard with AI portrait generation via Gemini, ID card preview, org affiliation declaration, and RP rank briefing.

**Implementation**:

*Backend:*
- `backend/.env` — added `GEMINI_API_KEY`
- `backend/routes/auth.js` — JWT payload expanded to include `discord_id`, `username`, `onboarding_complete` so frontend can decode without extra API call
- `backend/routes/users.js` — `POST /api/users/onboarding`: validates not-already-onboarded, applies all citizen fields, handles org join via invite_code or marks freelancer, sets initial rp_rank from PlatformConfig, re-issues JWT with `onboarding_complete: true`
- `backend/routes/users.js` — `POST /api/users/generate-portrait`: calls Gemini `gemini-2.0-flash-preview-image-generation` with cinematic portrait prompt, extracts base64 image from response, uploads to Cloudinary under `nexus/portraits/portrait_{discord_id}`, returns portrait_url; errors surface as 500 (not swallowed)
- `backend/routes/rp.js` — `GET /api/rp/ranks`: public, returns `PlatformConfig.rp_ranks` array
- `backend/services/cloudinaryService.js` — added `uploadPortraitFromBase64(discordId, base64Data, mimeType)` for data-URI upload from Gemini response

*Frontend:*
- `frontend/src/main.jsx` — `RouteGuard` component: authenticated + not onboarded → force `/onboarding`; onboarded + at `/onboarding` → bounce to `/dashboard`. `AuthCallback` component at `/auth/callback` reads `?token=` from Discord OAuth redirect, calls `login()`, navigates to `/dashboard`
- `frontend/src/pages/Onboarding.jsx` — 8-screen wizard:
  - Screen 1: Welcome lore text, INITIATE REGISTRATION button
  - Screen 2: System unlocks terminal readout (6 items, green ENABLED labels)
  - Screen 3: Border intake — citizen_name, place_of_birth, citizenship fields (all required)
  - Screen 4: Biography textarea, min 20 chars, live character count
  - Screen 5: Portrait generation — textarea for description, calls POST /users/generate-portrait, dot cycling animation during load, preview with ACCEPT/REGENERATE buttons
  - Screen 6: ID card — 600×340 placeholder card (`#0a0a0a` bg, amber border), portrait image overlay, citizen data overlaid, "ASSET PENDING" notice for background image
  - Screen 7: Org affiliation — two clickable option boxes (JOIN ORG / FREELANCER), invite code input appears on org selection, forced uppercase 6-char
  - Screen 8: RP ranks table (fetched from GET /rp/ranks, scrollable), citizen summary text, ENTER NEXUS submit button; calls POST /users/onboarding, login() with returned token, navigate to /dashboard

**Files touched**:
```
backend/.env
backend/routes/auth.js
backend/routes/users.js
backend/routes/rp.js
backend/services/cloudinaryService.js
frontend/src/main.jsx
frontend/src/pages/Onboarding.jsx
```

---

## Feature 5 — Onboarding Fixes + Frontend Deploy

**Date**: 2026-06-27  
**Layer**: frontend + backend + infra  
**Description**: 10 fixes applied across the onboarding wizard, ASCII border component, splash screen, backend seed data, and PM2/tunnel deployment.

**Implementation**:

- **Fix 1** — All inputs, textareas, and select dropdowns in Onboarding.jsx verified to use `background: #000` and `border: 1px solid #FFB800`; dedicated `S.select` style block added
- **Fix 2** — Global terminology rename: `AFTERMATH_LOG` / `aftermath log` → `POST_MISSION_LOG` / `post-mission log` in all backend services, models, routes, seed, frontend, and docs
- **Fix 3** — Screen 1 body text replaced with NCP interfacing copy referencing citizen registration and the criminal record policy
- **Fix 4** — Screen 3 CITIZENSHIP field replaced with styled `<select>` dropdown; options grouped by Star Citizen system (Stanton, Sol, Terra, Magnus, Vega, Elysium, Davien, Bremen, Other); custom ▼ indicator; `appearance: none`
- **Fix 5** — Screen 4 redesigned: header "CHARACTER DESCRIPTION", 100-word limit with live counter ("0 / 100 words"), counter turns `#CC4400` at limit, input blocked beyond 100 words, button renamed "[ CONFIRM DESCRIPTION ]"
- **Fix 6** — `POST /api/users/refine-biography` added to backend (Gemini `gemini-2.0-flash` with SC-universe biography prompt, two sentences, no em dashes/colons). Screen 6 calls it on mount, stores `refinedBiography` in formData, displays on ID card; fail-silent with `formData.biography` as fallback; "[ BIOGRAPHY REFINED BY NEXUS AI REGISTRY SYSTEM ]" shown in dim amber
- **Fix 7** — Screen 8 paragraph order swapped (RP/rank line first, welcome line second); copy updated to "post-mission logs"; rank table shows 13 hardcoded ranks from Drifter to Hopewell Steward; live fetch from GET /rp/ranks with dot animation; falls back to hardcoded list on failure
- **Fix 8** — `seed.js` updated: 13 ranks (Drifter 0–49 through Hopewell Steward 2400+), `POST_MISSION_LOG` key replaces `AFTERMATH_LOG`; `migratePlatformConfig()` function added — runs on every server startup, updates existing PlatformConfig document in-place (rename key, replace ranks array)
- **Fix 9** — `AsciiBox.jsx` rebuilt: top/bottom borders rendered as `overflow:hidden` character strings that always fill exact container width; left/right walls use `border-left` / `border-right` CSS instead of character columns; ResizeObserver drives column calculation; Splash.jsx benefits automatically (uses AsciiBox)
- **Fix 10** — Frontend built with `npm run build`; served via `pm2 serve dist 5173 --name nexus-frontend --spa`; backend started via `pm2 start server.js --name nexus-backend` (port 3099); Cloudflare Tunnel ingress rule added for `nexus.app-palette.com → localhost:5173`; cloudflared restarted

**Files touched**:
```
backend/.env
backend/server.js
backend/models/PlatformConfig.js
backend/routes/logs.js
backend/routes/users.js
backend/services/rpService.js
backend/utils/seed.js
frontend/src/components/AsciiBox.jsx
frontend/src/pages/Onboarding.jsx
frontend/dist/ (built output)
/etc/cloudflared/config.yml
docs/SPEC.md
docs/FEATURES.md
docs/PROJECT_LOG.md
docs/SCHEMA.md
```

**Notes**:
- DNS CNAME record `nexus → ea6bd485-ba3a-45fe-88dd-bf7c778b0486.cfargotunnel.com` must be added manually in the Cloudflare dashboard for nexus.app-palette.com to resolve publicly
- Discord OAuth Redirect URI will need updating to `https://nexus.app-palette.com/auth/callback` in the Discord Developer Portal when going live

---

## Feature 6 — Dashboard

**Date**: 2026-06-27  
**Layer**: frontend + backend  
**Description**: Full mission-board dashboard with 3-panel layout, real-time socket updates, crew slot management, and activity feed.

**Implementation**:

*Backend:*
- `backend/models/PlatformConfig.js` — added `display_timezone: { type: String, default: 'UTC' }`
- `backend/utils/seed.js` — `migratePlatformConfig()` extended to set `display_timezone: 'UTC'` on existing documents missing the field
- `backend/routes/missions.js` — enhanced `GET /`: org members see org + public missions; freelancers see public only; active missions only by default (`$nin: ['COMPLETE', 'ABORT']`), override with `?all=1`; each result includes `is_org_mission` boolean
- `backend/routes/logs.js` — added `GET /` activity feed: merges last N MissionLog + RPLedger entries (populated), sorted by timestamp desc; returns normalized `{ _id, type, citizen_name, mission_name, log_text?, event_code?, points?, timestamp }` array; limit capped at 50

*Frontend:*
- `frontend/src/utils/time.js` — `formatTimestamp(iso, timezone)` and `getTimezoneAbbr(timezone)` utilities using Intl.DateTimeFormat
- `frontend/src/pages/Dashboard.jsx` — full dashboard:
  - Top bar: NEXUS 1.0 title, citizen name, RP rank + amber progress bar, [ DISCONNECT ] button
  - Left panel (220px): scrollable mission list; status color-coded (OPEN/FINAL/LIVE/DONE/ABRT); ORG vs PUB badge; dot animation while loading
  - Center panel (1fr): selected mission detail — name, type, status, objectives, ship manifest with crew slots (reserve/withdraw via +/× inline), action buttons by status/role (FINALIZE/LAUNCH/COMPLETE/ABORT/POST LOG), post-log textarea
  - Right panel (200px): activity feed from GET /logs?limit=20; LOG entries show citizen + mission name; RP entries show event label + points
  - Real-time: socket events refresh missions (slot_reserved, slot_withdrawn, crew_fill_updated, mission_launched/complete/finalized/aborted), me (rp_earned, rank_advanced), feed (log_submitted)
  - Timezone: tries GET /admin/config for display_timezone, falls back to UTC on 403

**Files touched**:
```
backend/models/PlatformConfig.js
backend/utils/seed.js
backend/routes/missions.js
backend/routes/logs.js
frontend/src/utils/time.js
frontend/src/pages/Dashboard.jsx
frontend/dist/ (rebuilt)
```

---

## Feature 7 — Ship Schematic Viewer

**Date**: 2026-06-27
**Layer**: frontend + backend
**Description**: Interactive Polaris schematic with 16 crew slot nodes, color-coded by state, with reserve/withdraw via node click or manifest list. Multi-ship navigation with prev/next arrows.

**Implementation**:

*Frontend:*
- `frontend/src/components/ShipSchematic.jsx` — new component:
  - 16 NODE_POSITIONS mapped as percentage coordinates over a 280px schematic viewport (`/images/ships/polaris_schematic.png`)
  - `findRoleInShip(posName, crewRoles)` — exact match then case-insensitive partial match; dim placeholder node if no match
  - `SlotNode` sub-component: 18px circle, state-driven color (OPEN `#00FF66` pulse, TAKEN `#FF5544`, YOURS `#00EEFF`, DIM `#1A3D55`), hover tooltip with role name + action hint, 8px label below node
  - `nodeP` CSS keyframe (added to global.css): `translate(-50%,-50%) scale(1) → scale(1.18) → scale(1)` at 1.5s infinite, applied to OPEN nodes only
  - Crew manifest below schematic: one row per role, `[ OPEN ]` clickable in `#00FF66`, citizen name in `#00EEFF` + `[ WITHDRAW ]` link for current user's slots
  - Multi-ship nav row with ← PREV / CURRENT (bold `#99CCFF`) / NEXT → labels; hidden when only one ship
  - `clickSound` plays on every node and manifest click
  - `onSlotClick(shipId, roleName)` — parent determines reserve vs withdraw by checking filled array
  - All nodes non-clickable when missionStatus is not WAITING FOR CREW or FINALIZED; tooltip shows "MISSION IN PROGRESS"
- `frontend/src/pages/Dashboard.jsx`:
  - Added `import ShipSchematic from '../components/ShipSchematic'`
  - Removed `ShipCard` component entirely
  - `MissionDetail` adds `shipIndex` state + `ships` array (primary + supporting); builds `handleSlotClick(shipId, roleName)` that checks filled array to determine reserve vs withdraw
  - ShipSchematic replaces the old ship manifest block in center panel
  - `key={selectedMission._id}` on MissionDetail to auto-reset shipIndex when mission selection changes
- `frontend/src/styles/global.css` — added `@keyframes nodeP` for crew slot pulse animation

*Backend:*
- `backend/routes/crew.js` — existing `POST /crew/reserve` and `POST /crew/withdraw` confirmed correct; use `role` field in request body
- `backend/routes/users.js` — fixed Gemini import: `GoogleGenerativeAI` → `GoogleGenAI`, constructor call updated to `new GoogleGenAI({ apiKey })`, `generationConfig` → `config`, `responseModalities` array uses `Modality.TEXT` / `Modality.IMAGE` enum values

**Files touched**:
```
frontend/src/components/ShipSchematic.jsx  (new)
frontend/src/pages/Dashboard.jsx
frontend/src/styles/global.css
frontend/public/images/ships/             (directory created for schematic assets)
backend/routes/users.js                   (Gemini fix)
docs/FEATURES.md
docs/PROJECT_LOG.md
```

**Notes**:
- Polaris schematic image `/images/ships/polaris_schematic.png` not yet placed; schematic viewport shows dark background (`#050A0F`) until asset is added
- Node positions are tuned for Polaris top-down schematic; adjust NODE_POSITIONS percentages once the actual image is in place
- `crew_roles[role].filled` contains MongoDB ObjectIds — comparison uses `String()` coercion; citizen names for other players not available without populating filled array; TAKEN nodes show fill count only

## Feature 8 — UI/UX Fixes + Dummy Data + Disconnect Screen (Session 9)

### Disconnect Screen
- New `/disconnect` route (`src/pages/Disconnect.jsx`): DOS-style session termination sequence
- Lines appear staggered every 200ms, auto-redirects to splash after 1200ms post-sequence
- Plays click.mp3 on mount; clears `nexus_token` from localStorage before redirect
- Dashboard `[ DISCONNECT ]` now navigates to `/disconnect` instead of direct logout

### Global Scale
- `global.css` base font-size: 14px → 20px
- `AsciiBox.jsx`: font-size 13px → 18px, CHAR_W 8.4 → 11, inner padding 20px 24px → 30px 36px
- Dashboard panels, cards, buttons, feed: all sizes scaled up (see Dashboard.jsx)
- Onboarding S-object: all font-sizes × 1.5, padding × 1.5, wizard max-width 760 → 800

### Onboarding Fixes
- Back button: larger (15px), more visible border (#2A6A9A), text color #4488BB
- Screen 2 subtitle font-size: 11px → 15px
- Screen 4: "CHARACTER DESCRIPTION" → "CITIZEN BIOGRAPHY", vocabulary updates throughout
- Screen 5: simplified subheader and placeholder text
- Screen 6 (ID card): real UEE-IDCard.png background, portrait overlaid at 18%/3%, data fields at percentage positions; biography and AI attribution removed; rank (DRIFTER) and reg date added
- Screen 8: `[ ENTER NEXUS ]` plays transmitting.mp3 (5s cut) instead of modem.mp3
- Step title format: "STEP 4 OF 8 —" → "STEP 04 / 08 —"

### Splash Fixes
- Boot sequence cannot be skipped: keydown/click handlers only registered after `prompt` state is true
- Click sound plays on keypress/click after boot sequence completes

### Dummy Mission Data
- Seed script: `backend/utils/seedMissions.js` — runs on server startup, skips if missions exist
- 3 dummy users, 1 org (Hopewell Continuum / HWCONT), 7 ships, 4 missions seeded
- Missions cover all 4 statuses: WAITING FOR CREW, FINALIZED, IN PROGRESS, COMPLETE

### Sound
- `transmitting.mp3` cut to 5s from `~/nexus/transmitting.mp3` (original at `transmitting_original.mp3`)

## Feature 9 — Gate Screen + Branding + Dashboard UI (Session 10)

### Gate Screen (`src/pages/Gate.jsx`)
- New first-screen before Splash; purpose: capture user gesture for HDD audio autoplay
- Pure black + scanlines + vignette, 4 corner brackets (#1A3D55), centered layout
- Title stack: "FRONTIER OPERATORS GUILD" (28px/dim) / "NEXUS INTERSTELLAR TRAFFIC SYSTEM" (48px/bold/#99CCFF) / "v1.0 · 2956 SEY" (32px/#2A6A9A)
- Divider 140×1px + pulsing button "[ CLICK TO INITIATE ]" (36px, `gate-btn gate-pulse` CSS class)
- On click: HDD audio starts (0.25 vol), 5s dot sweep animation, fade-out, navigate(/splash) at 5.5s
- Sets `sessionStorage hdd_started=true` before navigation so Splash can resume HDD

### Routing (`src/main.jsx`)
- `/` → Gate, `/splash` → Splash (Splash moved from root)
- RouteGuard exempts both `/` and `/splash` from onboarding redirect

### Branding Updates
- Splash.jsx header: "NEXUS COORDINATION PROTOCOL v1.0" → "NEXUS INTERSTELLAR TRAFFIC SYSTEM v1.0"
- Splash.jsx copyright: "Copyright (c) 2950 Nexus Systems." → "COPYRIGHT 2956 FRONTIER OPERATORS GUILD"
- Onboarding Step1: matching header + body text updated to "Nexus Interstellar Traffic System"
- Gate screen uses full branding by design

### Splash Audio
- HDD volume: 0.4 → 0.25 (matches Gate)
- On mount: checks `sessionStorage hdd_started` — if set, starts HDD unmuted immediately, clears flag, enables audio button indicator

### Dashboard MissionCard (FIX 4)
- Shows stripped mission name (prefix before `:` removed), 16px/#99CCFF
- Mission type badge with hover tooltip showing description (from /api/missions/types)
- "PRIMARY: [ship_name] +N SHIPS" crew ship summary
- Animated crew fill progress bar (height 3px, amber fill)
- Status abbreviation badge (OPEN/FINAL/LIVE/DONE/ABRT)

### Dashboard MissionDetail (FIX 4)
- Title: stripped name in #CCE8FF, bold, 20px
- Meta line: "[emoji] [TYPE] · CREATED BY [name] · [date]"

### Dashboard Submit Mission Log (FIX 5)
- Renamed POST LOG → SUBMIT MISSION LOG
- WAITING FOR CREW / FINALIZED / ABORT: button hidden
- IN PROGRESS: grayed-out button, cursor:default, title="Available after mission is complete"
- COMPLETE: fully clickable

### Dashboard UEE ID Card Thumbnail (FIX 6)
- "NEXUS 1.0" label replaced with 160×100 ID card thumbnail (UEE-IDCard.png + portrait overlay)
- Hover popover: full 500px ID card with portrait, citizen name, origin, citizenship, discord, rank, reg date
- Citizen name text + RpBar remain to the right of the thumbnail

### Backend (Session 10)
- GET /api/missions now returns all missions (no org filter), enriched crew names
- GET /api/missions/types endpoint added (before /:id to avoid shadowing)
- seedMissions.js: always re-seeds PlatformConfig with 11 mission types (with emoji+description); Mission 5 RECON: PYRO IV BELT added with discord_id string fills

## Feature 10 — Ship Thumbnails + Holographic Schematic + Crew Fix (Session 11)

### Ship Thumbnail Assets
- 260 ship top-down view images downloaded from scorg.tools (200px) to `public/images/ships/thumbnails/`
- `public/images/ships/ship_index.json`: index mapping normalized ship type keys to thumbnail URLs
- Key format: `{manufacturer}_{model}` or `{model}` (e.g. `rsi_polaris`, `origin_100i`)

### ShipSchematic — Holographic CSS Filter (FIX 1)
- Fetches `ship_index.json` on mount; normalizes `ship.type` to index key with manufacturer suffix fallback
- Two-div structure: outer container (position:relative, no filter) + inner bg div (CSS filter) + nodes as siblings
- Holographic filter: `invert(1) sepia(1) saturate(3) hue-rotate(175deg) brightness(0.55) contrast(1.2)`
- `paddingBottom: 30%` (reduced from 50%)
- `borderBottom: 1px solid #0D2030` on outer container
- Placeholder `[ NO SCHEMATIC ]` when no thumbnail matched

### ShipSchematic — Nav Arrows (FIX 3)
- Ship name: 32px/#99CCFF/bold (center)
- Arrows: 16px text + 28px ◀/▶ glyph; `visibility: hidden` (not `color: transparent`) to preserve centering

### ShipSchematic — Node Circles (FIX 4)
- All node divs now use `className="nexus-node"` for `border-radius: 50% !important` override
- `width: '18px', height: '18px'` (explicit string units)

### ShipSchematic — Legend (FIX 5)
- Position absolute at bottom-left of schematic area (bottom:10, left:14, z-index:10)
- OPEN #00FF66 / OCCUPIED #FF5544 / YOUR SLOT #00EEFF; 11×11px color squares + 12px #2A6A9A labels

### ShipSchematic — Slot Click Action (FIX 7)
- SlotNode determines action from state: open→'reserve', yours→'withdraw', taken→nothing
- Action string passed through: `onSlotClick(roleName, action)` → `onSlotClick(ship._id, rn, action)`

### ShipSchematic — Manifest Fill % (FIX 9)
- Fill % computed live from `crew_roles` data, not stale `ship.crew_fill_percentage`
- Manifest header: ship name in `#1A3D55`, fill % in `#FFBB33`

### Dashboard — Center Panel Header (FIX 2)
- Center panel wrapper `padding: 0`; MissionDetail owns its own section padding
- Header section `padding: '20px 24px', borderBottom: '1px solid #0D2030'` contains:
  - Mission name: 28px/#CCE8FF/bold/letterSpacing:0.04em
  - COMMANDER: 16px/#2A6A9A + citizen name in #66AADD
  - Type line: 16px/#4488BB/letterSpacing:0.06em (with emoji if available)
  - OBJECTIVES label: 13px/#1A3D55/letterSpacing:0.16em
  - Objectives text: 15px/#B88000/lineHeight:1.75
- Status/ORG/PUB/date removed from mission header

### Dashboard — handleSlotClick Fix (FIX 7/8)
- Accepts explicit `action` param ('reserve'|'withdraw'); no longer uses `filled.map(String)` isYours check
- On 400 error (already assigned): `flashMySlots` state fires for 800ms, pulsing the user's nodes

### Dashboard — Ship Thumbnails in MissionCard (FIX 12)
- Dashboard fetches `ship_index.json` on mount → `shipThumbs` state passed to MissionCard
- MissionCard shows 40px holographic thumbnail for primary ship (same filter as schematic)

### Backend — One Slot Per Ship (FIX 6)
- `/crew/reserve`: checks ALL roles on ship before allowing reserve; returns 400 "Already assigned to a slot on this ship."
- Handles both ObjectId and discord_id string entries in filled arrays

### Backend — Withdraw Fix (FIX 8)
- `/crew/withdraw` filter now handles both MongoDB ObjectId entries and discord_id strings
- Removes entries where `fStr === userId` OR `fStr === discordId`

### Backend — filled[] Migration (FIX 11)
- `migrateFilledToDiscordIds()` runs on every startup
- Converts ObjectId filled entries in missions 1-4 ships to discord_id strings via User lookup
- Idempotent: skips entries that are already strings

---

## Feature 13 — Badge System + UI Polish

**Date**: 2026-06-28  
**Layer**: frontend  
**Description**: Color-coded mission type badges, fixed tooltip positioning, slot reservation debug, schematic background fix, ID card static display, global text brightness, scrolling panels, mission board header with available count.

**Implementation**:
- `TypeBadge` component: 11 accent-colored badges (Combat red, Escort green, Logistics amber, Reconnaissance blue, Salvage purple, Mining orange, Bounty pink, Patrol teal, Assassination crimson, Rescue sky, Assault orange-red); `DEFAULT_BADGE` fallback for unknown types
- Tooltip: `position:fixed` + `getBoundingClientRect()` — escapes overflow:hidden clipping in all panel containers; z-index 9999
- `IdCard` replaces `IdCardThumbnail`: 320×198 static card, no hover/popover, citizen name + fields overlaid
- Text brightness: Btn default text #66AADD, panel headers #4488BB, manifest role names #66AADD, activity feed entries #66AADD, timestamps #2A6A9A
- Center panel: flex column structure — fixed header, scrollable body (flex:1/overflow-y:auto/min-height:0), fixed button footer
- `availableCount` computed from missions array; shown in left panel header
- Schematic `paddingBottom` 30% → 21%; crew manifest text/header color fixes; [ OPEN — CLICK TO RESERVE ] text
- Global 4px scrollbar in `global.css`

---

## Feature 15 — Mission Creator Controls

**Date**: 2026-06-28  
**Layer**: Frontend + Backend

### Description

Pulsing mission control buttons in the center panel header, animated status badge with dot pulse, PREPARE FOR LAUNCH → LAUNCH flow with minimum crew gate, and auto-hide of completed/aborted missions after 5 minutes.

### Details

- **StatusBadge** (pulsing dot + label): WAITING FOR CREW (amber pulse), PREPARING FOR LAUNCH/FINALIZED (blue pulse), IN PROGRESS (fast green pulse), COMPLETE/ABORTED (static dim)
- **Creator Controls** (right column, header): Three buttons per status — PREPARE FOR LAUNCH (pulsing blue), LAUNCH MISSION (pulsing green), ABORT MISSION (red); state-locked buttons show dim/flat variants
- **Minimum crew gate**: PREPARE FOR LAUNCH checks Pilot filled + total slots ≥ 2 before calling API; error displayed inline
- **PATCH /api/missions/:id/status**: New creator-only endpoint (replaces per-action PUT routes for frontend); validates transitions, sets hidden_at on terminal statuses
- **Auto-hide**: `hidden_at` field on Mission; GET / uses $or filter (null OR within last 5 min); 1-min scheduler job backfills missing hidden_at on COMPLETE/ABORT missions
- **Display text**: FINALIZED → "PREPARING FOR LAUNCH" everywhere in frontend; DB status unchanged

---

## Feature 16 — Ship Model Field

**Date**: 2026-06-28  
**Layer**: Frontend + Backend

### Description

Added `ship_model` field to Ship schema. Schematic thumbnail and node positioning now resolve via `ship_model` (manufacturer class e.g. 'RSI Polaris') normalized to slug, not `ship_name` (crew's custom name). All test missions updated to RSI Polaris.

### Details

- **Ship.js**: Added `ship_model: { type: String, default: '' }`
- **seedMissions.js**: All 7 seed ships now include `ship_model: 'RSI Polaris'`; migration query backfills any existing ships missing the field
- **ShipSchematic.jsx**: `findShipThumb(ship, shipThumbs)` now uses `ship.ship_model || ship.type` → normalized slug for direct index lookup; bare-type fallback (endsWith) still present
- **Dashboard.jsx**: Same `findShipThumb` update for MissionCard thumbnails
- **ship_model examples**: 'RSI Polaris' → 'rsi_polaris', 'Anvil Hurricane' → 'anvil_hurricane'
