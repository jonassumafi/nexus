// Resolve a user record into an <img> src for a profile avatar.
//
// Two sources:
//   1) A full URL stored on user.avatar (http[s], data:, or /path) — used
//      by operators whose avatar came from the onboarding portrait flow.
//   2) A raw Discord avatar hash stored on user.avatar — joined with
//      user.discord_id to build the Discord CDN URL.
//
// Returns null when neither source is available so callers can fall back
// to an initials placeholder.
export function resolveAvatar(user) {
  const a = user?.avatar;
  if (!a) return null;
  if (/^(https?:|data:|\/)/i.test(a)) return a;
  if (user?.discord_id) {
    const ext = a.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.discord_id}/${a}.${ext}?size=256`;
  }
  return null;
}

// Initials from a name — "Kestrel Rowan" → "KR". Falls back to "—" when
// no name is available so the avatar placeholder reads as "unknown" vs
// an empty circle.
export function initialsOf(name) {
  if (!name || name === '—') return '—';
  return String(name).split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
