const PlatformConfig = require('../models/PlatformConfig');

const THIRTEEN_RANKS = [
  { min_rp: 0,    max_rp: 49,   title: 'Drifter',               emoji: '🕶️',  unlocks: [] },
  { min_rp: 50,   max_rp: 149,  title: 'Signal-Seeker',         emoji: '📡',  unlocks: [] },
  { min_rp: 150,  max_rp: 249,  title: 'Initiate',              emoji: '🧬',  unlocks: [] },
  { min_rp: 250,  max_rp: 349,  title: 'Surveyor',              emoji: '🧭',  unlocks: ['1M aUEC bonus'] },
  { min_rp: 350,  max_rp: 449,  title: 'Pathbreaker',           emoji: '🛠️',  unlocks: ['Append ships to missions'] },
  { min_rp: 450,  max_rp: 599,  title: 'Flight Officer',        emoji: '🔫',  unlocks: [] },
  { min_rp: 600,  max_rp: 749,  title: 'Senior Flight Officer', emoji: '🦺',  unlocks: [] },
  { min_rp: 750,  max_rp: 899,  title: 'Continuum Navigator',   emoji: '🧭',  unlocks: [] },
  { min_rp: 900,  max_rp: 1099, title: 'Detachment Marshal',    emoji: '📋',  unlocks: ['Create and launch missions'] },
  { min_rp: 1100, max_rp: 1499, title: 'Fleet Marshal',         emoji: '🎖️',  unlocks: [] },
  { min_rp: 1500, max_rp: 1799, title: 'Principal',             emoji: '🛡️',  unlocks: [] },
  { min_rp: 1800, max_rp: 2399, title: 'Vanguard Commander',    emoji: '⚔️',  unlocks: ['Register third ship'] },
  { min_rp: 2400, max_rp: null, title: 'Hopewell Steward',      emoji: '🕊️',  unlocks: [] },
];

const DEFAULT_CONFIG = {
  mission_types: [
    { name: 'Combat',        description: 'Engage hostile forces',                                        emoji: '⚔️' },
    { name: 'Cargo',         description: 'Transport goods between locations',                            emoji: '📦' },
    { name: 'Salvage',       description: 'Recover materials from wrecks or derelicts',                  emoji: '♻️' },
    { name: 'Exploration',   description: 'Discover locations anomalies or jump points',                  emoji: '🔭' },
    { name: 'Mining',        description: 'Extract ores and minerals',                                    emoji: '⛏️' },
    { name: 'Recon',         description: 'Scout and gather intel without direct engagement',             emoji: '📡' },
    { name: 'Escort',        description: 'Defend a person ship or convoy',                               emoji: '🛡️' },
    { name: 'Rescue',        description: 'Recover stranded players or crew under duress',                emoji: '🆘' },
    { name: 'Science',       description: 'Perform scanning testing or research operations',              emoji: '🔬' },
    { name: 'Leisure',       description: 'Non-combat missions focused on RP sightseeing racing or social events', emoji: '🏖️' },
    { name: 'Miscellaneous', description: 'Other does not fit defined types',                             emoji: '❓' },
  ],
  ship_types: [
    { name: 'Starter',       emoji: '🧭' },
    { name: 'Snub',          emoji: '🛰️' },
    { name: 'Light Fighter', emoji: '✈️' },
    { name: 'Medium Fighter',emoji: '⚔️' },
    { name: 'Heavy Fighter', emoji: '🛡️' },
    { name: 'Bomber',        emoji: '💥' },
    { name: 'Cargo',         emoji: '📦' },
    { name: 'Exploration',   emoji: '🌌' },
    { name: 'Medical',       emoji: '🩺' },
    { name: 'Refuel',        emoji: '⛽' },
    { name: 'Repair',        emoji: '🔧' },
    { name: 'Recon',         emoji: '👁️' },
    { name: 'Luxury',        emoji: '💎' },
    { name: 'Touring',       emoji: '🧳' },
    { name: 'Escort',        emoji: '👣' },
    { name: 'Gunship',       emoji: '🛸' },
    { name: 'Corvette',      emoji: '🛳️' },
    { name: 'Frigate',       emoji: '⚓' },
    { name: 'Capital',       emoji: '🪐' },
  ],
  crew_roles: [
    { name: 'Pilot',      emoji: '✈️', description: 'Primary ship operator' },
    { name: 'Gunner',     emoji: '🔫', description: 'Weapons operator' },
    { name: 'Engineer',   emoji: '🔧', description: 'Ship systems maintenance' },
    { name: 'Medic',      emoji: '🩺', description: 'Crew health and recovery' },
    { name: 'Navigator',  emoji: '🧭', description: 'Route planning and scanning' },
  ],
  rp_settings: {
    points: { MISSION_LAUNCHED: 1, POST_MISSION_LOG: 3, SHIP_FILL_BONUS: 3 },
    crew_fill: {
      min: { threshold: 50, points: 1 },
      max: { threshold: 70, points: 2 },
    },
    ship_fill_threshold: 75,
  },
  rp_ranks: THIRTEEN_RANKS,
  max_ships_per_player: 2,
  max_ships_per_mission: 3,
  ai_summary_enabled: true,
};

async function seedPlatformConfig() {
  const count = await PlatformConfig.countDocuments();
  if (count > 0) return;
  await PlatformConfig.create(DEFAULT_CONFIG);
  console.log('[Seed] PlatformConfig inserted with defaults');
}

async function migratePlatformConfig() {
  const doc = await PlatformConfig.findOne().lean();
  if (!doc) return;

  const needsRankUpdate = !doc.rp_ranks || doc.rp_ranks.length !== 13;
  const hasOldKey = doc.rp_settings?.points?.AFTERMATH_LOG !== undefined;
  const missingTimezone = doc.display_timezone === undefined;

  if (!needsRankUpdate && !hasOldKey && !missingTimezone) return;

  const setOps = {};
  const unsetOps = {};

  if (needsRankUpdate) {
    setOps['rp_ranks'] = THIRTEEN_RANKS;
  }
  if (hasOldKey) {
    setOps['rp_settings.points.POST_MISSION_LOG'] = doc.rp_settings.points.AFTERMATH_LOG ?? 3;
    unsetOps['rp_settings.points.AFTERMATH_LOG'] = '';
  }
  if (missingTimezone) {
    setOps['display_timezone'] = 'UTC';
  }

  await PlatformConfig.updateOne({}, { $set: setOps, $unset: unsetOps });
  console.log('[Migrate] PlatformConfig: ranks and RP point keys updated');
}

module.exports = { seedPlatformConfig, migratePlatformConfig };
