#!/usr/bin/env node
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const { load } = require('cheerio');

const SHIP_INDEX_PATH = path.join(__dirname, '../../frontend/public/images/ships/ship_index.json');
const OUT_PATH        = path.join(__dirname, '../data/ship_crew_counts.json');
const ERR_PATH        = '/tmp/ship_scrape_errors.txt';
const DELAY_MS        = 350;

const MANUFACTURER_PREFIXES = [
  'consolidated_outland_', 'esperia_', 'greycat_', 'crusader_', 'tumbril_', 'mirai_',
  'origin_', 'kruger_', 'vanduul_', 'aopoa_', 'aegis_', 'drake_', 'anvil_', 'argo_',
  'banu_', 'misc_', 'gatac_', 'rsi_', 'cnou_', 'xian_',
];

function slugToWikiTitle(slug) {
  let name = slug;
  for (const pfx of MANUFACTURER_PREFIXES) {
    if (name.startsWith(pfx)) { name = name.slice(pfx.length); break; }
  }
  return name
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('_');
}

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'NexusScraper/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        const abs = loc.startsWith('http') ? loc : `https://starcitizen.tools${loc}`;
        return fetchPage(abs).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseInfobox(html) {
  const $ = load(html);
  const out = {};
  $('dt').each((_, dt) => {
    const label = $(dt).text().trim();
    const dd    = $(dt).next('dd');
    if (dd.length) out[label] = dd.text().trim();
  });
  return out;
}

function parseCrewRange(raw) {
  if (!raw) return { min: null, max: null };
  // "6–12" (en-dash) or "6-12" or "6" or "Up to 12"
  const m = raw.match(/(\d+)\s*[–\-]\s*(\d+)/);
  if (m) return { min: parseInt(m[1], 10), max: parseInt(m[2], 10) };
  const s = raw.match(/(\d+)/);
  if (s) { const n = parseInt(s[1], 10); return { min: n, max: n }; }
  return { min: null, max: null };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const shipIndex = JSON.parse(fs.readFileSync(SHIP_INDEX_PATH, 'utf8'));
  const slugs     = Object.keys(shipIndex);

  const results = {};
  const errors  = [];

  console.log(`Scraping ${slugs.length} ships from starcitizen.tools …`);

  for (let i = 0; i < slugs.length; i++) {
    const slug  = slugs[i];
    const title = slugToWikiTitle(slug);
    const url   = `https://starcitizen.tools/${title}`;

    process.stdout.write(`[${i + 1}/${slugs.length}] ${slug} → ${title} … `);

    try {
      const { status, body } = await fetchPage(url);
      if (status !== 200) throw new Error(`HTTP ${status}`);

      const box  = parseInfobox(body);
      const crew = parseCrewRange(box['Crew']);
      results[slug] = {
        wiki_title: title,
        crew_min:   crew.min,
        crew_max:   crew.max,
        crew_raw:   box['Crew'] ?? null,
        career:     box['Career']  ?? null,
        role:       box['Role']    ?? null,
        size:       box['Size']    ?? null,
      };
      console.log(`crew=${box['Crew'] ?? 'n/a'} career=${box['Career'] ?? '-'} role=${box['Role'] ?? '-'}`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      errors.push(`${slug}: ${err.message}`);
      results[slug] = { wiki_title: title, crew_min: null, crew_max: null, crew_raw: null, career: null, role: null, size: null, error: err.message };
    }

    if (i < slugs.length - 1) await sleep(DELAY_MS);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  fs.writeFileSync(ERR_PATH, errors.join('\n'));

  const ok   = slugs.length - errors.length;
  console.log(`\nDone: ${ok}/${slugs.length} scraped. ${errors.length} errors → ${ERR_PATH}`);
  console.log(`Output: ${OUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
