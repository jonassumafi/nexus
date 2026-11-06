// Loads @discordjs/opus in both plain Node and Electron.
//
// The package locates its native binary by runtime name: under Node it
// looks in prebuild/node-v<abi>-napi-v3-<platform>-..., under Electron
// in prebuild/electron-v<major.minor>-napi-v3-<platform>-.... npm install
// only ever downloads the node-* flavour (discordjs publishes no
// electron builds), so inside the app the normal require fails and voice
// silently stops encoding.
//
// The binary is N-API, which is ABI-stable across Node and Electron, so
// any prebuild for this platform/arch works. Fall back to that instead
// of tying the app to one Electron version.
const fs = require('fs');
const path = require('path');

function loadOpus() {
  try {
    return require('@discordjs/opus');
  } catch (first) {
    const pkgDir = path.dirname(require.resolve('@discordjs/opus/package.json'));
    const prebuildDir = path.join(pkgDir, 'prebuild');
    const tag = `-napi-v3-${process.platform}-${process.arch}-`;
    let dirs = [];
    try { dirs = fs.readdirSync(prebuildDir).filter((n) => n.includes(tag)); } catch {}
    for (const d of dirs) {
      try { return require(path.join(prebuildDir, d, 'opus.node')); } catch {}
    }
    first.message += ` (and no usable *${tag}* prebuild in ${prebuildDir})`;
    throw first;
  }
}

module.exports = { loadOpus };
