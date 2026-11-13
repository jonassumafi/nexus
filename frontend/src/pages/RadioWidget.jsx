// Radio-only window mode — the compact floating overlay players keep
// visible on top of Star Citizen. The overlay is the entire window;
// since v0.9.26 the Electron shell gives Radio-only its own
// transparent, non-resizable BrowserWindow and the renderer resizes
// it to match the overlay via a ResizeObserver (see RadioTwinTiles).
//
// Drag region lives on the strip inside the overlay. The empty space
// around the overlay is transparent-window area (no pixels, no drag).

import RadioTwinTiles from '../components/RadioTwinTiles';

export default function RadioWidget() {
  return (
    <>
      <style>{`
        html, body, #root {
          background: transparent !important;
          margin: 0; padding: 0;
          overflow: hidden;
        }
      `}</style>
      <RadioTwinTiles />
    </>
  );
}
