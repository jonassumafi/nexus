const mongoose = require('mongoose');
const path = require('path');

const User           = require('../models/User');
const Organization   = require('../models/Organization');
const Ship           = require('../models/Ship');
const Mission        = require('../models/Mission');
const MissionLog     = require('../models/MissionLog');
const PlatformConfig = require('../models/PlatformConfig');

// FIX 11 — run on every startup to ensure missions 1-4 filled[] use discord_id strings, not ObjectIds
async function migrateFilledToDiscordIds() {
  const missionNames = ['OPERATION IRON VEIL', 'SUPPLY RUN: BLOOM', 'ESCORT: TERMINUS RUN', 'SALVAGE: MONOX FIELD'];
  for (const name of missionNames) {
    const mission = await Mission.findOne({ name });
    if (!mission) continue;
    const shipIds = [mission.primary_ship, ...(mission.supporting_ships || [])].filter(Boolean);
    for (const shipId of shipIds) {
      const ship = await Ship.findById(shipId);
      if (!ship || !ship.crew_roles) continue;
      let changed = false;
      for (const [roleName, roleData] of Object.entries(ship.crew_roles)) {
        const newFilled = [];
        for (const entry of (roleData.filled || [])) {
          const entryStr = String(entry);
          if (mongoose.Types.ObjectId.isValid(entryStr)) {
            const user = await User.findById(entryStr);
            if (user?.discord_id && user.discord_id !== entryStr) {
              newFilled.push(user.discord_id);
              changed = true;
            } else {
              newFilled.push(entryStr);
            }
          } else {
            newFilled.push(entryStr);
          }
        }
        ship.crew_roles[roleName] = { ...roleData, filled: newFilled };
      }
      if (changed) {
        ship.markModified('crew_roles');
        await ship.save();
        console.log(`[Migration] Converted filled[] to discord_ids: ${ship.ship_name}`);
      }
    }
  }
}

async function seedMissions() {
  // Seed data disabled — platform now uses real player data only.
  // Original seed preserved below for reference but not executed.
  return;

  // ── Step 0: Update PlatformConfig mission types ──────────────────────────
  await PlatformConfig.updateOne({}, {
    $set: {
      mission_types: [
        { name: 'Combat',         emoji: '⚔️',  description: 'Direct engagement with hostile forces. Expect heavy resistance and active countermeasures.' },
        { name: 'Escort',         emoji: '🛡️',  description: 'Protection of a designated asset or vessel through hostile territory.' },
        { name: 'Logistics',      emoji: '📦',  description: 'Supply delivery, cargo transport, or resource movement between locations.' },
        { name: 'Salvage',        emoji: '🔧',  description: 'Recovery of derelict vessels, equipment, or cargo from hostile or contested areas.' },
        { name: 'Reconnaissance', emoji: '🔭',  description: 'Intelligence gathering and area surveillance without direct engagement.' },
        { name: 'Mining',         emoji: '⛏️',  description: 'Extraction of raw materials from asteroid fields or planetary surfaces.' },
        { name: 'Bounty',         emoji: '🎯',  description: 'Capture or neutralization of a designated target for bounty reward.' },
        { name: 'Patrol',         emoji: '👁️',  description: 'Area denial and security sweep of a designated sector or route.' },
        { name: 'Assassination',  emoji: '🗡️',  description: 'Elimination of a high-value target with minimal collateral engagement.' },
        { name: 'Rescue',         emoji: '🚑',  description: 'Extraction of personnel from hostile, hazardous, or inaccessible locations.' },
        { name: 'Assault',        emoji: '💥',  description: 'Coordinated offensive strike against a fortified position or installation.' },
      ],
    },
  });
  console.log('[SeedMissions] PlatformConfig mission types updated.');

  // ── FIX 11: migrate ObjectId filled entries to discord_id strings ─────────
  await migrateFilledToDiscordIds();

  // ── Backfill ship_model for test ships missing it ─────────────────────────
  await Ship.updateMany(
    { $or: [{ ship_model: { $exists: false } }, { ship_model: '' }, { ship_model: null }] },
    { $set: { ship_model: 'RSI Polaris' } }
  );
  console.log('[SeedMissions] ship_model backfill complete.');

  // ── Initial 4-mission seed (runs once when DB is empty) ──────────────────
  const count = await Mission.countDocuments();
  if (count === 0) {
    console.log('[SeedMissions] Seeding dummy missions...');

    // ── Dummy users ─────────────────────────────────────────────────────────
    const u1 = await User.findOneAndUpdate(
      { discord_id: 'dummy_001' },
      { discord_id: 'dummy_001', username: 'dummy_001', citizen_name: 'Rael Thorne',
        rp_rank: { title: 'Signal-Seeker', min_rp: 50, max_rp: 149 },
        total_rp: 87, onboarding_complete: true, is_freelancer: true },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const u2 = await User.findOneAndUpdate(
      { discord_id: 'dummy_002' },
      { discord_id: 'dummy_002', username: 'dummy_002', citizen_name: 'Corvin Ash',
        rp_rank: { title: 'Initiate', min_rp: 150, max_rp: 249 },
        total_rp: 180, onboarding_complete: true, is_freelancer: true },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const u3 = await User.findOneAndUpdate(
      { discord_id: 'dummy_003' },
      { discord_id: 'dummy_003', username: 'dummy_003', citizen_name: 'Voss Marlowe',
        rp_rank: { title: 'Surveyor', min_rp: 250, max_rp: 349 },
        total_rp: 290, onboarding_complete: true, is_freelancer: true },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // ── Dummy org ────────────────────────────────────────────────────────────
    let org = await Organization.findOne({ invite_code: 'HWCONT' });
    if (!org) {
      org = await Organization.create({
        name: 'Hopewell Continuum', prefix: 'HCS',
        invite_code: 'HWCONT', commander_id: u1._id, member_count: 3,
      });
    }

    // ── Resolve dummy discord_id → ObjectId ──────────────────────────────────
    const uid = { dummy_001: u1._id, dummy_002: u2._id, dummy_003: u3._id };

    const roles = (defs) => {
      const out = {};
      for (const [name, d] of Object.entries(defs)) {
        out[name] = { slots: d.slots, filled: d.filled.map(k => uid[k]).filter(Boolean) };
      }
      return out;
    };

    const pct = (roleDef) => {
      let total = 0, filled = 0;
      for (const d of Object.values(roleDef)) { total += d.slots; filled += d.filled.length; }
      return total > 0 ? Math.round((filled / total) * 100) : 0;
    };

    // ── Mission 1: OPERATION IRON VEIL ──────────────────────────────────────
    const m1Roles = {
      'Pilot':                  { slots: 1, filled: ['dummy_001'] },
      'Co-Pilot':               { slots: 1, filled: [] },
      'Remote Turret Op 1':     { slots: 1, filled: [] },
      'Remote Turret Op 2':     { slots: 1, filled: [] },
      'Top Turret Gunner 1':    { slots: 1, filled: [] },
      'Top Turret Gunner 2':    { slots: 1, filled: [] },
      'Side Turret Port':       { slots: 1, filled: [] },
      'Side Turret Starboard':  { slots: 1, filled: [] },
      'Torpedo Op 1':           { slots: 1, filled: [] },
      'Torpedo Op 2':           { slots: 1, filled: [] },
      'Rear Turret Gunner':     { slots: 1, filled: [] },
      'Engineer 1':             { slots: 1, filled: [] },
      'Engineer 2':             { slots: 1, filled: [] },
      'Hangar Controller':      { slots: 1, filled: [] },
      'Fighter Pilot':          { slots: 1, filled: [] },
      'Hangar Support':         { slots: 1, filled: [] },
    };
    const m1SuppRoles = {
      'Pilot':    { slots: 1, filled: ['dummy_002'] },
      'Co-Pilot': { slots: 1, filled: [] },
      'Gunner':   { slots: 1, filled: [] },
    };
    const ship1 = await Ship.create({
      ship_name: 'HCS CHIMERA', owner_id: u1._id, org_id: org._id,
      type: 'Polaris', ship_model: 'RSI Polaris', is_mission: true,
      crew_roles: roles(m1Roles), crew_fill_percentage: pct(m1Roles),
    });
    const ship1s = await Ship.create({
      ship_name: 'HCS WARDEN', owner_id: u1._id, org_id: org._id,
      type: 'Freelancer', ship_model: 'RSI Polaris', is_mission: true,
      crew_roles: roles(m1SuppRoles), crew_fill_percentage: pct(m1SuppRoles),
    });
    await Mission.create({
      name: 'OPERATION IRON VEIL', mission_type: 'Combat',
      status: 'WAITING FOR CREW',
      created_by: u1._id, org_id: org._id, is_public: false,
      primary_ship: ship1._id, supporting_ships: [ship1s._id],
      objectives: 'Intercept hostile convoy in Pyro III airspace. Neutralize escort fighters. Secure the cargo vessel intact.',
    });

    // ── Mission 2: SUPPLY RUN: BLOOM ────────────────────────────────────────
    const m2Roles = {
      'Pilot':                  { slots: 1, filled: ['dummy_001'] },
      'Co-Pilot':               { slots: 1, filled: ['dummy_002'] },
      'Remote Turret Op 1':     { slots: 1, filled: ['dummy_003'] },
      'Remote Turret Op 2':     { slots: 1, filled: [] },
      'Top Turret Gunner 1':    { slots: 1, filled: ['dummy_001'] },
      'Top Turret Gunner 2':    { slots: 1, filled: [] },
      'Side Turret Port':       { slots: 1, filled: ['dummy_002'] },
      'Side Turret Starboard':  { slots: 1, filled: [] },
      'Torpedo Op 1':           { slots: 1, filled: ['dummy_003'] },
      'Torpedo Op 2':           { slots: 1, filled: [] },
      'Rear Turret Gunner':     { slots: 1, filled: ['dummy_001'] },
      'Engineer 1':             { slots: 1, filled: ['dummy_002'] },
      'Engineer 2':             { slots: 1, filled: [] },
      'Hangar Controller':      { slots: 1, filled: ['dummy_003'] },
      'Fighter Pilot':          { slots: 1, filled: [] },
      'Hangar Support':         { slots: 1, filled: [] },
    };
    const ship2 = await Ship.create({
      ship_name: 'HCS MERIDIAN', owner_id: u2._id, org_id: org._id,
      type: 'Polaris', ship_model: 'RSI Polaris', is_mission: true,
      crew_roles: roles(m2Roles), crew_fill_percentage: pct(m2Roles),
    });
    await Mission.create({
      name: 'SUPPLY RUN: BLOOM', mission_type: 'Logistics',
      status: 'FINALIZED',
      created_by: u2._id, org_id: org._id, is_public: false,
      primary_ship: ship2._id, supporting_ships: [],
      objectives: 'Deliver medical supplies to Bloom outpost. Avoid Rough and Ready patrols in sector 7.',
    });

    // ── Mission 3: ESCORT: TERMINUS RUN ─────────────────────────────────────
    const m3Roles = {
      'Pilot':                  { slots: 1, filled: ['dummy_001'] },
      'Co-Pilot':               { slots: 1, filled: ['dummy_002'] },
      'Remote Turret Op 1':     { slots: 1, filled: ['dummy_003'] },
      'Remote Turret Op 2':     { slots: 1, filled: ['dummy_001'] },
      'Top Turret Gunner 1':    { slots: 1, filled: ['dummy_002'] },
      'Top Turret Gunner 2':    { slots: 1, filled: ['dummy_003'] },
      'Side Turret Port':       { slots: 1, filled: ['dummy_001'] },
      'Side Turret Starboard':  { slots: 1, filled: ['dummy_002'] },
      'Torpedo Op 1':           { slots: 1, filled: ['dummy_003'] },
      'Torpedo Op 2':           { slots: 1, filled: ['dummy_001'] },
      'Rear Turret Gunner':     { slots: 1, filled: ['dummy_002'] },
      'Engineer 1':             { slots: 1, filled: ['dummy_003'] },
      'Engineer 2':             { slots: 1, filled: ['dummy_001'] },
      'Hangar Controller':      { slots: 1, filled: ['dummy_002'] },
      'Fighter Pilot':          { slots: 1, filled: ['dummy_003'] },
      'Hangar Support':         { slots: 1, filled: ['dummy_001'] },
    };
    const ship3 = await Ship.create({
      ship_name: 'INS VAGRANT', owner_id: u3._id, org_id: null,
      type: 'Polaris', ship_model: 'RSI Polaris', is_mission: true,
      crew_roles: roles(m3Roles), crew_fill_percentage: pct(m3Roles),
    });
    await Mission.create({
      name: 'ESCORT: TERMINUS RUN', mission_type: 'Escort',
      status: 'IN PROGRESS',
      created_by: u3._id, org_id: null, is_public: true,
      primary_ship: ship3._id, supporting_ships: [],
      objectives: 'Escort cargo freighter from Pyro V to Terminus. Full crew assigned. Ready to launch.',
    });

    // ── Mission 4: SALVAGE: MONOX FIELD ─────────────────────────────────────
    // Always uses dedicated seed ships (DAGGER / LANTERN / HOLLOW). Never assigns
    // player-registered ships to seed missions.
    const m4Roles = {
      'Pilot':                  { slots: 1, filled: ['dummy_003'] },
      'Co-Pilot':               { slots: 1, filled: [] },
      'Remote Turret Op 1':     { slots: 1, filled: ['dummy_001'] },
      'Remote Turret Op 2':     { slots: 1, filled: [] },
      'Top Turret Gunner 1':    { slots: 1, filled: ['dummy_002'] },
      'Top Turret Gunner 2':    { slots: 1, filled: [] },
      'Side Turret Port':       { slots: 1, filled: ['dummy_003'] },
      'Side Turret Starboard':  { slots: 1, filled: [] },
      'Torpedo Op 1':           { slots: 1, filled: [] },
      'Torpedo Op 2':           { slots: 1, filled: [] },
      'Rear Turret Gunner':     { slots: 1, filled: ['dummy_001'] },
      'Engineer 1':             { slots: 1, filled: [] },
      'Engineer 2':             { slots: 1, filled: ['dummy_002'] },
      'Hangar Controller':      { slots: 1, filled: [] },
      'Fighter Pilot':          { slots: 1, filled: ['dummy_003'] },
      'Hangar Support':         { slots: 1, filled: [] },
    };
    const m4SuppRoles1 = {
      'Pilot':    { slots: 1, filled: ['dummy_001'] },
      'Engineer': { slots: 1, filled: [] },
    };
    const m4SuppRoles2 = {
      'Pilot':  { slots: 1, filled: [] },
      'Gunner': { slots: 1, filled: ['dummy_002'] },
    };
    const m4Primary = await Ship.create({
      ship_name: 'FSS DAGGER', owner_id: u3._id, org_id: null,
      type: 'Polaris', ship_model: 'RSI Polaris', is_mission: true,
      crew_roles: roles(m4Roles), crew_fill_percentage: pct(m4Roles),
    });
    const ship4s1 = await Ship.create({
      ship_name: 'FSS LANTERN', owner_id: u1._id, org_id: null,
      type: 'Cutlass', ship_model: 'RSI Polaris', is_mission: true,
      crew_roles: roles(m4SuppRoles1), crew_fill_percentage: pct(m4SuppRoles1),
    });
    const ship4s2 = await Ship.create({
      ship_name: 'FSS HOLLOW', owner_id: u2._id, org_id: null,
      type: 'Cutlass', ship_model: 'RSI Polaris', is_mission: true,
      crew_roles: roles(m4SuppRoles2), crew_fill_percentage: pct(m4SuppRoles2),
    });
    const m4Supports = [ship4s1, ship4s2];

    const mission4 = await Mission.create({
      name: 'SALVAGE: MONOX FIELD', mission_type: 'Salvage',
      status: 'COMPLETE',
      created_by: u3._id, org_id: null, is_public: true,
      primary_ship: m4Primary._id, supporting_ships: m4Supports.map(s => s._id),
      objectives: 'Salvage derelict mining equipment from Monox asteroid belt. Beware hostile scavengers.',
    });

    // Mark assigned ships as on-mission (covers both the player ships and the fallback seed ships).
    for (const ship of [m4Primary, ...m4Supports]) {
      ship.is_mission = true;
      ship.current_mission_id = mission4._id;
      await ship.save();
    }

    console.log('[SeedMissions] Done — 4 missions, 7 ships, 3 users, 1 org created.');
  } else {
    console.log(`[SeedMissions] ${count} missions already exist — skipping initial seed.`);
  }

  // ── Mission 5: RECON: PYRO IV BELT (join-crew test mission) ─────────────
  // discord_ids stored as strings in filled[] so FIX 2 name population works
  const m5Exists = await Mission.findOne({ name: 'RECON: PYRO IV BELT' });
  if (m5Exists) {
    console.log('[SeedMissions] Mission 5 (RECON: PYRO IV BELT) already exists — skipping.');
    return;
  }

  const u1m5 = await User.findOne({ discord_id: 'dummy_001' });
  const u3m5 = await User.findOne({ discord_id: 'dummy_003' });

  const ship5 = await Ship.create({
    ship_name: 'HCS Polaris',
    owner_id: u3m5 ? u3m5._id : null,
    type: 'Polaris',
    ship_model: 'RSI Polaris',
    is_mission: true,
    crew_fill_percentage: 13,
    crew_roles: {
      'Pilot':                  { slots: 1, filled: ['dummy_001'] },
      'Co-Pilot':               { slots: 1, filled: [] },
      'Remote Turret Op 1':     { slots: 1, filled: [] },
      'Remote Turret Op 2':     { slots: 1, filled: [] },
      'Top Turret Gunner 1':    { slots: 1, filled: [] },
      'Top Turret Gunner 2':    { slots: 1, filled: [] },
      'Side Turret Port':       { slots: 1, filled: [] },
      'Side Turret Starboard':  { slots: 1, filled: [] },
      'Torpedo Op 1':           { slots: 1, filled: [] },
      'Torpedo Op 2':           { slots: 1, filled: [] },
      'Rear Turret Gunner':     { slots: 1, filled: [] },
      'Engineer 1':             { slots: 1, filled: ['dummy_002'] },
      'Engineer 2':             { slots: 1, filled: [] },
      'Hangar Controller':      { slots: 1, filled: [] },
      'Fighter Pilot':          { slots: 1, filled: [] },
      'Hangar Support':         { slots: 1, filled: [] },
    },
  });

  await Mission.create({
    name: 'RECON: PYRO IV BELT',
    mission_type: 'Reconnaissance',
    status: 'WAITING FOR CREW',
    created_by: u3m5 ? u3m5._id : null,
    org_id: null,
    is_public: true,
    primary_ship: ship5._id,
    supporting_ships: [],
    objectives: 'Survey Pyro IV asteroid belt for Rough and Ready mining activity. Report coordinates. Do not engage.',
  });

  console.log('[SeedMissions] Mission 5 (RECON: PYRO IV BELT) created.');
}

async function seedActivityEvents() {
  // Disabled — using real data only.
  return;
  const existing = await MissionLog.countDocuments();
  if (existing > 10) {
    console.log(`[SeedActivity] ${existing} MissionLog entries already exist — skipping.`);
    return;
  }

  const H = 60 * 60 * 1000;
  const MIN = 60 * 1000;
  const now = Date.now();
  const ts = (ms) => new Date(now - ms);

  const events = [
    { event_type: 'slot_filled',      citizen_name: 'Rael Thorne',   ship_name: 'HCS Chimera',  role_name: 'Pilot',               rp_earned: 1, timestamp: ts(47 * H) },
    { event_type: 'slot_filled',      citizen_name: 'Corvin Ash',    ship_name: 'HCS Chimera',  role_name: 'Top Turret Gunner 1', rp_earned: 1, timestamp: ts(46 * H) },
    { event_type: 'slot_filled',      citizen_name: 'Voss Marlowe',  ship_name: 'HCS Chimera',  role_name: 'Engineer 1',          rp_earned: 2, timestamp: ts(45 * H) },
    { event_type: 'ship_fill_bonus',  ship_name: 'HCS Chimera',     mission_name: 'OPERATION IRON VEIL', rp_earned: 3, timestamp: ts(44 * H) },
    { event_type: 'mission_prep',     citizen_name: 'Rael Thorne',   mission_name: 'OPERATION IRON VEIL', timestamp: ts(43 * H) },
    { event_type: 'mission_launched', citizen_name: 'Rael Thorne',   mission_name: 'OPERATION IRON VEIL', rp_earned: 2, timestamp: ts(42 * H) },
    { event_type: 'rank_advanced',    citizen_name: 'Corvin Ash',    rank_name: 'Signal-Seeker',          timestamp: ts(40 * H) },
    { event_type: 'post_mission_log', citizen_name: 'Voss Marlowe',  mission_name: 'OPERATION IRON VEIL', rp_earned: 3, timestamp: ts(38 * H) },
    { event_type: 'post_mission_log', citizen_name: 'Corvin Ash',    mission_name: 'OPERATION IRON VEIL', rp_earned: 3, timestamp: ts(36 * H) },
    { event_type: 'mission_complete', mission_name: 'OPERATION IRON VEIL', timestamp: ts(35 * H) },
    { event_type: 'slot_filled',      citizen_name: 'Voss Marlowe',  ship_name: 'HCS Meridian', role_name: 'Pilot',    rp_earned: 1, timestamp: ts(30 * H) },
    { event_type: 'slot_withdrawn',   citizen_name: 'Rael Thorne',   ship_name: 'HCS Meridian', role_name: 'Co-Pilot',               timestamp: ts(28 * H) },
    { event_type: 'slot_filled',      citizen_name: 'Rael Thorne',   ship_name: 'HCS Meridian', role_name: 'Co-Pilot', rp_earned: 1, timestamp: ts(27 * H) },
    { event_type: 'mission_prep',     citizen_name: 'Voss Marlowe',  mission_name: 'BLOOM',     timestamp: ts(20 * H) },
    { event_type: 'queue_expired',    mission_name: 'SALVAGE: MONOX FIELD', timestamp: ts(18 * H) },
    { event_type: 'slot_filled',      citizen_name: 'Corvin Ash',    ship_name: 'INS Vagrant',  role_name: 'Remote Turret Op 1', rp_earned: 2, timestamp: ts(12 * H) },
    { event_type: 'rank_advanced',    citizen_name: 'Voss Marlowe',  rank_name: 'Initiate',     timestamp: ts(10 * H) },
    { event_type: 'mission_launched', citizen_name: 'Voss Marlowe',  mission_name: 'TERMINUS RUN', rp_earned: 3, timestamp: ts(8 * H) },
    { event_type: 'post_mission_log', citizen_name: 'Rael Thorne',   mission_name: 'TERMINUS RUN', rp_earned: 3, timestamp: ts(4 * H) },
    { event_type: 'ai_summary',
      summary_text: 'Fleet operations over the past 48 hours have seen significant activity across three active missions. Operation Iron Veil concluded successfully with full crew participation. The Terminus Run remains in progress with strong crew fill rates across all vessels. Recommend continued recruitment for Bloom supply mission.',
      timestamp: ts(2 * H) },
    { event_type: 'slot_filled',      citizen_name: 'Rael Thorne',   ship_name: 'HCS Polaris',  role_name: 'Pilot', rp_earned: 1, timestamp: ts(1 * H) },
    { event_type: 'rank_advanced',    citizen_name: 'Rael Thorne',   rank_name: 'Surveyor',     timestamp: ts(30 * MIN) },
  ];

  await MissionLog.insertMany(events);
  console.log(`[SeedActivity] Inserted ${events.length} dummy activity events.`);
}

module.exports = { seedMissions, seedActivityEvents };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => seedMissions())
    .then(() => seedActivityEvents())
    .then(() => mongoose.disconnect())
    .then(() => { console.log('Done.'); process.exit(0); })
    .catch(err => { console.error(err); process.exit(1); });
}
