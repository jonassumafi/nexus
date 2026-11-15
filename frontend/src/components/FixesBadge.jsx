// FixesBadge — title-bar reopen badge for the Recent fixes card.
// Shown next to the version number in the Full dashboard title bar only.
// Never mounted in Radio-only or Chat popout.
//
// Two states, both silent (no sound, no animation):
//   • Unseen rows available → filled lime pill "Fixes <N>"
//   • After dismissal       → outlined muted pill "Recent fixes"
//
// Clicking either reopens the same card via flow.onReopen.

export default function FixesBadge({ flow }) {
  const { surface, unseenCount, hasEverSeen, entries } = flow;

  // While the card is open, hide the badge — the card is already up.
  if (surface === 'recent') return null;

  const hasUnseen = (unseenCount || 0) > 0;
  const hasAny = (entries?.length || 0) > 0;
  if (!hasUnseen && !hasEverSeen) return null;
  if (!hasAny) return null;

  const onClick = () => { flow.onReopen?.(); };

  return (
    <>
      <style>{CSS}</style>
      {hasUnseen ? (
        <button
          type="button"
          className="nx-fb"
          onClick={onClick}
          title="Recent fixes since your last visit"
        >
          Fixes <b>{unseenCount}</b>
        </button>
      ) : (
        <button
          type="button"
          className="nx-fb nx-fb--seen"
          onClick={onClick}
          title="Show recent fixes again"
        >
          Recent fixes
        </button>
      )}
    </>
  );
}

const CSS = `
.nx-fb {
  display: inline-flex; align-items: center; gap: 6px;
  white-space: nowrap;
  height: 20px; padding: 0 9px;
  border-radius: 10px;
  border: 1px solid var(--lime);
  color: var(--lime);
  font: 700 9.5px Inter, system-ui, sans-serif;
  letter-spacing: .08em; text-transform: uppercase;
  background: color-mix(in srgb, var(--lime) 10%, transparent);
  cursor: pointer;
}
.nx-fb:hover { background: color-mix(in srgb, var(--lime) 20%, transparent); }
.nx-fb b {
  display: inline-grid; place-items: center;
  min-width: 14px; height: 14px; padding: 0 4px;
  border-radius: 7px;
  background: var(--lime);
  color: var(--bg0);
  font: 800 9px Inter, system-ui, sans-serif;
  letter-spacing: 0;
}
.nx-fb--seen {
  border-color: var(--rim1);
  color: var(--t2);
  background: none;
}
.nx-fb--seen:hover {
  border-color: var(--acc);
  color: var(--t1);
}
`;
