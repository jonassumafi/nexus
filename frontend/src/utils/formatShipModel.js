// Turn a stored ship_model slug ("anvil_hammerhead") into a readable
// display name ("Anvil Hammerhead"). Shared so every surface — tabs,
// cards, manifests, webhooks — renders the same string.
export default function formatShipModel(model) {
  if (!model) return '';
  return String(model)
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
