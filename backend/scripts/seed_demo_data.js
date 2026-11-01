// Seeds demo users, ships, and missions in various states so the app can
// be tested with a populated database. Does NOT wipe existing data —
// safe to re-run. Fake users get discord IDs starting with 'demo-' so
// they're easy to identify / remove later.
//
// Run with:  node backend/scripts/seed_demo_data.js

require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');

const User           = require('../models/User');
const Ship           = require('../models/Ship');
const Mission        = require('../models/Mission');
const MissionLog     = require('../models/MissionLog');
const PlatformConfig = require('../models/PlatformConfig');

// ─── Demo cast ────────────────────────────────────────────────────────────
const DEMO_OPERATORS = [
  { discord_id: 'demo-grauto',    citizen_name: 'Grauto',          rank: 'Veteran Operator', rp: 540, bio: 'Freelancer turned hired gun. Specializes in low-signature escort runs through contested gates.' },
  { discord_id: 'demo-peter',     citizen_name: 'Peter Tork',      rank: 'Signal-Seeker',    rp: 128, bio: 'Former UEE comms officer. Keeps the fleet networked when relay towers go dark.' },
  { discord_id: 'demo-unger',     citizen_name: 'Unger Poshet',    rank: 'Drifter',          rp:  22, bio: 'Rookie out of microTech. Still saving up for first ship upgrade.' },
  { discord_id: 'demo-tekke',     citizen_name: 'Joe Tekke',       rank: 'Flight Officer',   rp: 460, bio: 'Turret specialist. Favorite seat: the dorsal gun on anything with four engines.' },
  { discord_id: 'demo-liltekke',  citizen_name: 'liltekke',        rank: 'Initiate',         rp: 150, bio: 'Peter\'s cousin. Mostly flies supply runs between Stanton planets.' },
  { discord_id: 'demo-sublime',   citizen_name: 'sublimeswell',    rank: 'Surveyor',         rp: 260, bio: 'Mapping expert. Logs more flight hours in uncharted systems than anyone on roster.' },
  { discord_id: 'demo-marga',     citizen_name: 'Marga Vorn',      rank: 'Pathbreaker',      rp: 350, bio: 'Salvager, haggler, occasional bounty hunter. Rebuilt her Vulture from spare parts.' },
];

const SHIP_MODELS = [
  { slug: 'anvil_gladiator',       type: 'bomber',     name: 'Anvil Gladiator' },
  { slug: 'drake_cutlass_black',   type: 'multi-role', name: 'Cutlass Black' },
  { slug: 'rsi_polaris',           type: 'corvette',   name: 'RSI Polaris' },
  { slug: 'anvil_hurricane',       type: 'gunship',    name: 'Anvil Hurricane' },
  { slug: 'origin_315p',           type: 'explorer',   name: 'Origin 315p' },
  { slug: 'misc_freelancer',       type: 'freighter',  name: 'MISC Freelancer' },
  { slug: 'aegis_vanguard_warden', type: 'fighter',    name: 'Aegis Vanguard Warden' },
  { slug: 'drake_vulture',         type: 'salvage',    name: 'Drake Vulture' },
];

// ship_name → owner citizen_name
const SHIPS = [
  {
    name: 'HCS JOMLET', model: 'anvil_gladiator', owner: 'Peter Tork',
    nodes: [{ role: 'Pilot', x: 50, y: 55 }, { role: 'Turret Operator', x: 65, y: 40 }],
    description: "Served three tours with the UEE 14th Expeditionary before it was decommissioned and sold at a Lorville auction for a quarter of its listed value. Peter claims the previous pilot still haunts the cockpit, which he says explains the cold spots during long transits. Mechanics say it's a draft from the port engine mount. Peter prefers his version.",
  },
  {
    name: 'OLE ASS', model: 'drake_cutlass_black', owner: 'Grauto',
    nodes: [{ role: 'Pilot', x: 48, y: 55 }, { role: 'Co-Pilot', x: 56, y: 55 }, { role: 'Turret Operator', x: 50, y: 32 }],
    description: "The name is not a typo. Grauto won the ship in a drinking contest at Grim Hex, and the previous owner — in his cups and his bitterness — insisted the registry be transferred before the ship was. OLE ASS it was named and OLE ASS it remains. The hull is a patchwork of mismatched panels. The port thruster whines in atmosphere. It still runs. Mostly.",
  },
  {
    name: 'STEADFAST', model: 'rsi_polaris', owner: 'Marga Vorn',
    nodes: [{ role: 'Pilot', x: 45, y: 55 }, { role: 'Turret Operator', x: 55, y: 40 }, { role: 'Turret Operator', x: 55, y: 70 }, { role: 'Engineer', x: 65, y: 55 }],
    description: "Decommissioned by RSI corporate when a cargo audit uncovered three unexplained Xi'An artifacts in the hold. Marga paid cash and asked no questions. Flies clean now, or at least clean enough. The forward missile ports have been welded shut on the orders of her insurance underwriter. The aft turrets have not.",
  },
  {
    name: 'GRIM HEX', model: 'anvil_hurricane', owner: 'Joe Tekke',
    nodes: [{ role: 'Pilot', x: 50, y: 55 }, { role: 'Turret Operator', x: 55, y: 40 }],
    description: "Named after the station Joe called home for six years before he could afford to leave it. The ship was written off by Anvil after a mid-combat engine failure killed its last crew. Joe bought the wreck at salvage auction, rebuilt it in a borrowed hangar on microTech, and has not lost an engagement since. He does not fly it in Pyro.",
  },
  {
    name: 'LITTLE WANDER', model: 'origin_315p', owner: 'Unger Poshet',
    nodes: [{ role: 'Pilot', x: 50, y: 55 }],
    description: "Unger's first ship. Bought it on an installment plan from a microTech dealership that promised zero interest and quietly charged fourteen percent. He has named every system onboard — the nav computer is Chip, the drive is Clipper, the pulse laser is Mister Pointy. The ship has flown exactly two missions. Both are framed above his bunk.",
  },
  {
    name: 'PRYZE', model: 'misc_freelancer', owner: 'sublimeswell',
    nodes: [{ role: 'Pilot', x: 48, y: 55 }, { role: 'Co-Pilot', x: 56, y: 55 }, { role: 'Cargo Manager', x: 50, y: 70 }],
    description: "Found drifting outside Pyro IV with a crew of none and a cargo hold full of unlabelled crates. sublimeswell took the salvage claim, scrubbed the transponder, and renamed it. The crates turned out to be worth more than she expected. She has not told anyone what was in them. She has not been seen in Pyro IV since.",
  },
  {
    name: 'IRON VEIL', model: 'aegis_vanguard_warden', owner: 'liltekke',
    nodes: [{ role: 'Pilot', x: 50, y: 55 }],
    description: "liltekke's older sister bought the ship a month before she disappeared on a Pyro contract. The hull was returned to the family a year later by a Banu merchant who refused payment and left no explanation. liltekke keeps the ship in flying order and does not speak about who flies it besides her.",
  },
  {
    name: 'STRIPLINER', model: 'drake_vulture', owner: 'Marga Vorn',
    nodes: [{ role: 'Pilot', x: 50, y: 55 }, { role: 'Salvage Operator', x: 55, y: 55 }],
    description: "Rebuilt from the carcasses of four separate Vultures Marga stripped and welded in a hangar she technically did not have a lease on. Every bulkhead is a slightly different shade of grey. The exterior still bears partial decals from each donor hull — a tally of ships that didn't make it, carried by one that did.",
  },
];

const MISSION_TYPES = ['Combat', 'Trade', 'Exploration', 'Salvage', 'Escort'];

const MISSIONS = [
  { name: 'OPERATION IRON VEIL',    type: 'Combat',      status: 'WAITING FOR CREW', commander: 'Peter Tork',    ship: 'HCS JOMLET',      support: [], crew: {}, offsetMins: -40 },
  { name: 'OPERATION STARLIGHT',    type: 'Escort',      status: 'FINALIZED',        commander: 'Grauto',        ship: 'OLE ASS',         support: ['IRON VEIL'], crew: { 'OLE ASS': { Pilot: ['Grauto'], 'Co-Pilot': ['Marga Vorn'] } }, offsetMins: -20 },
  { name: 'DELTA-9 PATROL',         type: 'Combat',      status: 'IN PROGRESS',      commander: 'Joe Tekke',     ship: 'GRIM HEX',        support: ['STRIPLINER'], crew: { 'GRIM HEX': { Pilot: ['Joe Tekke'], 'Turret Operator': ['Unger Poshet'] }, 'STRIPLINER': { Pilot: ['Marga Vorn'] } }, offsetMins: -75, launchedMinsAgo: 42 },
  { name: 'SHIPMENT TO LORVILLE',   type: 'Trade',       status: 'COMPLETE',         commander: 'sublimeswell',  ship: 'PRYZE',           support: [], crew: { 'PRYZE': { Pilot: ['sublimeswell'], 'Co-Pilot': ['liltekke'], 'Cargo Manager': ['Marga Vorn'] } }, offsetMins: -200, launchedMinsAgo: 180, elapsedSecs: 5300 },
  { name: 'PYRO SCAN',              type: 'Exploration', status: 'ABORT',            commander: 'sublimeswell',  ship: 'LITTLE WANDER',   support: [], crew: {}, offsetMins: -300 },
  { name: 'SURVEY SWEEP',           type: 'Exploration', status: 'WAITING FOR CREW', commander: 'Marga Vorn',    ship: 'STRIPLINER',      support: [], crew: {}, offsetMins: -10 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────
function freq() { return (118 + Math.random() * 20).toFixed(1); }

function buildCrewRoles(nodes, crewFill = {}) {
  // Collapse node_positions into role → { slots, filled[] } the same way
  // ShipRegistration does on real submissions. crewFill overlays any
  // pre-filled citizen names from the mission's crew map.
  const roles = {};
  for (const n of nodes) {
    if (!roles[n.role]) roles[n.role] = { slots: 0, filled: [] };
    roles[n.role].slots += 1;
  }
  for (const [role, names] of Object.entries(crewFill)) {
    if (!roles[role]) continue;
    // We'll replace citizen names with the user's _id once the user is created.
    roles[role]._pendingFill = names;
  }
  return roles;
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  await mongoose.connect(uri);
  console.log('Connected. Seeding demo data…\n');

  const config = await PlatformConfig.findOne();
  const ranks = config?.rp_ranks || [];
  const findRank = (title) => ranks.find(r => r.title === title) || null;

  // 1. Users
  const userByName = {};
  for (const op of DEMO_OPERATORS) {
    const existing = await User.findOne({ discord_id: op.discord_id });
    if (existing) {
      userByName[op.citizen_name] = existing;
      console.log(`  user   ${op.citizen_name.padEnd(16)} already present`);
      continue;
    }
    const rank = findRank(op.rank);
    const user = await User.create({
      discord_id: op.discord_id,
      username:   op.discord_id.replace('demo-', ''),
      avatar:     null,
      citizen_name:    op.citizen_name,
      place_of_birth:  'Stanton',
      citizenship:     'ArcCorp',
      biography:       op.bio,
      onboarding_complete: true,
      is_freelancer:   true,
      total_rp:        op.rp,
      rp_rank:         rank,
      missions_completed: Math.floor(op.rp / 60),
    });
    userByName[op.citizen_name] = user;
    console.log(`  user   ${op.citizen_name.padEnd(16)} +RP ${op.rp}  (${rank?.title || 'no-rank'})`);
  }

  // 2. Ships
  const shipByName = {};
  for (const s of SHIPS) {
    const owner = userByName[s.owner];
    if (!owner) { console.warn(`  skip ship ${s.name} — owner not seeded`); continue; }
    const existing = await Ship.findOne({ ship_name: s.name, owner_id: owner._id });
    if (existing) {
      // Backfill the description if a previous seed left it empty. This
      // lets re-running the script fill in demo lore on ships that were
      // created before descriptions were part of the seed data.
      if (!existing.description && s.description) {
        existing.description = s.description;
        await existing.save();
        console.log(`  ship   ${s.name.padEnd(16)} (backfilled description)`);
      }
      shipByName[s.name] = existing;
      continue;
    }
    const crew_roles = buildCrewRoles(s.nodes);
    for (const r of Object.values(crew_roles)) delete r._pendingFill;
    const ship = await Ship.create({
      ship_name:  s.name,
      ship_model: s.model,
      owner_id:   owner._id,
      org_id:     null,
      type:       SHIP_MODELS.find(m => m.slug === s.model)?.type || 'multi-role',
      description: s.description || '',
      node_positions: s.nodes,
      crew_roles,
      is_mission: false,
      missions_completed: Math.floor(Math.random() * 6),
      current_mission_id: null,
    });
    shipByName[s.name] = ship;
    console.log(`  ship   ${s.name.padEnd(16)} ${s.model}  owner=${s.owner}`);
  }

  // 3. Missions
  for (const m of MISSIONS) {
    const commander = userByName[m.commander];
    const primary   = shipByName[m.ship];
    if (!commander || !primary) {
      console.warn(`  skip mission ${m.name} — missing commander or ship`);
      continue;
    }
    const existing = await Mission.findOne({ name: m.name });
    if (existing) { console.log(`  mission ${m.name.padEnd(28)} already present`); continue; }

    // Resolve supporting ships
    const supporting = (m.support || []).map(name => shipByName[name]).filter(Boolean);

    // Build crew_roles with real _ids filled in from the mission's crew map
    const applyFill = (shipName) => {
      const ship = shipByName[shipName];
      if (!ship) return null;
      const base = JSON.parse(JSON.stringify(ship.crew_roles || {}));
      const fill = (m.crew || {})[shipName];
      if (fill) {
        for (const [role, names] of Object.entries(fill)) {
          if (!base[role]) continue;
          base[role].filled = names
            .map(n => userByName[n]?._id?.toString())
            .filter(Boolean);
        }
      }
      return base;
    };

    const nowMs = Date.now();
    const scheduledAt = new Date(nowMs + (m.offsetMins || 0) * 60000);
    const launchedAt  = m.launchedMinsAgo ? new Date(nowMs - m.launchedMinsAgo * 60000) : null;

    const missionDoc = await Mission.create({
      name:         m.name,
      mission_type: m.type,
      objectives:   `Demo seed mission (${m.name}). Not a real operation; populated for testing the Nexus Companion app.`,
      created_by:   commander._id,
      org_id:       null,
      is_public:    true,
      status:       m.status,
      primary_ship: primary._id,
      supporting_ships: supporting.map(s => s._id),
      mission_time:    scheduledAt,
      start_time:      launchedAt,
      launched_at:     launchedAt,
      elapsed_seconds: m.elapsedSecs || 0,
      queue_expires_at: null,
      frequency:    freq(),
      hidden_at:    m.status === 'COMPLETE' || m.status === 'ABORT' ? new Date() : null,
    });

    // Apply pre-filled crew to ships + mark on-mission for active missions
    const activeStatuses = ['WAITING FOR CREW', 'FINALIZED', 'IN PROGRESS'];
    for (const shipName of [m.ship, ...(m.support || [])]) {
      const ship = shipByName[shipName];
      if (!ship) continue;
      const nextRoles = applyFill(shipName);
      let totalSlots = 0, filledSlots = 0;
      for (const r of Object.values(nextRoles || {})) {
        totalSlots += r.slots || 0;
        filledSlots += (r.filled || []).length;
      }
      await Ship.findByIdAndUpdate(ship._id, {
        crew_roles: nextRoles,
        crew_fill_percentage: totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0,
        is_mission:         activeStatuses.includes(m.status),
        current_mission_id: activeStatuses.includes(m.status) ? missionDoc._id : null,
      });
    }

    // Seed a few mission-log events for the activity feed
    const base = { mission_id: missionDoc._id, mission_name: m.name };
    await MissionLog.create({ ...base, event_type: 'mission_created', citizen_name: commander.citizen_name, timestamp: scheduledAt });
    if (m.status === 'IN PROGRESS' || m.status === 'COMPLETE') {
      await MissionLog.create({ ...base, event_type: 'mission_launched', citizen_name: commander.citizen_name, rp_awarded: 2, timestamp: launchedAt });
    }
    if (m.status === 'COMPLETE') {
      await MissionLog.create({ ...base, event_type: 'mission_complete', citizen_name: commander.citizen_name, total_rp_awarded: 7, timestamp: new Date() });
    }
    if (m.status === 'ABORT') {
      await MissionLog.create({ ...base, event_type: 'mission_aborted', citizen_name: commander.citizen_name, timestamp: new Date() });
    }

    console.log(`  mission ${m.name.padEnd(28)} status=${m.status}  commander=${m.commander}`);
  }

  console.log('\nDone.');
  await mongoose.disconnect();
}

main().catch(err => { console.error('Seed failed:', err); process.exit(1); });
