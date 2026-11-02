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
