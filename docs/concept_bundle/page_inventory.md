# Nexus — Page Inventory

Nexus is a web-based mission reservation and crew coordination system
for a sci-fi roleplay community (Star Citizen setting). Players own
ships, create missions, reserve crew slots on other players' ships,
earn Reserve Points (RP) toward ranks, loan ships to each other, and
communicate via an in-app radio (WebRTC) during missions.

Dark theme only. Always-visible top bar on logged-in pages. Primary
navigation is modal/overlay-driven rather than page-based — most
"pages" render content inside the Dashboard shell.

---

## Shell & auth

### `/` — Splash
Pre-login marketing/intro screen. Big logo, tagline, "ENTER" button
that triggers Discord OAuth. First impression; set the tone.

### `/gate` — Gate
Transitional screen after Discord auth but before onboarding/entry.
Centered compact panel with a few options (continue to Nexus, go to
Discord, etc.). Terminal/console feel.

### `/onboarding` — Onboarding (multi-step)
Required flow for new users after first Discord login. Collects:
- **Step 1 — Citizen identity**: citizen_name, place_of_birth,
  citizenship, biography (free text). AI-refine button for the bio.
- **Step 2 — Portrait**: generate via Gemini image API or upload.
- **Step 3 — Organization**: join via invite code OR declare freelancer.
Each step has a NEXT button; final step persists to User and routes
to Dashboard. Form-heavy page, needs clean typography and a progress
indicator.

### `/disconnect` — Disconnect
Logout animation. Prints 5–6 terminal lines sequentially
("TERMINATING SESSION...", "FLUSHING CREW ASSIGNMENTS...",
"CONNECTION TERMINATED.") then redirects home. Pure chrome, no
interaction.

---

## `/dashboard` — Dashboard (main hub)

The primary logged-in view. Hosts most of the app's functionality as
inline panels and modals rather than separate routes. Composed of
these distinct zones (from the existing 3200-line implementation):

### Top bar
Always visible at the top of the Dashboard. Contains:
- Nexus logo (left)
- Nav buttons: Mission Board, Ship Registry, My Ships, Register Ship,
  Create Mission. Each toggles a view/modal in the main area.
- Right-aligned: current operator mini ID card (name, rank chip, RP),
  click to open full ID card modal.

### Mini ID card widget
Compact 3-row display: avatar + name + rank + RP progress bar.
Clicks open the full ID card modal (dossier style: portrait, bio,
stats, ship list, mission history, rank progress).

### Full ID card modal
Larger overlay with:
- Portrait (left)
- Dossier text (center): name, bio, citizenship, place of birth
- Stats (right): total RP, missions completed, current rank + next
  rank threshold
- Owned/borrowed ships list
- Close button

### Mission list / Mission detail (default main area)
Scrollable list of mission cards. Each card shows:
- Mission name, type badge (color-coded by mission_type)
- Commander name
- Status badge (WAITING FOR CREW / FINALIZED / IN PROGRESS /
  COMPLETE / ABORT)
- Primary ship + supporting ships thumbnail row
- Scheduled time
- Crew fill percentage
Click → detail view in-place. Detail shows:
- Full mission info, objectives
- Ship schematic grid with crew role slots (click to reserve/withdraw)
- Launch controls (commander-only): finalize, launch, abort buttons
- Activity log for this mission (right side)

### InProgressView
Replaces the mission list when the viewer is on an active mission.
Big elapsed-time counter at top, each ship shown as a card with its
own crew roster, radio panel pinned.

### Activity feed (right rail)
Live socket-driven feed of recent events across the platform:
mission created/launched/complete/aborted, crew joined/withdrew,
rank advancements, ship RP awards. Each item has an icon
(color-coded by category), citizen name, action, mission context,
and a relative timestamp. Rows expand on click for detail.

### CreateMission (modal/view)
Multi-step form:
1. Mission name + type picker (shows type badge preview)
2. Primary ship selection (user's ships + ships they have active loans
   on). Shows ship model thumbnails.
3. Supporting ships (optional, up to platform max)
4. Objectives (free text)
5. Scheduled time + queue expiry
6. Review and create
Each step validates before advancing. "SAVE" / "NEXT" / "BACK"
bracket-style buttons at the bottom.

### MyShips (modal/view)
Grid of ship cards owned by the current user. Each card:
- Ship model thumbnail (varying aspect ratios)
- Ship name (callsign), model name
- Crew role summary (number of slots per role)
- Lifetime Ship RP earned
- Edit, delete, view-schematic actions
Also shows ships the user is borrowing (badge-marked).

### Ship Registry (modal/view)
Browse ALL ships on the platform. Each ship card has owner info and a
"REQUEST ACCESS" button (shows "REQUESTED" if pending, "APPROVED"
with timer if active). Owner sees incoming requests on their own
ships in a popup.

### ShipRegistration (modal flow)
Create a new ship. Multi-step:
1. Callsign (uppercase)
2. Ship model picker (searchable grid of ShipModel entries)
3. Description
4. Schematic — drag crew role nodes (Pilot, Turret, Engineer, etc)
   onto the ship diagram. Must place at least one Pilot node.
5. Review and submit

### ShipSchematic (component used in multiple places)
Interactive grid showing a ship's node positions and crew roles.
Nodes are circular, color-coded by role. Clicking a node reserves
the current user into that role (or shows who's in it).

### RadioPanel (pinned, bottom or side)
Always-mounted WebRTC radio UI. Current implementation lives in
`components/RadioPanel.jsx`. Shows:
- Frequency display (large, cyan LCD style)
- Tune up/down buttons
- TX indicator (red when transmitting)
- Peer list (who else is on this frequency)
- PTT key display (reads from user voice profile)
- Volume/mute controls

### RegistryBoot
Short boot animation shown when entering Ship Registry mode. Lines of
terminal text ("INITIALIZING REGISTRY...", "FETCHING FLEET MANIFEST...")
then transitions into the registry view.

### OwnerAccessPopup
Toast/modal that appears on the owner's screen when another player
requests access to their ship. Shows requester name, ship, approve/deny
buttons. Audio cue.

### LesseeNotif
Notification bar that appears on the borrower's screen when a loan
is approved, denied, or recalled.

### PostMissionLogModal
Post-mission log entry prompt. Fires when a mission the user was on
completes. Textarea for log content (1000 char max), submit awards +3 RP.

---

## Placeholder routes

These routes exist but currently render "COMING SOON" placeholders.
Their functionality lives inside the Dashboard view instead.

### `/missions` — MissionBoard (stub)
### `/crew` — CrewPanel (stub)
### `/ship-viewer` — ShipViewer (stub)
### `/admin` — Admin (stub)

Each is a simple centered panel with a vignette and
`[ X — COMING SOON ]` text. These could become real pages later.

---

## Shared visual elements

- **Status badges** — pill-shaped indicators color-coded by mission or
  loan status (lime=complete/active, amber=pending/warning,
  red=aborted/recalled, blue=in-progress/neutral).
- **Type badges** — mission type labels (Combat, Trade, Exploration,
  etc.) each with a distinct accent color.
- **Bracket buttons** — `[ ACTION ]` text buttons, the legacy Nexus
  button style. Companion spec replaces these with 3D depressable
  `.btn` buttons — concepts should use the new style.
- **ID card** — paper/document styling (off-white background, dark
  text, stamps and barcodes). This is the ONE intentionally
  non-dark-theme surface in the whole app. Preserve this feel in
  concepts — do not re-skin it with the dark panel language.
- **Ship schematic grid** — dark hexagonal/circular nodes on a dim
  grid background, representing crew positions on a ship.
- **Vignette overlay** — subtle radial dark gradient at the edges of
  the viewport. Atmospheric; usually optional.

---

## Design philosophy notes

- Everything is dark theme except the ID card.
- Depth comes from stacked hard shadows + 1px bevel highlights, NOT
  from motion/tilt/parallax.
- Buttons physically depress 3px on click. Active tabs sit 2px lower
  than inactive ones with a blue glow.
- LCD-style readouts (frequency, elapsed time, countdowns) use the
  cyan `#00EEFF` on near-black with an inset shadow.
- Inter font everywhere (including LCDs, with tabular-nums). No
  monospace in the UI itself.
- Rounded corners are 3–8px, not 0 (the previous terminal-flat
  aesthetic is being retired).
- Lime for success/go, red for danger/stop, amber for loan/caution,
  blue for neutral/presence, cyan for frequency displays only.
