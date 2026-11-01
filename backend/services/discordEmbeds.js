// Discord embed builders — one per event type. Shapes mirror the mockup at
// ./Nexus Discord Webhooks.html (field names, copy, color coding).

const COLORS = {
  LIME:   4521096,   // #44FF88
  BLUE:   6727389,   // #66AADD
  RED:    16733508,  // #FF5544
  AMBER:  16759603,  // #FFBB33
  PURPLE: 11166429,  // #AA66DD
};

const FOOTER = { text: 'Nexus Interstellar Traffic System · nexus.app-palette.com' };

function dash(v) {
  if (v === undefined || v === null || v === '') return '—';
  return String(v);
}

function base(color, icon, title, description) {
  const embed = {
    color,
    title: `${icon} ${title}`,
    footer: FOOTER,
    timestamp: new Date().toISOString(),
  };
  if (description) embed.description = description;
  return embed;
}

function f(name, value, inline = true) {
  return { name, value: dash(value), inline };
}

function missionCreated({ missionName, type, commanderName, scheduledTime, primaryVessel }) {
  const e = base(COLORS.BLUE, '🗺️', 'MISSION CREATED',
    'A new operation has been posted to the mission board.');
  e.fields = [
    f('Mission', missionName),
    f('Type', type),
    f('Commander', commanderName),
    f('Scheduled', scheduledTime),
    { name: 'Primary Vessel', value: dash(primaryVessel), inline: false },
  ];
  return e;
}

function missionLaunched({ missionName, type, commanderName, crewCount }) {
  const e = base(COLORS.LIME, '🚀', 'MISSION LAUNCHED',
    'Operation is now underway. All crew are aboard.');
  e.fields = [
    f('Mission', missionName),
    f('Type', type),
    f('Commander', commanderName),
    f('Crew Aboard', crewCount != null ? `${crewCount} operators` : null),
  ];
  return e;
}

function missionComplete({ missionName, elapsedTime, commanderName, crewCount }) {
  const e = base(COLORS.LIME, '🏁', 'MISSION COMPLETE',
    'Operation concluded successfully. RP distributed to all crew.');
  e.fields = [
    f('Mission', missionName),
    f('Elapsed Time', elapsedTime),
    f('Commander', commanderName),
    f('Crew Size', crewCount != null ? `${crewCount} operators` : null),
  ];
  return e;
}

function missionAborted({ missionName, commanderName }) {
  const e = base(COLORS.RED, '✖', 'MISSION ABORTED',
    'Operation called off by the commanding officer.');
  e.fields = [
    f('Mission', missionName),
    f('Commander', commanderName),
  ];
  return e;
}

function crewSlotFilled({ operatorName, role, missionName, vessel }) {
  const e = base(COLORS.LIME, '✅', 'CREW SLOT FILLED',
    'An operator has joined the crew roster.');
  e.fields = [
    f('Operator', operatorName),
    f('Role', role),
    f('Mission', missionName),
    f('Vessel', vessel),
  ];
  return e;
}

function crewSlotWithdrawn({ operatorName, role, missionName, vessel }) {
  const e = base(COLORS.BLUE, '↩', 'CREW SLOT WITHDRAWN',
    'An operator has vacated their crew position.');
  e.fields = [
    f('Operator', operatorName),
    f('Role', role),
    f('Mission', missionName),
    f('Vessel', vessel),
  ];
  return e;
}

function rankAdvancement({ operatorName, newRank }) {
  const e = base(COLORS.LIME, '⭐', 'RANK ADVANCEMENT',
    'An operator has reached a new rank in the Hopewell Continuum.');
  e.fields = [
    f('Operator', operatorName),
    f('New Rank', newRank),
  ];
  return e;
}

function shipRpAwarded({ vesselName, rpEarned, fillRate, missionName }) {
  const e = base(COLORS.LIME, '🚢', 'SHIP RP AWARDED',
    'A vessel met crew fill threshold and earned Ship RP.');
  e.fields = [
    f('Vessel', vesselName),
    f('RP Earned', rpEarned != null ? `+${rpEarned} Ship RP` : null),
    f('Fill Rate', fillRate != null ? `${fillRate}%` : null),
    f('Mission', missionName),
  ];
  return e;
}

function shipAccessGranted({ vesselName, ownerName, borrowerName, loanDuration }) {
  const e = base(COLORS.AMBER, '🔑', 'SHIP ACCESS GRANTED',
    'A vessel has been cleared for temporary assignment.');
  e.fields = [
    f('Vessel', vesselName),
    f('Owner', ownerName),
    f('Borrower', borrowerName),
    f('Loan Duration', loanDuration),
  ];
  return e;
}

function shipRecalled({ vesselName, ownerName }) {
  const e = base(COLORS.RED, '⚠️', 'SHIP RECALLED',
    'A vessel was recalled by its owner mid-operation.');
  e.fields = [
    f('Vessel', vesselName),
    f('Owner', ownerName),
    {
      name: 'Note',
      value: 'Ship RP forfeited for this mission. Crew RP unaffected.',
      inline: false,
    },
  ];
  return e;
}

function operatorOnline({ operatorName, rank }) {
  const e = base(COLORS.BLUE, '📡', 'OPERATOR ONLINE');
  e.fields = [
    f('Operator', operatorName),
    f('Rank', rank),
  ];
  return e;
}

function operatorOffline({ operatorName, rank }) {
  const e = base(COLORS.BLUE, '🔌', 'OPERATOR OFFLINE');
  e.fields = [
    f('Operator', operatorName),
    f('Rank', rank),
  ];
  return e;
}

function webhookTest() {
  const e = base(COLORS.BLUE, '📡', 'WEBHOOK TEST',
    'Your Nexus webhook is configured correctly.');
  return e;
}

module.exports = {
  COLORS,
  missionCreated,
  missionLaunched,
  missionComplete,
  missionAborted,
  crewSlotFilled,
  crewSlotWithdrawn,
  rankAdvancement,
  shipRpAwarded,
  shipAccessGranted,
  shipRecalled,
  operatorOnline,
  operatorOffline,
  webhookTest,
};
