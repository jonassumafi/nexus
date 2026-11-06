// Release notes shown by WhatsNewSplash.
//
// Rules:
//   • Keep only the LAST 10 entries. Trim older ones when adding a new one.
//   • Each bullet is one short, plain sentence — no jargon.
//   • Version strings must match the Electron app's version so the splash
//     shows the right entry per installed build.
//
// To bump: add a new entry at the top of RELEASE_NOTES, drop the oldest.

export const RELEASE_NOTES = [
  {
    version: '0.9.17',
    date: '2026-11-04',
    bullets: [
      'New prompt mark logo everywhere — favicon, title bars, splash screen, login, terminal headers. Recolors with your skin.',
      'Dashboard header reworked into one clean nav row with page tabs on the left and chat/friends/toggles/admin on the right.',
      'Friends system: add pilots by handle, accept or decline requests, see who is online, click any avatar for an ID card. Friends can lend you ships.',
      'Mission detail now shows every ship as its own tab. Click a tab to see that ship. Numbers and percentages stay in sync.',
      'Mission board regrouped into sticky Waiting / Active / Completed sections with hero ship thumbnails.',
      'My Ships rebuilt with grouped fleet list, hero detail pane, and a two-step 8-second delete button.',
      'All boot screens — splash, registry, ship registration, mission creation — now share the same terminal look that recolors with your skin.',
      'Ship model names show as readable text ("Aegis Hammerhead") instead of file codes everywhere, including Discord webhooks.',
      'Mission list in Companion view now shows properly instead of reading as empty. Crew roster and ship status labels also fixed.',
      'Avatars show in Companion and chat instead of just initials. Chat messages carry a friend marker next to names of people you know.',
    ],
  },
  {
    version: '0.9.15',
    date: '2026-11-03',
    bullets: [
      'Experimental UDP voice transport. Toggle "Transport: UDP" in the mic strip and reload — Crew tuner routes voice through a direct UDP relay instead of WebRTC.',
      'UDP mode is Crew-only in this build; Command tuner still uses WebRTC regardless.',
      'If voice stops working on UDP, flip back to WebRTC and reload — it is a safe fallback.',
    ],
  },
  {
    version: '0.9.14',
    date: '2026-11-02',
    bullets: [
      'Added a prominent version badge next to the title. Compare numbers with your friends when debugging — matching versions matter.',
      'Version is now read live from the installer, so the badge can never drift out of sync again.',
    ],
  },
  {
    version: '0.9.13',
    date: '2026-11-02',
    bullets: [
      'Fixed Command radio showing peers under the Crew block. Each tuner now only tracks its own frequency.',
      'Added a global Receive slider in the mic strip for incoming voice loudness, separate from your mic volume.',
      'Removed auto-tune on launch and mode switch — you now press TUNE every time to join a frequency.',
      'The app now clears its web cache on launch and view switch, so frontend fixes land without a new installer.',
    ],
  },
  {
    version: '0.9.12',
    date: '2026-11-02',
    bullets: [
      'Removed the per-player static noise generator from the pre-SRS stage. Static now comes only from your assigned radio preset, matching SRS exactly.',
      'Removed the per-player pitch shift. Everyone on the same radio now sounds the same, same as SRS.',
      'Your friends should hear noticeably less background noise in your transmissions.',
    ],
  },
  {
    version: '0.9.11',
    date: '2026-11-02',
    bullets: [
      'Removed the Clean TX slider — it only attenuated one noise generator and left the SRS tx chain untouched, so it couldn\'t deliver what it promised.',
      'Transmit noise behavior is back to exactly what it was before v0.9.8.',
    ],
  },
  {
    version: '0.9.10',
    date: '2026-11-02',
    bullets: [
      'Frequency row trimmed — LCD digit size reduced from 28px to 18px so numbers fit the box cleanly.',
      'Removed the external Tune (⤾) button next to the LCD — the TUNE button already lives inside the LCD input, no need for a second one.',
      'Lock and Power buttons slimmed to match the trimmed row height.',
      'Removed the Volume · Pan tray from each radio card — fewer controls, cleaner look.',
    ],
  },
  {
    version: '0.9.9',
    date: '2026-11-02',
    bullets: [
      'Pressing the TUNE button now plays an audible connect confirmation on both Crew and Command — you\'ll hear when your radio locks on.',
      'Tune and lock buttons are icon-only now (⤾ 🔓 ⏻) — no more "Retune" text.',
      'Rig name in each module header shows the shorthand ("Patrol", "Jadro") instead of the full "VX-134 Patrol" string. Hover shows the full name as a tooltip.',
      'Power/disconnect button flashes red on hover so you see it before you press it. Returns to normal color on press.',
    ],
  },
  {
    version: '0.9.8',
    date: '2026-11-02',
    bullets: [
      'Dashboard radio UI rebuilt as "mirrored layout" — Crew and Command are identical modules stacked under a single shared mic strip. Same parts, same order, only the role label differs.',
      'New Transmit Cleanliness slider in the mic strip — reduces the static noise your peers hear in your transmissions. 0 = original character, 100 = fully clean.',
      'Shared Mic strip at the top handles track meter + volume + cleanliness in one row set for both radios.',
      'Each radio module now has a big LCD frequency display, Retune / Lock / Disconnect buttons, Transmit bar, collapsible On Frequency list, and collapsible Volume · Pan tray.',
    ],
  },
  {
    version: '0.9.7',
    date: '2026-11-02',
    bullets: [
      'Crew radio header renamed from "Radio" to "CREW" to match the Command tuner.',
      'Command tuner now has its own MIC TRACK meter + MIC VOLUME slider, matching the Crew radio layout.',
      'Command tuner card is ~15% larger (bigger padding + button heights) to give the mic controls proper room.',
      'MIC VOLUME on Command controls its own tx mic sensitivity independently from Crew.',
    ],
  },
  {
    version: '0.9.6',
    date: '2026-11-02',
    bullets: [
      'Removed the Command tuner\'s own atmospheric squelch bed — it was layering with the primary (Crew) radio\'s bed and producing chaotic static when both were active.',
      'Added a "Disable Command tuner (diagnostic)" button in the Command tuner\'s Volume · Pan tray. Click it to completely shut Command down (releases mic + socket listeners) via a page reload. Useful if you want to isolate whether Command is affecting Crew.',
    ],
  },
  {
    version: '0.9.5',
    date: '2026-11-02',
    bullets: [
      'Nexus Companion now auto-updates — new versions download in the background and prompt you to install with one click.',
      'A small corner banner shows "Nexus update ready" when a new build is downloaded; click Install now to restart into the new version.',
      'No more manual installer downloads for future releases.',
    ],
  },
  {
    version: '0.9.4',
    date: '2026-11-02',
    bullets: [
      'The Command tuner can now use a DIFFERENT radio from your Crew tuner — pick an ARC-164 for Command and leave Crew on your usual rig.',
      'Click the Rig button inside the Command tuner card to open the Command radio picker.',
      '"Inherit primary" button in the Command picker lets you reset Command back to using the same radio as Crew.',
      'All 25 selectable radios work for either tuner.',
    ],
  },
  {
    version: '0.9.3',
    date: '2026-11-02',
    bullets: [
      'Command tuner now has its own volume slider — turn Command down to focus on Crew without touching your main volume.',
      'Stereo pan slider on the Command tuner — nudge it left or right (-0.6 to 0.6) so Command and Crew sit in different ears.',
      'Both are tucked under a "Volume · Pan" tray that opens when you want it.',
      'Command tuner settings (binding, label, lock, volume, pan) now save to your account on the server, not just your browser. Clear your cookies and they come right back.',
      'Command tuner auto-rejoins its last frequency when you switch between Dashboard / Companion / Radio-only views — no retuning.',
    ],
  },
  {
    version: '0.9.2',
    date: '2026-11-02',
    bullets: [
      'Command tuner now uses the same LCD-styled frequency entry as the primary radio — per-keystroke tune clicks included.',
      'All connect / disconnect / peer join / peer leave sounds now match the primary radio.',
      'The SELCAL 2-tone chord now fires on your OWN Command transmit, so you hear it when you key up.',
      'Fixed the Untune button clipping at the edge of the card.',
      'Lock button on the Command tuner — click the padlock to freeze frequency and label changes.',
      'Double-click the Command label (e.g. "Command") to rename it to anything — "Fleet", "Dispatch", whatever fits.',
      'Binding the same key to both Crew and Command is now rejected with a clear "already bound" message.',
      'Safety stop on blur — if you alt-tab away mid-transmit, PTT releases automatically. No more stuck-open mic.',
    ],
  },
  {
    version: '0.9.1',
    date: '2026-11-02',
    bullets: [
      'The Command tuner now appears in every radio view — Dashboard, Companion, and Radio-only — not just the Dashboard.',
      'Companion and Radio-only window default heights grew slightly to accommodate the second tuner. Both are still resizable.',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-11-02',
    bullets: [
      'Second radio added — a Command tuner sits under your primary radio on the Dashboard, with its own frequency, peer list, and PTT key.',
      'When someone transmits on the Command channel, you now hear a distinctive 2-tone SELCAL chord before their voice so priority traffic stands out.',
      'Bind a separate PTT key (or mouse side button) for the Command tuner — hold it to transmit on Command without touching your primary rig.',
      'Both radios share your voice character and current radio preset for now; separate per-tuner radios will land in a follow-up.',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-11-01',
    bullets: [
      'Nexus now checks for new versions on launch and offers to install them automatically.',
      'A "What\'s new" splash appears after each update summarizing the recent changes.',
      'Global chat text is smaller and scales with how wide the chat panel is.',
      'Pin button now behaves like a normal always-on-top window — clicking another app brings it to focus.',
    ],
  },
  {
    version: '0.7.3',
    date: '2026-11-01',
    bullets: [
      'You can now map your push-to-talk key to a mouse side button (Mouse4, Mouse5, etc.).',
      'The PTT key chip in Settings now shows a mouse icon when bound to a mouse button.',
    ],
  },
  {
    version: '0.7.2',
    date: '2026-11-01',
    bullets: [
      'Radio-only view redesigned as a thin horizontal strip (560 × 170).',
      'A PTT remap button lives right in the Radio-only header — no need to open the full dashboard.',
      'Peers on your frequency now show in a tiny 2-column grid that lights up green when they transmit.',
      'Your tuned frequency now persists across view switches — no retuning when you flip modes.',
    ],
  },
  {
    version: '0.7.1',
    date: '2026-11-01',
    bullets: [
      'Removed the one-line-per-keystroke diagnostic log that was flooding the DevTools console.',
      'DevTools no longer auto-opens on launch (press F12 or Ctrl+Alt+D to open it manually).',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-11-01',
    bullets: [
      'Push-to-talk now works globally — it fires even when Star Citizen has focus.',
      'Swapped the native keyboard hook library (uiohook-napi) for one that survives Windows packaging reliably.',
      'A "Global" badge next to the current PTT key in Settings confirms the OS-level hook is live.',
    ],
  },
  {
    version: '0.6.9',
    date: '2026-11-01',
    bullets: [
      'Added diagnostic hooks that forward native key events to the DevTools console for debugging.',
      'A startup "hook-status" log tells you whether the global PTT hook started cleanly.',
    ],
  },
  {
    version: '0.6.8',
    date: '2026-11-01',
    bullets: [
      'F12 and Ctrl+Alt+D now toggle DevTools — useful when graphics software hijacks the default shortcut.',
      'Fixed CapsLock-style key names so the browser form matches the native hook form.',
    ],
  },
  {
    version: '0.6.7',
    date: '2026-10-31',
    bullets: [
      'Radio picker modal: click the badge next to your character name to switch radios on the fly.',
      '25 selectable radio presets, grouped by family (personal / ship / broadcast).',
      'Random "reroll" button for anyone who wants to swap into a different radio.',
    ],
  },
  {
    version: '0.6.5',
    date: '2026-10-30',
    bullets: [
      'SRS-style per-radio voice character — each of 28 radio presets shapes voice differently.',
      'Rolled back per-player voice edit sliders — SRS doesn\'t have them, and they fought the radio chain.',
      'Simplified voice chain: pitch + static only, radio presets do the rest of the shaping.',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-10-28',
    bullets: [
      'Full SRS radio integration: filters, saturators, compressors, CVSD vocoder for crypto rigs.',
      'Per-band squelch beds (UHF / VHF / HF / FM / KY58 cryptomap) swap based on your assigned radio.',
      'Real recorded SRS click samples for key-up and key-down.',
    ],
  },
];
