// Wipes PLAYER-generated data from NexusDB to let character creation be
// tested from scratch. Preserves platform-level reference data:
//   - PlatformConfig (RP ranks, mission type catalog, settings)
//   - ShipModel (manufacturer ship catalog)
//   - Organization (orgs are reference data, not per-player state)
//
// Collections wiped:
//   - User               (operators / profiles)
//   - Ship               (registered vessels)
//   - Mission            (active missions)
//   - MissionArchive     (completed/aborted mission history)
//   - MissionLog         (activity feed events)
//   - ShipAccessRequest  (loan requests)
//   - RPLedger           (per-player RP transactions)
//   - ShipRPLedger       (per-ship RP transactions)
//   - AISummary          (generated feed summaries)
//
// Run with:  node backend/scripts/wipe_player_data.js
// Backend server does not need to be running.

require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');

const User              = require('../models/User');
const Ship              = require('../models/Ship');
const Mission           = require('../models/Mission');
const MissionArchive    = require('../models/MissionArchive');
const MissionLog        = require('../models/MissionLog');
const ShipAccessRequest = require('../models/ShipAccessRequest');
const RPLedger          = require('../models/RPLedger');
const ShipRPLedger      = require('../models/ShipRPLedger');
const AISummary         = require('../models/AISummary');

const WIPE_COLLECTIONS = [
  { name: 'User',              model: User              },
  { name: 'Ship',              model: Ship              },
  { name: 'Mission',           model: Mission           },
  { name: 'MissionArchive',    model: MissionArchive    },
  { name: 'MissionLog',        model: MissionLog        },
  { name: 'ShipAccessRequest', model: ShipAccessRequest },
  { name: 'RPLedger',          model: RPLedger          },
  { name: 'ShipRPLedger',      model: ShipRPLedger      },
  { name: 'AISummary',         model: AISummary         },
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set in backend/.env');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('Connected. Wiping player data…\n');

  for (const { name, model } of WIPE_COLLECTIONS) {
    const before = await model.countDocuments();
    const { deletedCount } = await model.deleteMany({});
    console.log(`  ${name.padEnd(20)} ${String(before).padStart(5)} → 0 (removed ${deletedCount})`);
  }

  console.log('\nPreserved: PlatformConfig, ShipModel, Organization');
  await mongoose.disconnect();
  console.log('Done.');
}

main().catch(err => {
  console.error('Wipe failed:', err);
  process.exit(1);
});
