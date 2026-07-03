
# Star Citizen Bot — RP System (Core Features, p.95–end)

> Extracted from your RP packet’s final section (pages 95–105). This doc captures the core features, command specs, and implementation notes your developer needs, plus a MongoDB schema tailored to these features.

---

## A. Rules & Visibility (Final)

### RP Rules (Final)
**Players earn RP:**
1) Launching a mission → **+1**  
2) Filling a crew slot → **+2**  
3) Completing a mission → **+2**  
4) Submitting an after‑action log → **+3**  

**Ships earn RP:**  
Any ship (primary or support) at or above the **admin‑set fill rate threshold** (default **75%**) at mission launch → **+3** per qualifying ship.  
_No penalties. No safeguards. All point values and the threshold are admin‑adjustable._

### Command Visibility
- **Admin‑only (ephemeral):** `/rp_points view`, `/rp_points set`, `/ship_fillrate view`, `/ship_fillrate set`
- **Player‑only (ephemeral):** `/mycharacter`
- **Public (channel):** `/character_list`, `/ship_rp`

---

## B. Commands (User Embed → Dev Notes → Dev‑Style Embed)

### 1) `/character_list` (Public)

**User-Facing Embed (MS‑DOS style)**
```
[TRANSMISSION INCOMING...] >> CHARACTER REGISTRY
====================================================
|              HOPEWELL PERSONNEL INDEX            |
====================================================
001) ➤ Eric The Red .............. 184 / 300 – 🛡 Captain
002) ➤ sublimeswell .............. 172 / 300 – 🛡 Captain
003) ➤ JUSJOHNY .................. 161 / 300 – 🛡 Captain
...
----------------------------------------------------
Use ⬅  ➡  to change pages. Try /mycharacter for your full profile.
```

**Developer Notes (What to compute & store)**
- Compute `total_rp` per user from the four allowed player events only.  
- Map `total_rp` to a rank via `ranks.min_rp` (optional).  
- Sort descending by `total_rp`. Paginate (25 rows/page).  
- Fixed‑width alignment; cache page slices for speed.

**Developer‑Style Embed (Pseudo‑Code)**
```python
players = fetch_players_with_totals()  # sorted desc by rp
lines = [
    f"{i+1:03d}) ➤ {p.name:<20} {p.rp:>4} / {p.next_cap:<3} – {p.rank_emoji} {p.rank_name}"
    for i, p in enumerate(page_of(players, size=25))
]
embed = {
    "title": "CHARACTER REGISTRY",
    "description": "\n".join(lines),
}
send(channel, embed)
```

---

### 2) `/mycharacter` (Ephemeral to player)

**User-Facing Embed**
```
[TRANSMISSION INCOMING...] >> CHARACTER PROFILE
====================================================
|                  CITIZEN DATABASE                |
====================================================
>> CITIZEN NAME        Umberto Tobark
>> MISSIONS COMPLETED  6
>> REPUTATION POINTS   23 / 75 – 🔧 Crewman
>> 30-DAY CHANGE       +8
====================================================
>> BIOGRAPHY
{wrapped bio text}
```

**Developer Notes**
- Pull invoking user’s `missions_completed`, `total_rp`, rank/emoji, and rolling 30‑day change.  
- Always ephemeral. If top rank reached, show `/ MAX` rather than “to next threshold”.

**Developer‑Style Embed**
```python
p = get_player(ctx.user_id)
embed = {
  "title": "CHARACTER PROFILE",
  "description": (
      f">> CITIZEN NAME        {p.name}\n"
      f">> MISSIONS COMPLETED  {p.missions}\n"
      f">> REPUTATION POINTS   {p.rp} / {p.next_cap} – {p.rank_emoji} {p.rank}\n"
      f">> 30-DAY CHANGE       {p.delta_30d:+d}"
  )
}
send(ephemeral=True, embed=embed)
```

---

### 3) `/ship_rp` (Public)

#### 3.1 List View (Fleet Index)
**User-Facing Embed**
```
[TRANSMISSION INCOMING...] >> SHIP RP EFFICIENCY
====================================================
|                FLEET EFFICIENCY INDEX            |
====================================================
001) ➤ HCS Polaris ............... [######..] 82% | Ship RP: 48 | missions: 27
002) ➤ HCS C8 Pisces .............. [#####...] 74% | Ship RP: 33 | missions: 19
003) ➤ HCS Chimera ................ [#######.] 69% | Ship RP: 27 | missions: 16
...
----------------------------------------------------
Use ⬅  ➡  to change pages. Use /ship_rp ship:<name> for details.
```
**Meaning:** Progress bar + % = lifetime **high‑fill success rate**; **Ship RP** = sum of ship bonus points on qualifying missions; **missions** = total participations (primary + support).

**Developer Notes**
- Lifetime aggregates from `ship_rp_ledger` (see schema).  
- `high_fill_rate = missions_qualified / missions_total`.  
- Render 8‑char progress bar from `high_fill_rate`.  
- Public; paginate (25 rows).

**Developer‑Style Embed**
```python
ships = fetch_ship_rollups()  # includes rate, ship_rp, mission counts
def bar(p):
    filled = round(p * 8); return f"[{'#'*filled}{'.'*(8-filled)}] {p*100:.0f}%"
lines = [
  f"{i+1:03d}) ➤ {s.name:<20} {bar(s.high_fill)} | Ship RP: {s.total_rp} | missions: {s.missions}"
  for i, s in enumerate(page_of(ships, 25))
]
send(channel, {"title":"SHIP RP EFFICIENCY","description":"\n".join(lines)})
```

#### 3.2 Detail View — `/ship_rp ship:<name>`
**User-Facing Embed**
```
[TRANSMISSION INCOMING...] >> SHIP RP — DETAIL
====================================================
|                HCS POLARIS (HEAVY COMBAT)        |
====================================================
>> LIFETIME SHIP RP      48
>> HIGH-FILL RATE        [######..] 82%   (qualified missions / total)
>> MISSIONS ANALYZED     27  (primary + support)
>> CAPACITY (REGISTRY)   8
>> AVG FILL AT LAUNCH    6.7 / 8  (84%)
----------------------------------------------------
|                 LAST 5 MISSIONS (ROLLUP)         |
----------------------------------------------------
• “Black Ice” .......... fill 8/8 (100%) | PRIMARY  | QUALIFIED ✓ | +3 RP
• “Rust Veil” .......... fill 7/8 (88%)  | SUPPORT  | QUALIFIED ✓ | +3 RP
• “Terminus Run” ....... fill 5/8 (63%)  | PRIMARY  | QUALIFIED ✗ | +0 RP
• “Quasar Net” ......... fill 8/8 (100%) | SUPPORT  | QUALIFIED ✓ | +3 RP
• “Silent Ledger” ...... fill 6/8 (75%)  | PRIMARY  | QUALIFIED ✓ | +3 RP
```
**Developer Notes**
- Insert one `ship_rp_ledger` row per ship per mission **at launch** if `fill_rate ≥ threshold` (store `role`, `capacity`, `filled`, `fill_rate`, `points_awarded`).  
- Detail view aggregates: `missions_total`, `missions_qualified`, `high_fill_rate`, `ship_rp_total`, `avg_fill`.  
- Last N missions = recent launches for that ship with qualification mark and points.

**Developer‑Style Embed**
```python
s = get_ship(ctx.args["ship"])
rollup = get_ship_rollup(s.id)
last = get_ship_last_missions(s.id, limit=5)
desc = [
  f">> LIFETIME SHIP RP      {rollup.total_rp}",
  f">> HIGH-FILL RATE        {bar(rollup.high_fill)}",
  f">> MISSIONS ANALYZED     {rollup.missions}",
  f">> CAPACITY (REGISTRY)   {s.capacity}",
  f">> AVG FILL AT LAUNCH    {rollup.avg_fill:.1f} / {s.capacity}  ({rollup.avg_fill/ s.capacity:0.0%})",
  "----------------------------------------------------",
  "|                 LAST 5 MISSIONS (ROLLUP)         |",
  "----------------------------------------------------",
] + [format_mission_row(m) for m in last]
send(channel, {"title":"SHIP RP — DETAIL","description":"\n".join(desc)})
```

---

### 4) Admin Controls: `/rp_points`

#### `/rp_points view` (Ephemeral)
Shows the configurable point values the bot uses for **player** events and the **ship** bonus.
```
[TRANSMISSION INCOMING...] >> RP CONFIG — POINT TABLE
====================================================
|                CURRENT POINT VALUES              |
====================================================
>> PLAYER EVENTS
MISSION_LAUNCHED ............... +1
CREW_SLOT_FILLED ............... +2
MISSION_COMPLETED .............. +2
AFTERMATH_LOG .................. +3
----------------------------------------------------
>> SHIP EVENT
SHIP_FILL_BONUS ................ +3 (per qualifying ship)
```
**Notes:** Values come from `rp_settings`. Display role‑based access as ephemeral to admins.

#### `/rp_points set` (Ephemeral)
```
/rp_points set key:<EVENT_KEY> value:<int> reason:<str>
```
**EVENT_KEY:** `MISSION_LAUNCHED | CREW_SLOT_FILLED | MISSION_COMPLETED | AFTERMATH_LOG | SHIP_FILL_BONUS`  
Persists to `rp_settings` with `updated_by`, `updated_at`, and `reason`. Future events use new values.

---

### 5) Admin Controls: `/ship_fillrate`

#### `/ship_fillrate view` (Ephemeral)
Shows current high‑fill threshold and ship bonus points.
```
Current Ship Fill Rate Threshold: 75%
```

#### `/ship_fillrate set` (Ephemeral, affects **future** missions)
```
/ship_fillrate set threshold_percent:<int> points:<int> reason:<str>
```
**Confirmation Embed**
```
[TRANSMISSION INCOMING...] >> RP CONFIG — SHIP FILL RATE
====================================================
|             SHIP FILL RATE SETTINGS              |
====================================================
>> FILL THRESHOLD     75% → 70%
>> SHIP BONUS POINTS  +3   (unchanged)
>> APPLIES TO         All primary & support ships
>> CHANGED BY         @Alfredo
>> REASON             "Encourage near-full launches."
```
**Notes:** Applies to both primary & support ships; **does not** retro‑recalculate prior missions.

---

## C. Event‑Based Announcements (at Mission Launch / After‑Action)
- On **mission launch**, announce per‑crew RP (+2 for fill), staggered ~10s to avoid spam.  
- On **log submission**, announce +3 per unique log, also staggered.  
- Pull live values from `rp_settings` so admin changes are respected.

---

## D. MongoDB Schema (Implementation‑Ready)

> Collection names use lowercase with underscores. Add your own shard/cluster strategy as needed.

### 1) `rp_settings`
Purpose: live configuration for points & threshold.
```json
{
  "_id": "SHIP_FILL_RULES",               // single doc or use separate keys
  "points": {
    "MISSION_LAUNCHED": 1,
    "CREW_SLOT_FILLED": 2,
    "MISSION_COMPLETED": 2,
    "AFTERMATH_LOG": 3,
    "SHIP_FILL_BONUS": 3
  },
  "ship_fill_threshold": 75,              // percent
  "updated_by": "Snow (discordId)",
  "updated_at": ISODate("2025-01-01T00:00:00Z"),
  "reason": "Initial defaults"
}
```
**Indexes:** `{ _id: 1 }` (primary).

### 2) `rp_ledger`
Player RP events.
```json
{
  "_id": ObjectId("..."),
  "player_id": ObjectId("players/_id"),
  "mission_id": ObjectId("missions/_id"),
  "event_code": "CREW_SLOT_FILLED",       // one of the four player events
  "points": 2,
  "applied_ts": ISODate("2025-01-21T20:15:00Z"),
  "meta": { "ship_id": ObjectId("...") }  // optional context
}
```
**Indexes:** `{ player_id: 1, applied_ts: -1 }`, `{ mission_id: 1 }`, `{ event_code: 1 }`.

### 3) `ship_rp_ledger`
Ship RP events (one row per ship per mission **when qualified**).
```json
{
  "_id": ObjectId("..."),
  "ship_id": ObjectId("ships/_id"),
  "mission_id": ObjectId("missions/_id"),
  "role": "PRIMARY",                      // or "SUPPORT"
  "capacity_at_launch": 8,
  "filled_at_launch": 7,
  "fill_rate": 88,                        // percent (int)
  "points_awarded": 3,                    // 0 if you choose to store non-qualifying rows
  "awarded_ts": ISODate("2025-01-21T20:15:00Z"),
  "threshold_snapshot": 75                // for audit/debug
}
```
**Indexes:** `{ ship_id: 1, awarded_ts: -1 }`, `{ mission_id: 1 }`, `{ fill_rate: -1 }`.

### 4) `players`
```json
{ "_id": ObjectId("..."), "discord_id": "123", "name": "sublimeswell", "created_at": ISODate("...") }
```
**Indexes:** `{ discord_id: 1 }` (unique).

### 5) `ranks` (optional)
```json
{ "_id": ObjectId("..."), "name": "Crewman", "emoji": "🔧", "min_rp": 75 }
```
**Indexes:** `{ min_rp: 1 }`.

### 6) `missions` and `mission_ships` (lightweight additions)
```json
// missions
{ "_id": ObjectId("..."), "name": "Rust Veil", "start_ts": ISODate("..."), "completed": true }

// mission_ships (snapshot at launch)
{
  "_id": ObjectId("..."),
  "mission_id": ObjectId("..."),
  "ship_id": ObjectId("..."),
  "role": "PRIMARY",
  "capacity_at_launch": 8,
  "filled_at_launch": 7
}
```
**Indexes:** `mission_ships: { mission_id: 1, ship_id: 1 }`.

---

## E. Slash Commands Summary (Arguments & Visibility)

- `/character_list` → **Public**. Pagination (25/page).  
- `/mycharacter` → **Ephemeral** to invoker.  
- `/ship_rp` → **Public**. List view.  
  - Options: `page:int` (default 1).  
- `/ship_rp ship:<name>` → **Public**. Detail view.  
- `/rp_points view` → **Admin**, **Ephemeral**.  
- `/rp_points set key:<EVENT_KEY> value:<int> reason:<str>` → **Admin**, **Ephemeral**.  
- `/ship_fillrate view` → **Admin**, **Ephemeral**.  
- `/ship_fillrate set threshold_percent:<int> points:<int> reason:<str>` → **Admin**, **Ephemeral**.

---

## F. Implementation Tips
- **Cache** computed leaderboards and ship rollups for snappy embeds; invalidate on mission end/launch or on admin config change.  
- **Auditability:** Keep `reason`, `updated_by`, `threshold_snapshot` in settings/ledger for clean change history.  
- **Ephemeral vs Public:** Enforce visibility at the command level; never leak admin settings to public channels.  
- **No retro changes:** Threshold/point edits affect **future** missions only unless you intentionally rebuild history.

---

*End of core features (compiled from your final packet).*

