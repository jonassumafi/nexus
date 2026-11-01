# Nexus Companion

Electron shell for the Nexus Interstellar Traffic System web app, with
**global push-to-talk** that works while Star Citizen (or any other
window) has keyboard focus.

## Why

Browsers only receive keystrokes when they have window focus. If you're
in-game, pressing V goes to Star Citizen — the browser-based Nexus
radio never sees it. This companion runs an OS-level keyboard hook so
your PTT key triggers the radio no matter which window is in front.

Everything else (UI, voice profile, mission channels, name-click DMs)
is the same web app — Electron just serves it in a frame.

## Running from source

```sh
cd nexus/electron
npm install
npm start                       # loads https://nexus-missions.space
npm run start:dev               # loads http://localhost:5173 (local dev)
```

First launch will ask for microphone access. Grant it.

## Push-to-talk key

The companion reads your PTT key from the same voice profile the web
app uses. Open the radio settings panel inside the companion, change
the key, and the OS-level hook follows along.

Default is **V**.

## Running alongside Star Citizen

For global hotkeys to reach the companion while SC is in front, run SC
in **borderless-windowed** mode. Exclusive-fullscreen on Windows can
swallow OS keystrokes depending on the game.

(Most SC players already run borderless-windowed because alt-tab
behaves better that way.)

## Building a distributable `.exe`

```sh
npm run build                   # Windows installer in ./dist/
npm run build:all               # Windows + macOS + Linux
```

The installer uses NSIS. First-time users on Windows will see a
SmartScreen "Unknown publisher" warning until the binary is signed with
a code-signing certificate — click **More info → Run anyway** to
proceed. See the project root for notes on code signing options.

## Project layout

```
electron/
├── package.json
├── src/
│   ├── main.js       Main process: window, mic permissions, key hook
│   └── preload.js    Narrow bridge exposing window.electronAPI
└── build/
    ├── icon.ico      Windows icon (TODO)
    └── icon.png      macOS / Linux icon (TODO)
```

The frontend (in `../frontend/`) detects `window.electronAPI` at runtime
and routes PTT events through the IPC bridge when present. No frontend
code changes are required to run outside Electron — it's purely
additive.

## Troubleshooting

**PTT doesn't fire in-game.**
- Check SC is in borderless-windowed mode.
- Check the companion's main-process console: `[main] global key hook active, PTT key = V`. If you see `key hook failed`, the OS-level listener didn't start — on Linux you need read access to `/dev/input/*`, on macOS you need to grant Input Monitoring permission in System Settings.

**Microphone access denied.**
- Windows: Settings → Privacy → Microphone → allow desktop apps.
- macOS: System Settings → Privacy & Security → Microphone → check Nexus Companion.

**"Can't find module 'node-global-key-listener'".**
- Run `npm install` in `nexus/electron/`.
