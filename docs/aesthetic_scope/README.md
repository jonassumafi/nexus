# Nexus — New Aesthetic Scope Brief

This bundle is for an LLM to **propose an improved visual aesthetic** for
the Nexus Interstellar Traffic System web app and Electron companion.

## What Nexus is

Nexus is a web + Electron app for a sci-fi roleplay community (Star
Citizen setting). Players own ships, create missions, reserve crew
slots on each other's ships, earn Reserve Points toward ranks, and
coordinate via an in-app WebRTC radio. The Electron companion runs on
Windows alongside the game and provides a global push-to-talk hotkey.

Current aesthetic: **dark operator-console / terminal-dashboard**
styled around a "RSI blue" palette (deep navy, cyan accents, lime for
positive events, red for danger, amber for ships/loans).

## What's working visually

- The dark-navy palette feels appropriate for the setting.
- Icon-based activity feed with per-event-type semantic colors.
- 3D "pressable" buttons with bevel + hard under-edge.
- LCD-style readouts for frequency and timers.
- The paper ID card as a deliberate warm contrast surface.

## What the user wants improved

- The current aesthetic is **functional but generic** — feels like "a
  dark-themed admin dashboard" more than "a bespoke sci-fi operator
  console."
- The Electron companion window specifically needs to feel like **a
  physical device chassis** (phone-app or dashboard-widget vibe), not
  a floating transparent panel.
- Content doesn't **scale** well across the three window modes (full
  1280×820, companion 340×540, radio-only 320×44). Each mode currently
  renders the same assets at the same size, which breaks the smaller
  modes.
- The user is open to significant visual departures — different
  framing, different texture, different typography — as long as the
  dark-first palette and semantic color coding stay.

## What's in this bundle

### `styles/`
- `global.css` — the complete token system + utility class library.
  Lists every variable, every utility class, every bevel/shadow recipe
  currently in use. **The LLM should propose changes to these tokens
  and utility classes directly** when it has a new aesthetic in mind.
- `index.html` — the Vite entry (shows fonts loaded).

### `pages/`
- `Dashboard.jsx` — the main full-UI page. Shows what the current
  aesthetic looks like applied to a wide, feature-rich dashboard.
- `RadioWidget.jsx` — the 320×44 ultra-compact widget. Shows how the
  current aesthetic degrades (poorly) at tiny sizes.

### `components/`
- `RadioPanel.jsx` — radio controls panel inside Dashboard.
- `CreateMission.jsx` — multi-step mission creation flow.
- `MyShips.jsx` — ship browser with schematic.
- `ShipRegistration.jsx` — ship registration flow.

### `concept_refs/`
- `nexus_companion_spec.html` — the original design concept the current
  aesthetic was built around. **Includes the full token system in a
  self-contained HTML file.** Open it in a browser to see the intended
  look rendered.
- `concept_dashboard.html` — concept for the full dashboard.
- `concept_create_mission.html` — concept for mission creation.
- `concept_my_ships.html` — concept for ship browser.
- `concept_radio_panel.html` — concept for the radio.
- `concept_id_card.html` — concept for the ID card (paper surface).

### `electron/`
- `main.js` — Electron main process; shows how the window chrome is set
  up (frameless, OS-level PTT, mode switching, persistence).
- `preload.js` — the bridge script that injects frame CSS and exposes
  window.electronAPI to the frontend.

## What to produce

- A **short written design brief** (~500 words) describing the proposed
  new aesthetic direction — what it feels like, what inspires it, how
  it departs from the current look.
- An **updated `global.css`** with the new token system + utility
  classes. Should be a drop-in replacement for the current one.
- An **example HTML file** (like the concept_*.html references) that
  demonstrates the new aesthetic rendered inside a browser, so we can
  evaluate it visually before committing.
- Specifically address: **how the aesthetic scales across the three
  window modes** (1280×820 full / 340×540 companion / 320×44 radio).
  Each mode should look native to its size, not just the same thing
  shrunk.

## Design constraints

- Dark-first (black / near-black backgrounds, no light mode).
- Palette can shift but must remain legible — WCAG AA for primary text.
- Semantic color coding stays (lime = positive, red = danger, amber =
  caution/ships, blue = neutral, cyan = frequency displays).
- The paper ID card stays as a deliberate warm-light contrast surface;
  everything else is dark.
- Inter is the current font — can be swapped if there's a strong
  justification. JetBrains Mono is reserved for retro boot sequences.
- Must look right in Electron on Windows (where the companion runs
  during gameplay).
