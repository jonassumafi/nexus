// Shared dedupe helpers for the radio peer lists. All three radio
// hooks (useRadioConnectionUDP, useRadioConnection, useCommandTunerRx)
// used to let the SAME userId land twice in `peers` when the user
// briefly disconnected and reconnected — the socket id changed, the
// peer-left for the old socket hadn't arrived yet (or arrived after
// the peer-joined), and the roster showed two or three copies of
// everyone's name through a view switch or channel hop.
//
// The authoritative key is the userId: a given operator should
// appear at most once in a tuner's peer list. Different tuners are
// still independent hook instances with separate lists, so a user
// legitimately on both channels still appears in both — just once
// each.

// On radio:peer-joined. If the same socketId is already present,
// do nothing (idempotency). If the same userId is present under a
// different socketId, replace the older entry with the fresh one
// instead of appending.
export function addOrReplacePeer(prev, peer) {
  if (!peer) return prev;
  if (prev.some(p => p.socketId === peer.socketId)) return prev;
  const i = prev.findIndex(
    p => peer.userId && String(p.userId) === String(peer.userId)
  );
  if (i >= 0) {
    const next = prev.slice();
    next[i] = peer;
    return next;
  }
  return [...prev, peer];
}

// On radio:room-peers (server's snapshot sent to a newcomer). Keeps
// only the last occurrence per userId — the server's eviction block
// should already dedupe, but a snapshot taken during a race could
// still contain stragglers, and the client has nothing to lose by
// collapsing them.
export function dedupePeerList(list) {
  if (!Array.isArray(list)) return [];
  const byUser = new Map();
  for (const p of list) {
    const key = p?.userId ? String(p.userId) : (p?.socketId || Math.random().toString());
    byUser.set(key, p);
  }
  return Array.from(byUser.values());
}
