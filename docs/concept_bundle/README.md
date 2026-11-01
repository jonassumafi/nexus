# Nexus — Concept Bundle

This bundle is for an LLM to produce page-by-page concept files for the
Nexus web app. Everything the model needs to understand what each page
does, what data it renders, and what visual language to speak is here.

## What's in this zip

- `page_inventory.md` — prose description of every page and major
  component. Start here; it's the mental model.
- `nexus_companion_spec.html` — the current design-language reference.
  Use its tokens, depth system, typography, and button recipes as the
  shared aesthetic across all concepts.
- `nexus_discord_webhooks.html` — a second worked example in the same
  design language (Discord embed shapes). Useful as a sanity check for
  how colors and typography carry across contexts.
- `models/` — all Mongoose schemas. Defines the exact shape of every
  entity the UI renders (User, Mission, Ship, etc). Trust these over
  anything you see in JSX.

## How to use

For each page you want a concept of:

1. Read `page_inventory.md` → the entry for that page.
2. Read `nexus_companion_spec.html` → absorb the design language.
3. Cross-reference `models/*.js` for the exact field names and types
   the page displays.
4. Produce a self-contained HTML concept file matching the companion
   spec's depth, palette, typography, and interaction patterns.
   One HTML file per page. Interactive demos encouraged (tabs toggle,
   rows expand, buttons depress) using inline JS as the spec does.

## Scope rule

**Mirror the aesthetic, keep the current layout.** The Nexus web app
has mature layouts (wide multi-column dashboards, modal flows, 3D ship
viewers). Concepts should re-skin these in the companion visual
language — same information architecture, better depth and polish.
Do not shrink the whole app to a 340×540 companion panel; that
form factor is reserved for the Electron companion build later.

## What to produce per page

- Fixed-width mockup at 1280px (Dashboard, MissionBoard) or 900px for
  modal flows (CreateMission, ShipRegistration, Onboarding).
- Working interactivity for anything that aids design review:
  tab switching, row expand/collapse, modal open/close.
- Design-token side panel at the bottom documenting any new tokens
  introduced for that page.
- File naming: `concept_<pagename>.html`
  (e.g. `concept_dashboard.html`, `concept_mission_board.html`).
