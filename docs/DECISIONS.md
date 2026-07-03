# Nexus 1.0 — Decision Log

Architectural and design decisions for the Nexus 1.0 project. Each entry records when the decision came up, what was decided, alternatives considered, and rationale.

---

## D-001 — Platform Model: Public Web Platform

**Date**: Pre-build planning  
**Context**: Needed to decide who can access Nexus and what user types exist.  
**Decision**: Public web platform (not org-only). Three user types: Org Commander, Org Member, Freelancer.  
**Alternatives considered**: Invite-only org-gated access.  
**Rationale**: Freelancers need a place to find public missions without being in an org. Org Commanders need elevated permissions for mission management. The three-type model covers all expected use cases without over-complicating auth.

---

## D-002 — Authentication: Discord OAuth2

**Date**: Pre-build planning  
**Context**: Players already use Discord for the companion bot; needed a login strategy.  
**Decision**: Discord OAuth2 only. No password management.  
**Alternatives considered**: Username/password, Google OAuth.  
**Rationale**: All target users have Discord accounts. OAuth2 eliminates password storage/reset complexity. Discord profile data (username, avatar, ID) satisfies all identity needs.

---

## D-003 — Hosting: kylo-mini via Cloudflare Tunnel

**Date**: Pre-build planning  
**Context**: Needed to decide where the platform runs.  
**Decision**: Self-hosted on `kylo-mini` (Ubuntu 24.04), exposed via Cloudflare Tunnel for public HTTPS access.  
**Alternatives considered**: VPS (DigitalOcean, Hetzner), Render, Railway.  
**Rationale**: Hardware is already available. Cloudflare Tunnel provides zero-config HTTPS without port forwarding or a static IP. Zero hosting cost during development.

---

## D-004 — Platform Name: Nexus 1.0

**Date**: Pre-build planning  
**Context**: Needed a name and lore framing for the platform.  
**Decision**: "Nexus 1.0" — framed in-universe as the first standardized crew coordination protocol for independent operators.  
**Rationale**: Short, memorable, fits the Star Citizen setting. The "1.0" suffix signals early-access status and leaves room for lore-consistent versioning.

---

## D-005 — Visual Aesthetic: MS-DOS Terminal

**Date**: Pre-build / Session 2 (splash screen design)  
**Context**: Needed a visual identity for the web frontend.  
**Decision**: MS-DOS terminal aesthetic. Amber (`#FFB800`) or white on black, Courier New monospace, scanlines overlay, vignette. Holographic Three.js ship viewer planned for ship detail pages.  
**Alternatives considered**: Modern dark UI (Discord-like), Star Citizen native UI style.  
**Rationale**: The terminal aesthetic is distinctive, fits the lore framing of an early-access protocol, and is achievable with pure CSS + minimal JS. Three.js holographic viewer adds a premium layer without affecting the base aesthetic.

---

## D-006 — Sound System: ~30 MP3 Placeholder Files

**Date**: Pre-build planning  
**Context**: Wanted to give the platform an audio identity consistent with the terminal aesthetic.  
**Decision**: ~30 MP3 files planned for all UI events (boot, keypress, crew join, mission launch, rank up, etc.). Placeholder files used during development; final audio TBD.  
**Rationale**: Sound design reinforces the DOS/radio-comms aesthetic. `comms.mp3` (18.4s) is already in use for the splash screen.

---

## D-007 — Real-time: Socket.IO, 11 Event Types

**Date**: Session 1 (backend build)  
**Context**: Missions involve multiple concurrent users; live updates are required.  
**Decision**: Socket.IO served from kylo-mini. 11 event types across global, org, and user rooms.  
**Alternatives considered**: Server-Sent Events (SSE), polling.  
**Rationale**: Socket.IO handles bi-directional comms, room management, and reconnection out of the box. The Discord bot already uses event-driven patterns; Socket.IO mirrors that model on the web.

---

## D-008 — Tech Stack

**Date**: Pre-build planning  
**Context**: Needed to commit to a full-stack before building.  
**Decision**:
- Frontend: React + Vite
- Backend: Node.js + Express
- Database: MongoDB (local, NexusDB)
- ORM: Mongoose
- Auth: JWT (7-day expiry)
- Real-time: Socket.IO
- Images: Cloudinary
- AI: OpenAI GPT-4o-mini (72hr summaries)
- Scheduling: node-cron (in-process)

**Rationale**: React/Vite is fast to scaffold and widely known. MongoDB suits the heterogeneous data model. Cloudinary handles media without building a file server. GPT-4o-mini is cost-effective for low-frequency batch summarization.

---

## D-009 — Backend Port: 3099 Temporarily, 3000 for Production

**Date**: Session 1 (backend build)  
**Context**: Port 3000 was occupied by `raleigh_distance/server.js` (PID 2223) during development.  
**Decision**: Nexus backend runs on port 3099 during development. Port 3000 reserved for production once raleigh_distance is migrated or stopped.  
**Action required**: Kill PID 2223 and update `.env` PORT to 3000 before going live.

---

## D-010 — Splash Audio: Full Playback, No Trim

**Date**: Session 2 (splash screen design)  
**Context**: `comms.mp3` is 18.4s. Boot sequence completes in ~8.5s.  
**Decision**: Audio plays in full from page load. No fade, no cut. User keypress stops it.  
**Alternatives considered**: Trim audio to match boot sequence duration; fade out at boot completion.  
**Rationale**: The radio-comms immersion is intentional. Letting the audio run past the boot sequence and only stopping on keypress creates tension and keeps the user engaged with the prompt.

---

## D-011 — Docs: Single ~/nexus/docs/ Directory

**Date**: Session 2  
**Context**: Initial build placed docs inside `~/nexus/backend/docs/` but the project spans backend, frontend, design, and infra.  
**Decision**: Consolidate all documentation into `~/nexus/docs/` — four files: PROJECT_LOG.md, FEATURES.md, DECISIONS.md, SPEC.md. SCHEMA.md retained as a separate reference file.  
**Rationale**: Layer-specific doc subdirs fragment cross-cutting concerns. A single top-level docs directory is easier to maintain and review.

---

## D-012 — MongoDB + Mongoose for Persistence

**Date**: Session 1 (backend build)  
**Context**: Needed an ORM/ODM for the data layer.  
**Decision**: MongoDB with Mongoose ODM.  
**Rationale**: The data model involves heterogeneous structures (crew_roles keyed by role name, rp_rank embedded objects, config arrays) that fit naturally into a document store. Mongoose provides schema validation, population/joins, and query convenience without a rigid relational schema.

---

## D-013 — crew_roles as Mixed Type on Ship

**Date**: Session 1 (backend build)  
**Context**: Crew role definitions are platform-configurable via the admin API.  
**Decision**: `crew_roles` on Ship stored as `mongoose.Schema.Types.Mixed` (keyed object: `{ "Pilot": { slots: 1, filled: [userId] } }`).  
**Rationale**: Fixed schema would require migrations whenever a role is added or renamed via admin. Mixed type with `markModified` for change detection is the practical choice for dynamic keys.

---

## D-014 — MissionArchive as Immutable Snapshot

**Date**: Session 1 (backend build)  
**Context**: Ships get reassigned after mission completion; historical crew state must be preserved.  
**Decision**: On mission completion, copy the full mission + all ship documents as embedded objects in MissionArchive.  
**Rationale**: ObjectId references become meaningless after reassignment. An embedded snapshot preserves exactly who was on what ship with what role at mission close — necessary for RP ledger auditing and AI summaries.

---

## D-015 — GPT-4o-mini for AI Summaries

**Date**: Session 1 (backend build)  
**Context**: Wanted periodic narrative summaries of recent mission activity.  
**Decision**: GPT-4o-mini, max_tokens=350, temperature=0.2. Run every 72 hours via cron. Stores result in AISummary collection.  
**Rationale**: Summaries are concise structured outputs (headline + short paragraph + 3 bullets). Low temperature reduces hallucination. GPT-4o-mini is cost-efficient for a low-frequency batch job with modest output size.

---

## D-016 — Vite Proxy Target: Port 3099

**Date**: Session 3 — 2026-06-27  
**Context**: Port check at frontend scaffold time showed port 3000 still occupied by `raleigh_distance/server.js` (PID 2223). Port 3099 is where the Nexus backend is confirmed to start and listen.  
**Decision**: Vite dev server proxies `/api/*` and `/socket.io/*` to `http://localhost:3099`. Frontend runs on port 5173.  
**Alternatives considered**: Wait for port 3000 to be freed; run backend on a third port.  
**Rationale**: 3099 is already working and documented. Once `raleigh_distance` is decommissioned, update `vite.config.js` proxy target and backend `.env PORT` to 3000 simultaneously.  
**Action required**: When ready for production, kill PID 2223 and update both `vite.config.js` (proxy target) and `backend/.env` (PORT) to 3000.


---

## D-017 — Color Palette: Drake Amber → RSI Blue

**Date**: Session 7 — 2026-06-27  
**Context**: Original amber (#FFB800) palette was functional but clashed with Star Citizen's RSI visual identity. Rethem requested to match the RSI Blue aesthetic used across the UEE/RSI brand.  
**Decision**: Full token swap across all frontend files. New primary: #66AADD. Selection indicator (Nexus Cyan): #00EEFF. Full token map:
- #3A2800 → #1A3D55 (borders)
- #7A5C00 → #2A6A9A (dim/secondary)
- #FFB800 → #66AADD (primary)
- #FFD44D → #99CCFF (bright/headings)
- #00BB55 → #33DDAA (success)
- #CC4400 / #FF4444 → #FF5544 (danger)
- #00EEFF added as Nexus Cyan (selection glow, PRESS ANY KEY, focus rings)
- #FFBB33 added as warning (WAITING FOR CREW status)
**Files touched**: global.css, Splash.jsx, Onboarding.jsx, Dashboard.jsx, AsciiBox.jsx, MissionBoard.jsx, ShipViewer.jsx, CrewPanel.jsx, Admin.jsx  
**Rationale**: Pure visual rebrand; zero logic or layout changes. box-shadow: none !important removed from global reset to allow the #00EEFF selection glow on mission cards. Focus ring handled via CSS pseudo-selector targeting input/textarea/select:focus.

---

## D-018 — Bot source files placed at ~/nexus/discord bot/ as permanent reference

**Date**: 2026-06-28  
**Context**: Original Hopewell Continuum Mission Control Discord bot source code placed in the repo.  
**Decision**: All Nexus behavior that mirrors the bot should be verified against these files before implementation. Primary reference files: rp_handler.py, mission_commands.py, crew_commands.py, views.py, modals.py, constant.py, ship_commands.py, embeds.py, database_models.py.  
**Rationale**: Nexus 1.0 is the web-based successor to this system. Parity with bot logic (RP thresholds, crew rules, mission lifecycle) must be maintained. The bot source is the authoritative reference for business rules not yet documented in SPEC.md.

---

## Working With Alfredo

### Session summary format

After completing any task or group of tasks, always provide a structured summary with these two sections only:

**CHANGES** — exactly what was built or modified, files touched, line counts where relevant

**FUTURE DESIGN CONSIDERATIONS** — architectural improvements, refactoring opportunities, or patterns worth revisiting in a later session

Do not include OBSTACLES or ISSUES TO REMEDY in session summaries. These sections are token-intensive and not required.

This format is required for every session summary, no exceptions.
