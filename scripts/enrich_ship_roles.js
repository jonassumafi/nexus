const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const SPECS_PATH    = path.resolve(__dirname, '..', 'frontend', 'public', 'images', 'ships', 'ship_specs.json');
const FALLBACKS_LOG = path.resolve(__dirname, 'enrich_fallbacks.log');
const SUMMARY_LOG   = path.resolve(__dirname, 'enrich_summary.log');

const UPPER_MFR = new Set(['rsi', 'misc']);

function slugToWikiName(slug) {
  return slug.split('_').map(part => {
    const lower = part.toLowerCase();
    if (UPPER_MFR.has(lower)) return part.toUpperCase();
    if (/\d/.test(part)) return part;
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join('_');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchWikiHTML(slug) {
  const name = slugToWikiName(slug);
  // starcitizen.tools uses short URLs (no /wiki/ prefix — that is treated as a namespace)
  const url = `https://starcitizen.tools/${encodeURIComponent(name)}`;
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'NexusShipEnrichment/1.0' },
      validateStatus: s => s < 500,
    });
    if (res.status >= 400) return null;
    const html = res.data;
    if (typeof html !== 'string') return null;
    if (html.includes('noarticletext') || html.includes('currently no text in this page')) return null;
    return html;
  } catch {
    return null;
  }
}

function parseIntFromText(s) {
  const m = String(s ?? '').match(/-?\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function extractInfoboxFields(html) {
  const $ = cheerio.load(html);
  const fields = {};

  // Modern starcitizen.tools layout: <dl><dt>Label</dt><dd>Value</dd></dl> inside .t-infobox
  $('.t-infobox dt').each((_, dt) => {
    const $dt = $(dt);
    const label = $dt.text().trim().toLowerCase();
    const value = $dt.next('dd').text().trim().replace(/\s+/g, ' ');
    if (label && value && fields[label] === undefined) fields[label] = value;
  });

  // Manned / Remote turret counts come from .t-card sections whose title contains the label;
  // each turret is one .t-entity-ports-row inside that card.
  $('.t-card').each((_, card) => {
    const $c = $(card);
    const title = $c.find('.t-card__title').first().text().trim().toLowerCase();
    if (!title) return;
    const rows = $c.find('.t-entity-ports-row').length;
    if (title.includes('manned turret') && rows) fields['manned_turret_count'] = String(rows);
    if (title.includes('remote turret') && rows) fields['remote_turret_count'] = String(rows);
  });

  return fields;
}

function buildRolesFromWiki(fields, spec) {
  const crewMax = Math.max(1, spec.crew_max || 1);
  const roles = ['Pilot'];

  // Crew range from infobox e.g. "6–12" — if max ≥ 2, ship has a co-pilot slot
  const crewText = fields['crew'] || '';
  const crewNums = (crewText.match(/\d+/g) || []).map(n => parseInt(n, 10));
  const wikiCrewMax = crewNums.length ? Math.max(...crewNums) : 0;
  if ((wikiCrewMax >= 2 || crewMax >= 2) && roles.length < crewMax) {
    roles.push('Co-Pilot');
  }

  const mannedTurrets = parseIntFromText(fields['manned_turret_count']);
  const remoteTurrets = parseIntFromText(fields['remote_turret_count']);

  for (let i = 1; i <= mannedTurrets && roles.length < crewMax; i++) {
    roles.push(`Turret Gunner ${i}`);
  }
  for (let i = 1; i <= remoteTurrets && roles.length < crewMax; i++) {
    roles.push(`Remote Turret Operator ${i}`);
  }

  // Engineer / medic counts are rarely in the infobox; infer from career when crew slots remain
  const career = String(spec.career || '').toLowerCase();
  const role   = String(spec.role || '').toLowerCase();

  if (role.includes('medic') || role.includes('hospital') || role.includes('rescue')) {
    let n = 1;
    while (roles.length < crewMax && n <= 2) { roles.push(`Medic ${n++}`); }
  }
  if (career.includes('industrial') || career.includes('transport')) {
    let n = 1;
    while (roles.length < crewMax) { roles.push(`Engineer ${n++}`); }
  }

  return roles;
}

function generateFallbackRoles(spec) {
  const crewMax = Math.max(1, spec.crew_max || 1);
  const career = String(spec.career || '').toLowerCase();

  const isIndustrial = career.includes('industrial') || career.includes('transport');
  const isCombat     = career.includes('combat');

  const roles = ['Pilot'];
  if (crewMax >= 2) roles.push('Co-Pilot');

  let nE = 1, nG = 1, nC = 1;
  while (roles.length < crewMax) {
    if (isIndustrial)  roles.push(`Engineer ${nE++}`);
    else if (isCombat) roles.push(`Gunner ${nG++}`);
    else               roles.push(`Crew Member ${nC++}`);
  }
  return roles;
}

function padIfShortOfMin(roles, spec) {
  const crewMin = spec.crew_min || 0;
  const crewMax = Math.max(1, spec.crew_max || 1);
  if (roles.length < crewMin) {
    let n = 1;
    while (roles.length < crewMax) {
      roles.push(`Crew Member ${n++}`);
    }
  }
  if (roles.length > crewMax) {
    roles.length = crewMax;
  }
  return roles;
}

async function main() {
  if (!fs.existsSync(SPECS_PATH)) {
    console.error('ship_specs.json not found at', SPECS_PATH);
    process.exit(1);
  }
  const specs = JSON.parse(fs.readFileSync(SPECS_PATH, 'utf8'));
  const slugs = Object.keys(specs);
  console.log(`Loaded ${slugs.length} ship specs.`);

  fs.writeFileSync(FALLBACKS_LOG, '', 'utf8');

  let wikiOk = 0, fallbackCount = 0;
  const fallbackList = [];

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const spec = specs[slug];
    console.log(`Enriching ship ${i + 1} of ${slugs.length}: ${slug}`);

    let usedFallback = false;
    let roles;

    const html = await fetchWikiHTML(slug);
    if (html) {
      const fields = extractInfoboxFields(html);
      roles = buildRolesFromWiki(fields, spec);
      if (roles.length <= 1 && (spec.crew_max || 1) > 1) {
        roles = generateFallbackRoles(spec);
        usedFallback = true;
      }
    } else {
      roles = generateFallbackRoles(spec);
      usedFallback = true;
    }

    roles = padIfShortOfMin(roles, spec);

    specs[slug] = { ...spec, roles };

    if (usedFallback) {
      fallbackCount++;
      fallbackList.push({ slug, roles });
      fs.appendFileSync(FALLBACKS_LOG, `${slug}\t${JSON.stringify(roles)}\n`, 'utf8');
    } else {
      wikiOk++;
    }

    await sleep(500);
  }

  fs.writeFileSync(SPECS_PATH, JSON.stringify(specs, null, 2) + '\n', 'utf8');

  const summaryLines = [
    `Total ships processed: ${slugs.length}`,
    `Wiki data found: ${wikiOk}`,
    `Fallback used: ${fallbackCount}`,
    '',
    '--- Fallback ships ---',
    ...fallbackList.map(f => `${f.slug}: ${JSON.stringify(f.roles)}`),
  ];
  fs.writeFileSync(SUMMARY_LOG, summaryLines.join('\n') + '\n', 'utf8');

  console.log('Enrichment complete.');
}

main().catch(err => {
  console.error('Fatal:', err.stack || err.message);
  process.exit(1);
});
