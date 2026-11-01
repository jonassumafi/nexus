// useSavePulse — tiny hook for triggering the .btn.go.saved pulse
// animation defined in global.css. Returns a className to spread into
// the button and a trigger() to call after a successful save.
//
// Usage:
//   const pulse = useSavePulse();
//   <button className={`btn go ${pulse.className}`} onClick={async () => {
//     await save();
//     pulse.trigger();
//   }}>Save</button>

import { useCallback, useRef, useState } from 'react';

export default function useSavePulse(durationMs = 2850) {
  const [pulsing, setPulsing] = useState(false);
  const timerRef = useRef(null);

  const trigger = useCallback(() => {
    // Toggle off then on in a single frame so the CSS animation
    // restarts cleanly if save fires twice in rapid succession.
    setPulsing(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    requestAnimationFrame(() => {
      setPulsing(true);
      timerRef.current = setTimeout(() => setPulsing(false), durationMs);
    });
  }, [durationMs]);

  return { className: pulsing ? 'saved' : '', trigger };
}
