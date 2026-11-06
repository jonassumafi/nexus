#!/usr/bin/env node
// Generate all Nexus icons from the master SVG per logo_e_spec section 5.
//
// Outputs:
//   frontend/public/favicon.ico            — 16/32/48 combined ICO
//   frontend/public/icons/apple-touch-icon-180.png
//   frontend/public/icons/icon-192.png     — PWA / manifest
//   frontend/public/icons/icon-512.png     — PWA / manifest
//   frontend/public/icons/icon-1024.png    — electron source
//   frontend/public/icons/icon-192-maskable.png
//   frontend/public/icons/icon-512-maskable.png
//   electron/build/icon.png                — electron source (1024)
//   electron/build/icon.ico                — electron Windows icon
//
// Run with:
//   node scripts/generate-icons.js
//
// Needs `sharp` and `png-to-ico`. Both are added to the root scripts/
// package.json so the repo's regular install doesn't pull them.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR    = path.join(ROOT, 'frontend', 'public', 'icons');
const PUBLIC_DIR = path.join(ROOT, 'frontend', 'public');
const ELECTRON_BUILD = path.join(ROOT, 'electron', 'build');

// Master SVGs — app-icon uses the master geometry; small-cut only ships
// as the stand-alone favicon.svg. The rounded-square backdrop for the
// app icon is drawn with a <rect> + the mark layered inside.
const MASTER_PATH =
  '<path d="M20 10H9V54H20" fill="none" stroke="#66AADD" stroke-width="5" stroke-linecap="square" stroke-linejoin="miter"/>' +
  '<path d="M44 10H55V54H44" fill="none" stroke="#66AADD" stroke-width="5" stroke-linecap="square" stroke-linejoin="miter"/>' +
  '<path d="M24 22L36 32L24 42" fill="none" stroke="#00EEFF" stroke-width="5" stroke-linecap="square" stroke-linejoin="miter"/>' +
  '<rect x="38" y="40" width="10" height="5" fill="#00EEFF"/>';

const SMALL_PATH =
  '<path d="M21 8H8V56H21M43 8H56V56H43" fill="none" stroke="#66AADD" stroke-width="7" stroke-linecap="square" stroke-linejoin="miter"/>' +
  '<path d="M22 21L35 32L22 43" fill="none" stroke="#00EEFF" stroke-width="7" stroke-linecap="square" stroke-linejoin="miter"/>' +
  '<rect x="37" y="40" width="12" height="7" fill="#00EEFF"/>';

// App icon: rounded 22%-radius square at bg0 with mark centered at 62% size.
function appIconSvg(size) {
  const r = Math.round(size * 0.22);
  const markBoxPct = 0.62;
  const markSize = size * markBoxPct;
  const markOffset = (size - markSize) / 2;
  const borderWidth = Math.max(1, size / 128);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="${borderWidth / 2}" y="${borderWidth / 2}"
        width="${size - borderWidth}" height="${size - borderWidth}"
        rx="${r}" ry="${r}" fill="#020C14" stroke="#4A5A26" stroke-width="${borderWidth}"/>
  <g transform="translate(${markOffset},${markOffset}) scale(${markSize / 64})">${MASTER_PATH}</g>
</svg>`;
}

// Maskable icon: full-bleed bg0, mark at 52% centered so it fits in the
// 80% safe circle (Android adaptive icon crop).
function maskableSvg(size) {
  const markBoxPct = 0.52;
  const markSize = size * markBoxPct;
  const markOffset = (size - markSize) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#020C14"/>
  <g transform="translate(${markOffset},${markOffset}) scale(${markSize / 64})">${MASTER_PATH}</g>
</svg>`;
}

// Favicon: small cut, transparent background.
function faviconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${SMALL_PATH}</svg>`;
}

async function main() {
  let sharp;
  let pngToIco;
  try {
    sharp = require('sharp');
  } catch (err) {
    console.error('Install sharp first:  (cd scripts && npm install)');
    process.exit(1);
  }
  try {
    pngToIco = require('png-to-ico');
  } catch (err) {
    console.error('Install png-to-ico first:  (cd scripts && npm install)');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const write = async (name, svg, size) => {
    const out = path.join(OUT_DIR, name);
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(out);
    console.log(`[png] ${name}  ${size}x${size}`);
  };

  // App icons
  await write('icon-1024.png',        appIconSvg(1024), 1024);
  await write('icon-512.png',         appIconSvg(512),  512);
  await write('icon-192.png',         appIconSvg(192),  192);
  await write('apple-touch-icon-180.png', appIconSvg(180), 180);
  // Maskable
  await write('icon-512-maskable.png', maskableSvg(512), 512);
  await write('icon-192-maskable.png', maskableSvg(192), 192);

  // favicon.ico: 16 + 32 + 48 PNGs merged into one .ico
  const favBufs = await Promise.all([16, 32, 48].map(sz =>
    sharp(Buffer.from(faviconSvg(sz))).resize(sz, sz).png().toBuffer()
  ));
  const icoBuf = await pngToIco(favBufs);
  const favIcoPath = path.join(PUBLIC_DIR, 'favicon.ico');
  fs.writeFileSync(favIcoPath, icoBuf);
  console.log(`[ico] favicon.ico  16/32/48`);

  // Electron icon sources
  fs.mkdirSync(ELECTRON_BUILD, { recursive: true });
  fs.copyFileSync(
    path.join(OUT_DIR, 'icon-1024.png'),
    path.join(ELECTRON_BUILD, 'icon.png')
  );
  console.log(`[copy] electron/build/icon.png  <- icon-1024.png`);

  const electronIcoBuf = await pngToIco(
    await Promise.all([16, 32, 48, 64, 128, 256].map(sz =>
      sharp(Buffer.from(appIconSvg(sz))).resize(sz, sz).png().toBuffer()
    ))
  );
  fs.writeFileSync(path.join(ELECTRON_BUILD, 'icon.ico'), electronIcoBuf);
  console.log(`[ico] electron/build/icon.ico  16/32/48/64/128/256`);

  console.log('\nAll icons written. Next steps:');
  console.log('  1. frontend/index.html head links — point apple-touch-icon');
  console.log('     and manifest icon references at /icons/*.png.');
  console.log('  2. Run  (cd electron && npm run build)  to pick up the new .ico/.png.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
