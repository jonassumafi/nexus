# Nexus 1.0 — Mongoose Schema Reference

## PlatformConfig

Singleton document. Only one document exists. Managed via admin API.

```js
{
  mission_types: [{ name: String, description: String, emoji: String }],
  ship_types: [{ name: String, emoji: String }],
  crew_roles: [{ name: String, emoji: String, description: String }],
  rp_settings: {
    points: {
      MISSION_LAUNCHED: Number,   // default 1
      POST_MISSION_LOG: Number,   // default 3
      SHIP_FILL_BONUS: Number,    // default 3
    },
    crew_fill: {
      min: { threshold: Number, points: Number },  // default 50, 1
      max: { threshold: Number, points: Number },  // default 70, 2
    },
    ship_fill_threshold: Number,  // default 75
  },
  rp_ranks: [{
    min_rp: Number,
    max_rp: Number | null,
    title: String,
    emoji: String,
    unlocks: [String],
  }],
  max_ships_per_player: Number,   // default 2
  max_ships_per_mission: Number,  // default 3
  ai_summary_enabled: Boolean,    // default true
}
```

---

## User

```js
{
  discord_id: String (unique, required),
  username: String,
  avatar: String,
  citizen_name: String,
  place_of_birth: String,
  citizenship: String,
  biography: String,
  profile_url: String,
  onboarding_complete: Boolean (default false),
  org_id: ObjectId → Organization | null,
  is_freelancer: Boolean (default false),
  is_platform_owner: Boolean (default false),
  is_org_commander: Boolean (default false),
  total_rp: Number (default 0),
  rp_rank: Mixed | null,
  missions_completed: Number (default 0),
  current_mission_assignment: Mixed | null,
  created_at: Date (default now),
}
```

---

## Organization

```js
{
  name: String (unique, required),
  prefix: String (uppercase),
  invite_code: String (6 chars, unique, auto-generated),
  commander_id: ObjectId → User (required),
  member_count: Number (default 0),
  created_at: Date (default now),
}
```

---

## Ship

```js
{
  ship_name: String (uppercase),
  description: String (max 300),
  owner_id: ObjectId → User (required),
  org_id: ObjectId → Organization | null,
  type: String,
  prefix: String,
  is_mission: Boolean (default false),
  current_mission_id: ObjectId | null,
  crew_roles: Mixed,
  // Structure: { "Pilot": { slots: 1, filled: [userId, ...] }, ... }
  crew_fill_percentage: Number (default 0),
  missions_completed: Number (default 0),
  model_image_url: String | null,
  scorg_ship_id: Number | null,
  created_at: Date (default now),
}
```

---

## Mission

```js
{
  name: String (unique, required),
  mission_type: String,
  objectives: String,
  status: Enum ['WAITING FOR CREW', 'FINALIZED', 'IN PROGRESS', 'COMPLETE', 'ABORT'],
  created_by: ObjectId → User (required),
  org_id: ObjectId → Organization | null,
  is_public: Boolean (default true),
  primary_ship: ObjectId → Ship (required),
  supporting_ships: [ObjectId → Ship],
  mission_time: Date,
  start_time: Date | null,
  end_time: Date | null,
  queue_expires_at: Date,
  created_at: Date (default now),
}
```

---

## MissionArchive

Immutable snapshot created when a mission completes.

```js
{
  original_mission_id: ObjectId,
  name: String,
  mission_type: String,
  objectives: String,
  created_by: ObjectId → User,
  org_id: ObjectId → Organization | null,
  is_public: Boolean,
  primary_ship_snapshot: Mixed,      // full Ship document at time of completion
  supporting_ships_snapshot: [Mixed],
  mission_time: Date,
  start_time: Date,
  end_time: Date,
  completed_at: Date (default now),
  crew_snapshot: Mixed,              // { shipId: crew_roles_object }
  total_rp_awarded: Number (default 0),
}
```

---

## MissionLog

```js
{
  mission_id: ObjectId → Mission (required),
  user_id: ObjectId → User (required),
  log_text: String (required),
  timestamp: Date (default now),
}
```

---

## RPLedger

```js
{
  player_id: ObjectId → User (required),
  mission_id: ObjectId → Mission | null,
  ship_id: ObjectId → Ship | null,
  event_code: String (required),    // MISSION_LAUNCHED, POST_MISSION_LOG, CREW_SLOT_FILLED
  points: Number (required),
  applied_ts: Date (default now),
}
```

---

## ShipRPLedger

```js
{
  ship_id: ObjectId → Ship (required),
  mission_id: ObjectId → Mission (required),
  role: String,
  capacity_at_launch: Number,
  filled_at_launch: Number,
  fill_rate: Number,                 // 0-100
  points_awarded: Number,
  threshold_snapshot: Mixed,         // { threshold: 75 }
  awarded_ts: Date (default now),
}
```

---

## ShipModel

```js
{
  category: String (required),
  model_name: String (required),
  image_url: String,
  scorg_ship_id: Number | null,
  created_by: ObjectId → User,
  created_at: Date (default now),
}
```

---

## AISummary

```js
{
  summary_text: String (required),
  missions_count: Number,
  total_rp: Number,
  period_start: Date,
  period_end: Date,
  generated_at: Date (default now),
}
```
