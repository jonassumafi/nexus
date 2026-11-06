# Nexus Setup

Custom-skinned Windows installer for the Nexus Companion. Frameless
640×400 window, terminal-style install log, nine skins read live from
the companion's saved settings. Per-user install, no admin prompt.

## Build

From this folder:

```
npm install
npm run build
```

That does, in order:
1. Builds the companion as an unpacked directory (`electron/dist/win-unpacked`).
2. Zips it into `payload/nexus-companion.zip` + writes `payload/manifest.json`.
3. Packages `dist/Nexus UDP Setup <version>.exe` (portable single-file).
4. Emits `dist/latest-udp.yml` so `electron-updater` handoff keeps working.

Publish by copying both files into `backend/releases/`.

## CLI switches

| Switch | Effect |
| --- | --- |
| `--silent`, `/S`           | No window. Installs or uninstalls to the default path. |
| `--dir=<path>`, `/D=<path>`| Override install directory in silent mode. |
| `--uninstall`              | Run uninstall instead of install (silent-capable). |

Silent install exit codes: `0` success, `1` error, `2` canceled.

## What it installs

* Files extracted to `%LOCALAPPDATA%\Programs\Nexus` by default.
* Start Menu shortcut in `Nexus Interstellar Traffic System\`.
* Optional desktop shortcut.
* `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nexus` so
  Windows Settings lists "Nexus Companion UDP".
* Never writes outside the install folder, the shortcut locations
  above, and the HKCU uninstall key.

## Skin behavior

Launches with whatever skin the companion last saved
(`%APPDATA%\nexus-companion-udp\skin.json` — the packaged companion has
no `productName`, so Electron names its userData folder after the
package name). Falls back to Deep Blue
if the file is missing, unreadable, or names an unknown skin — never
shows an error for any of those. The installer only reads the file;
it never writes it.

The nine skins (`deepblue, obsidian, ember, oxide, olive, violet,
abyss, dune, carbon`) are duplicated in `src/skin-tokens.js` so the
installer paints correctly without the companion's `global.css`.

## SmartScreen warning (unsigned)

No code-signing certificate is attached today, so on first run Windows
will show:

> "Windows protected your PC"
> "Microsoft Defender SmartScreen prevented an unrecognized app from
>  starting. Running this app might put your PC at risk."

Click **More info** → **Run anyway**. The warning disappears once
Microsoft's SmartScreen reputation ratchets up, same as the legacy
NSIS installer. To remove it immediately, add a code-signing
certificate (EV preferred) and set `win.certificateFile` /
`win.certificateSubjectName` in `electron-builder.yml`.

## Manual test matrix

* Fresh install on a clean profile.
* Update over a seeded `HKCU` entry at version `0.9.12`.
* Repair over a healthy install.
* Silent install (`--silent`) + silent uninstall (`--silent --uninstall`).
* `/D=` custom path.
* Cancel mid-extraction (Esc or Cancel link) — rollback clean.
* Hold a handle on `Nexus Companion UDP.exe` during update — expect
  Failed screen with log tail + Retry/Copy log.
* Nine saved skins, in `skin.json`:
  `deepblue, obsidian, ember, oxide, olive, violet, abyss, dune, carbon`.
* Three fallbacks:
  * `skin.json` missing → Deep Blue, no error.
  * `skin.json` contents `not-json` → Deep Blue, no error.
  * `skin.json` contains `{"skin":"ultraviolet"}` → Deep Blue, no error.
