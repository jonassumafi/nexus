// Reads the companion app's saved skin at installer launch. The
// companion mirrors nexus_theme to %APPDATA%\Nexus Companion UDP\
// skin.json whenever the user picks one. If the file is missing,
// unreadable, or names a skin the installer doesn't know, we fall back
// to deepblue — never surface an error for any of those cases.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveSkin, DEFAULT_SKIN } = require('./skin-tokens');

// Product names the companion has shipped under. The installer hunts
// each in order; first match wins. Keeping the list short and explicit
// is simpler than parsing Chromium profile directories.
const PRODUCT_NAMES = [
  'Nexus Companion UDP',
  'Nexus Companion',
];

function userDataFor(productName) {
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(base, productName);
}

function readSkinFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.skin === 'string') return parsed.skin.trim();
  } catch {}
  return null;
}

function loadSavedSkin() {
  for (const name of PRODUCT_NAMES) {
    const p = path.join(userDataFor(name), 'skin.json');
    const id = readSkinFile(p);
    if (id) return resolveSkin(id); // unknown ids resolve to default
  }
  return resolveSkin(DEFAULT_SKIN);
}

module.exports = { loadSavedSkin, userDataFor };
