#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

const IN_PATH  = path.join(__dirname, '../data/ship_crew_counts.json');
const OUT_PATH = path.join(__dirname, '../../frontend/public/images/ships/ship_specs.json');

const raw = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'));

const specs = {};
for (const [slug, data] of Object.entries(raw)) {
  specs[slug] = {
    crew_min: data.crew_min,
    crew_max: data.crew_max,
    career:   data.career,
    role:     data.role,
    size:     data.size ?? null,
  };
}

fs.writeFileSync(OUT_PATH, JSON.stringify(specs, null, 2));
console.log(`Wrote ${Object.keys(specs).length} entries to ${OUT_PATH}`);

// Spot-check
['rsi_polaris', 'anvil_hurricane', 'aegis_hammerhead', 'misc_freelancer'].forEach(k => {
  console.log(k + ':', JSON.stringify(specs[k]));
});
