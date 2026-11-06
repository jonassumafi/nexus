// 16px inline friend marker — a two-person glyph in a thin border.
// Used after the author name in global chat and beside names in the
// friends drawer. aria-label is always set so screen readers announce
// the relationship.
export default function FriendMarkerIcon({ size = 16, title = 'Friend' }) {
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      style={{
        width: size, height: size,
        display: 'inline-grid',
        placeItems: 'center',
        border: '1px solid color-mix(in srgb, var(--blue) 55%, transparent)',
        color: 'var(--blue)',
        flex: 'none',
        verticalAlign: 'middle',
      }}
    >
      <svg width={Math.round(size * 0.7)} height={Math.round(size * 0.7)} viewBox="0 0 24 24"
           fill="none" stroke="currentColor" strokeWidth="1.8"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="8" cy="9" r="3" />
        <circle cx="16" cy="10" r="2.5" />
        <path d="M2.5 20c.6-3 3-5 5.5-5s4.9 2 5.5 5" />
        <path d="M14 20c.5-2.2 2.2-3.8 4-4" />
      </svg>
    </span>
  );
}
