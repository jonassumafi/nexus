// Turn a stored ship_model slug ("anvil_hammerhead") into a readable
// display name ("Anvil Hammerhead"). Mirror of the frontend helper so
// webhook embeds don't ship "aegis_hammerhead" to Discord.
function formatShipModel(model) {
  if (!model) return '';
  return String(model)
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

module.exports = formatShipModel;
module.exports.default = formatShipModel;
