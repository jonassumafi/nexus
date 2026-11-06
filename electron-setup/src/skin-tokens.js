// Nine skins the companion ships with. Keys match what the renderer
// writes to localStorage.nexus_theme (also mirrored to skin.json by the
// app). Values are the exact tokens used by the mockup: acc, acc2, and
// the six layered background/rim tokens. Semantic colors (lime/red/
// amber) stay constant across every skin and live in app.css.
//
// Order here matches the mockup's SK[] array so swatches draw the same
// way if we ever expose a picker.
const SKINS = {
  deepblue:  { label: 'Deep Blue',    acc: '#66AADD', acc2: '#00EEFF', bg0: '#020C14', bg1: '#061018', bg2: '#0A1828', bg3: '#12263A', rim0: '#1A3A50', rim1: '#2A5A7A' },
  obsidian:  { label: 'Obsidian',     acc: '#b4c2d3', acc2: '#e4f2ff', bg0: '#0a0a0c', bg1: '#101012', bg2: '#17171a', bg3: '#202024', rim0: '#2c2c31', rim1: '#4a4a52' },
  ember:     { label: 'Ember',        acc: '#e3a655', acc2: '#ffc766', bg0: '#0c0806', bg1: '#130d09', bg2: '#1c130d', bg3: '#281a11', rim0: '#3a2616', rim1: '#6a4524' },
  oxide:     { label: 'Oxide',        acc: '#e2806a', acc2: '#ffae92', bg0: '#0e0607', bg1: '#160a0b', bg2: '#20100f', bg3: '#2e1715', rim0: '#44201c', rim1: '#7a3a2e' },
  olive:     { label: 'Olive drab',   acc: '#aec86f', acc2: '#dff48f', bg0: '#090b06', bg1: '#0f120a', bg2: '#171b0f', bg3: '#212714', rim0: '#333b1f', rim1: '#5c6b34' },
  violet:    { label: 'Violet void',  acc: '#ae92ee', acc2: '#e6ceff', bg0: '#0a0612', bg1: '#100a1a', bg2: '#181026', bg3: '#231738', rim0: '#34224f', rim1: '#5b3d8c' },
  abyss:     { label: 'Abyss',        acc: '#52c6b3', acc2: '#80f6e8', bg0: '#04100f', bg1: '#081817', bg2: '#0e2321', bg3: '#16322f', rim0: '#1d4642', rim1: '#2f7a72' },
  dune:      { label: 'Dune',         acc: '#d8bd90', acc2: '#f3deb4', bg0: '#100e0c', bg1: '#181512', bg2: '#221e19', bg3: '#2f2922', rim0: '#403830', rim1: '#6e6254' },
  carbon:    { label: 'Carbon pink',  acc: '#ff5fae', acc2: '#ff8cc6', bg0: '#030304', bg1: '#08080a', bg2: '#0f0f12', bg3: '#18181c', rim0: '#25252b', rim1: '#3e3e47' },
};

const DEFAULT_SKIN = 'deepblue';

function resolveSkin(id) {
  // Own-property check: "constructor", "toString" etc. are unknown skins.
  if (typeof id === 'string' && Object.prototype.hasOwnProperty.call(SKINS, id)) return { id, ...SKINS[id] };
  return { id: DEFAULT_SKIN, ...SKINS[DEFAULT_SKIN] };
}

module.exports = { SKINS, DEFAULT_SKIN, resolveSkin };
