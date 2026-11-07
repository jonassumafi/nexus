// Lightweight hold counter the update flow can wait on, so a required
// update card never slides up mid-transmission. Radio PTT sites call
// hold()/release() on key down/up; the hook calls whenReleased() before
// opening the Update card and defers to the next idle moment.

let depth = 0;
const listeners = new Set();

function emit() {
  for (const fn of listeners) {
    try { fn(depth > 0); } catch {}
  }
}

export function pttHold() {
  depth += 1;
  if (depth === 1) emit();
}

export function pttRelease() {
  if (depth > 0) depth -= 1;
  if (depth === 0) emit();
}

export function pttIsHeld() {
  return depth > 0;
}

export function onPttChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Resolves immediately when PTT is idle, otherwise on the next release.
export function whenReleased() {
  if (depth === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const off = onPttChange((held) => {
      if (!held) { off(); resolve(); }
    });
  });
}
