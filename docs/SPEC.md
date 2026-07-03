# Nexus 1.0 — Master Product Specification

---

## 1. Overview

Nexus 1.0 is a Star Citizen roleplay and mission coordination platform. It provides a web dashboard for managing organizations, ships, crew, missions, and a reputation point (RP) progression system that mirrors the existing Discord bot (`RpHandler`).

**Lore framing**: Nexus 1.0 is the first standardized crew coordination protocol for independent operators — a digital command layer built for those who fly without a flag.

### User Types

| Type | Description | Key Permissions |
|---|---|---|
| **Platform Owner** | Single designated admin (`is_platform_owner: true`) | Full admin API access, manage PlatformConfig, all ship model uploads |
| **Org Commander** | User who created or was assigned an org (`is_org_commander: true`) | Finalize missions, manage org members |
| **Org Member** | User in an org (`org_id` set) | Join missions, reserve crew slots, register ships |
| **Freelancer** | User with no org (`is_freelancer: true`) | Join public missions, register ships |

---

## 2. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React + Vite | Not yet built |
| Backend | Node.js + Express 4 | `~/nexus/backend/server.js` |
| Database | MongoDB (local) | `NexusDB` on `localhost:27017` |
| ODM | Mongoose 8 | All models in `backend/models/` |
| Auth | Discord OAuth2 + JWT | 7-day token expiry |
| Real-time | Socket.IO 4 | Org rooms + global + user rooms |
| Image storage | Cloudinary | Portraits + ship models |
| AI | OpenAI GPT-4o-mini | 72hr mission summaries |
| Scheduling | node-cron | In-process, 4 jobs |
| Hosting | kylo-mini (Ubuntu 24.04) | Cloudflare Tunnel for public HTTPS |

---

## 3. Credentials & Environment

All values live in `~/nexus/backend/.env`. Reference that file for actual secrets — do not duplicate values here.

**Required environment keys**:
- `PORT`
- `MONGODB_URI`
- `JWT_SECRET`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `OPENAI_API_KEY`
- `PLATFORM_OWNER_DISCORD_ID`
- `FRONTEND_URL`

---

## 4. Data Models

Full Mongoose schemas in `SCHEMA.md`. Summary of key fields and relationships:

| Model | Key Fields | Relationships |
|---|---|---|
| **PlatformConfig** | mission_types, ship_types, crew_roles, rp_settings, rp_ranks, max_ships_per_player, max_ships_per_mission, ai_summary_enabled | Singleton — no refs |
| **User** | discord_id (unique), username, avatar, citizen_name, total_rp, rp_rank, is_platform_owner, is_org_commander, onboarding_complete, current_mission_assignment | → Organization (org_id) |
| **Organization** | name (unique), prefix, invite_code (6-char, auto), member_count | → User (commander_id) |
| **Ship** | ship_name, type, crew_roles (Mixed), crew_fill_percentage, is_mission, current_mission_id | → User (owner_id), → Organization (org_id) |
| **Mission** | name (unique), mission_type, status (enum), primary_ship, supporting_ships, queue_expires_at | → User (created_by), → Ship (primary/supporting), → Organization |
| **MissionArchive** | primary_ship_snapshot (Mixed), crew_snapshot (Mixed), total_rp_awarded | → User (created_by) — ships embedded as snapshots |
| **MissionLog** | log_text, timestamp | → Mission, → User |
| **RPLedger** | event_code, points, applied_ts | → User (player_id), → Mission, → Ship |
| **ShipRPLedger** | fill_rate, points_awarded, threshold_snapshot | → Ship, → Mission |
| **ShipModel** | category, model_name, image_url, scorg_ship_id | → User (created_by) |
| **AISummary** | summary_text, missions_count, period_start, period_end | None |

---

## 5. API Routes

All routes prefixed `/api/`. JWT required on all routes except the two Discord OAuth endpoints.

### Auth
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | /api/auth/discord | Public | Redirects to Discord OAuth2 |
| GET | /api/auth/discord/callback | Public | Exchanges code, issues JWT, redirects to frontend |
| GET | /api/auth/me | JWT | Returns current user document |
| POST | /api/auth/logout | JWT | Client-side token discard |

### Users
| Method | Path | Auth |
|---|---|---|
| GET | /api/users/leaderboard | JWT |
| GET | /api/users/:id | JWT |
| PUT | /api/users/:id | JWT (self or platform owner) |
| POST | /api/users/:id/portrait | JWT (self or platform owner) |
| POST | /api/users/:id/complete-onboarding | JWT (self) |

### Organizations
| Method | Path | Auth |
|---|---|---|
| POST | /api/organizations | JWT |
| GET | /api/organizations | JWT |
| GET | /api/organizations/:id | JWT |
| POST | /api/organizations/join | JWT |
| GET | /api/organizations/:id/members | JWT |
| GET | /api/organizations/:id/ships | JWT |

### Ships
| Method | Path | Auth |
|---|---|---|
| POST | /api/ships | JWT |
| GET | /api/ships | JWT |
| GET | /api/ships/:id | JWT |
| PUT | /api/ships/:id | JWT (owner or platform owner) |
| DELETE | /api/ships/:id | JWT (owner or platform owner) |
| PUT | /api/ships/:id/crew | JWT |
| GET | /api/ships/models | JWT |
| POST | /api/ships/models | JWT + Platform Owner |

### Missions
| Method | Path | Auth |
|---|---|---|
| POST | /api/missions | JWT |
| GET | /api/missions | JWT |
| GET | /api/missions/archive | JWT |
| GET | /api/missions/:id | JWT |
| PUT | /api/missions/:id/finalize | JWT |
| PUT | /api/missions/:id/launch | JWT |
| PUT | /api/missions/:id/complete | JWT |
| PUT | /api/missions/:id/abort | JWT |

### Crew
| Method | Path | Auth |
|---|---|---|
| POST | /api/crew/reserve | JWT |
| POST | /api/crew/withdraw | JWT |

### RP
| Method | Path | Auth |
|---|---|---|
| GET | /api/rp/leaderboard | JWT |
| GET | /api/rp/player/:id | JWT |
| GET | /api/rp/ship/:id | JWT |

### Logs
| Method | Path | Auth |
|---|---|---|
| POST | /api/logs | JWT |
| GET | /api/logs/:mission_id | JWT |

### Admin (Platform Owner Only)
| Method | Path |
|---|---|
| GET | /api/admin/config |
| PUT | /api/admin/config/mission-types |
| PUT | /api/admin/config/ship-types |
| PUT | /api/admin/config/crew-roles |
| PUT | /api/admin/config/rp-settings |
| PUT | /api/admin/config/rp-ranks |
| PUT | /api/admin/config/ship-limits |
| PUT | /api/admin/config/ai-summary |

---

## 6. RP System

### Point Events

| Event Code | Points | Trigger |
|---|---|---|
| `MISSION_LAUNCHED` | 1 | User launches a mission (PUT /missions/:id/launch) |
| `POST_MISSION_LOG` | 3 | User submits a post-mission log (POST /logs) |
| `CREW_SLOT_FILLED` | 1 or 2 | User reserves a crew slot (POST /crew/reserve) |
| `SHIP_FILL_BONUS` | 3 | Ship reaches fill threshold at mission launch |

### Crew Fill Thresholds (configurable in PlatformConfig)

| Ship Fill % | Points Awarded |
|---|---|
| Below 50% | 0 |
| 50% – 69% | 1 |
| 70% and above | 2 |

### Ship Fill Bonus

Calculated per role per ship at launch. If `filled_at_launch / capacity_at_launch >= ship_fill_threshold` (default 75%), a ShipRPLedger record is created with `points_awarded = SHIP_FILL_BONUS`.

### Rank Advancement

All 13 ranks are stored in `PlatformConfig.rp_ranks`. Each has `min_rp`, `max_rp` (null for the highest), `title`, `emoji`, and `unlocks`. After every RP award, `incrementUserRPAndUpdateRank` atomically increments `user.total_rp`, recalculates the rank, and emits `rank_advanced` to the user's personal Socket.IO room if the title changed.

---

## 7. Mission Lifecycle

```
WAITING FOR CREW ──► FINALIZED ──► IN PROGRESS ──► COMPLETE
        │                                    │
        └────────────────────────────────────┴──► ABORT
```

| Step | Trigger | Status | Side Effects |
|---|---|---|---|
| **Created** | POST /api/missions | WAITING FOR CREW | Ships marked is_mission=true; queue_expires_at set 30min out |
| **Finalized** | PUT /missions/:id/finalize | FINALIZED | `mission_finalized` socket event |
| **Launched** | PUT /missions/:id/launch | IN PROGRESS | Validates pilot + min 2 crew; prunes empty supporting ships; awards MISSION_LAUNCHED RP to creator; `mission_launched` socket event |
| **Completed** | PUT /missions/:id/complete | COMPLETE | MissionArchive snapshot created; all ship/user associations reset; `log_requested` emitted to all crew; ship fill bonuses awarded; `mission_complete` socket event |
| **Aborted** | PUT /missions/:id/abort or scheduler | ABORT | Associations reset; `mission_aborted` socket event |

### Launch Validation
- Primary ship must have the Pilot role filled
- Total crew across all ships (primary + supporting) must be ≥ 2
- Empty supporting ships are removed silently before launch

---

## 8. Socket Events

Clients connect with `?token=<jwt>` in the Socket.IO handshake query. Server verifies JWT, then joins the socket to three rooms.

### Rooms
- `global` — all authenticated users
- `org_<orgId>` — users with an org
- `user_<userId>` — personal/private events

### Events

| Event | Room | Payload | Triggered By |
|---|---|---|---|
| `slot_reserved` | global or org | `{ shipId, role, userId, crew_fill_percentage }` | POST /crew/reserve |
| `slot_withdrawn` | global or org | `{ shipId, role, userId, crew_fill_percentage }` | POST /crew/withdraw |
| `crew_fill_updated` | global or org | `{ shipId, crew_fill_percentage }` | /crew/reserve, /crew/withdraw, /ships/:id/crew |
| `mission_finalized` | global | `{ missionId, name }` | PUT /missions/:id/finalize |
| `mission_launched` | global | `{ missionId, name }` | PUT /missions/:id/launch |
| `mission_complete` | global | `{ missionId, missionName }` | PUT /missions/:id/complete |
| `mission_aborted` | global | `{ missionId, missionName }` | PUT /missions/:id/abort or scheduler |
| `rp_earned` | user | `{ userId, event_code, points }` | Any RP award |
| `rank_advanced` | user | `{ userId, newRank, total_rp }` | incrementUserRPAndUpdateRank when rank title changes |
| `log_submitted` | global | `{ missionId, userId }` | POST /logs |
| `log_requested` | user (each crew member) | `{ missionId, missionName }` | Mission completion |

---

## 9. Visual Design

### Color Palette

| Role | Value |
|---|---|
| Background | `#000000` |
| Primary text (amber) | `#FFB800` |
| Secondary text (dim) | `#996600` |
| Highlight / active | `#FFFFFF` |
| Error / danger | `#FF4444` |
| Success | `#00FF00` |

### Typography
- **Font**: Courier New (system), fallback `monospace`
- **Base size**: 14px
- **Line height**: 1.6
- No anti-aliasing tweaks — raw pixel look is intentional

### Effects
- **Scanlines**: CSS `repeating-linear-gradient` overlay at ~4% opacity, 2px pitch
- **Vignette**: CSS `radial-gradient` from transparent center to semi-opaque black edges
- **Cursor blink**: CSS `@keyframes blink`, 0.8s interval on active input lines
- **Holographic ship viewer**: Three.js (planned) — orbital camera, wireframe or low-poly mesh, amber glow shader

### Sound System (planned)
~30 MP3 files covering all UI events:
- `comms.mp3` — splash screen boot audio (18.4s, in use)
- `keypress.mp3` — generic key interactions
- `crew_join.mp3` — slot reserved
- `mission_launch.mp3` — mission goes IN PROGRESS
- `rank_up.mp3` — rank advancement
- `alert.mp3` — errors / warnings
- (remaining files TBD)

Files will live at `/public/sounds/` in the frontend project.

---

## 10. Frontend Plan

The React/Vite frontend has not yet been built. Planned screens and flows:

| Screen | Route | Description |
|---|---|---|
| **Splash** | `/` | DOS boot sequence + comms.mp3, keypress transitions to dashboard |
| **Auth Callback** | `/auth/callback` | Receives JWT from query param, stores in localStorage, redirects to dashboard |
| **Dashboard** | `/dashboard` | Mission board overview, active crew counts, latest RP leaderboard |
| **Mission Board** | `/missions` | List of open missions with status, ship count, crew fill bars |
| **Mission Detail** | `/missions/:id` | Full mission view: ships, crew slots, fill percentage, join/leave buttons |
| **Ship Viewer** | `/ships/:id` | Three.js holographic model, crew roster, mission history |
| **Org Panel** | `/org` | Org info, member list, org ships, invite code management |
| **Crew Panel** | `/crew` | Player's current assignment, slot status, mission countdown |
| **Onboarding Wizard** | `/onboard` | Multi-step: citizen name, biography, place of birth, citizenship, first ship |
| **Leaderboard** | `/leaderboard` | Paginated RP rankings with rank badges |
| **Admin Panel** | `/admin` | Platform owner only: edit PlatformConfig (all 7 sections), manage ship models |

---

## 11. Outstanding Work

### Backend
- [ ] Cloudflare Tunnel configuration
- [ ] Port 3000 freed for production (kill raleigh_distance PID 2223)
- [ ] Production process manager (pm2 or systemd)
- [ ] Multer v2 upgrade (v1 has known vulnerabilities)
- [ ] MongoDB indexes for high-query fields (discord_id, org_id, status, player_id)
- [ ] Rate limiting on auth endpoints

### Frontend
- [ ] React/Vite project scaffold under `~/nexus/frontend/`
- [ ] All 10 planned screens (see Section 10)
- [ ] Socket.IO client integration
- [ ] Sound system integration
- [ ] Three.js ship viewer

### Design
- [ ] Sound file production (~29 remaining MP3s)
- [ ] Ship model assets (Cloudinary upload pipeline)
- [ ] Finalize Three.js shader spec for holographic viewer

### Infra
- [ ] Cloudflare Tunnel setup
- [ ] SSL / domain configuration
- [ ] MongoDB backups
