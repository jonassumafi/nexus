
# Mission Control: Part Two Implementation Roadmap

This document outlines the step-by-step plan to implement the features detailed in `mission_control_part_two.md`.

## Phase 1: Database Setup and Core Models

The first phase focuses on establishing the database schema and creating the necessary models to interact with it.

1.  **Implement MongoDB Schema:**
    *   Create the following collections in your MongoDB database, following the schema in `mission_control_part_two.md`:
        *   `rp_settings`
            ```json
            {
              "_id": "SHIP_FILL_RULES",
              "points": {
                "MISSION_LAUNCHED": 1,
                "CREW_SLOT_FILLED": 2,
                "MISSION_COMPLETED": 2,
                "AFTERMATH_LOG": 3,
                "SHIP_FILL_BONUS": 3
              },
              "ship_fill_threshold": 75,
              "updated_by": "Snow (discordId)",
              "updated_at": "ISODate(\"2025-01-01T00:00:00Z\")",
              "reason": "Initial defaults"
            }
            ```
        *   `rp_ledger`
            ```json
            {
              "_id": "ObjectId(\"...\")",
              "player_id": "ObjectId(\"players/_id\")",
              "mission_id": "ObjectId(\"missions/_id\")",
              "event_code": "CREW_SLOT_FILLED",
              "points": 2,
              "applied_ts": "ISODate(\"2025-01-21T20:15:00Z\")",
              "meta": { "ship_id": "ObjectId(\"...\")" }
            }
            ```
        *   `ship_rp_ledger`
            ```json
            {
              "_id": "ObjectId(\"...\")",
              "ship_id": "ObjectId(\"ships/_id\")",
              "mission_id": "ObjectId(\"missions/_id\")",
              "role": "PRIMARY",
              "capacity_at_launch": 8,
              "filled_at_launch": 7,
              "fill_rate": 88,
              "points_awarded": 3,
              "awarded_ts": "ISODate(\"2025-01-21T20:15:00Z\")",
              "threshold_snapshot": 75
            }
            ```
        *   `players`
            ```json
            { "_id": "ObjectId(\"...\")", "discord_id": "123", "name": "sublimeswell", "created_at": "ISODate(\"...\")" }
            ```
        *   `ranks` (optional, but recommended)
            ```json
            { "_id": "ObjectId(\"...\")", "name": "Crewman", "emoji": "🔧", "min_rp": 75 }
            ```
        *   `missions`
            ```json
            { "_id": "ObjectId(\"...\")", "name": "Rust Veil", "start_ts": "ISODate(\"...\")", "completed": true }
            ```
        *   `mission_ships`
            ```json
            {
              "_id": "ObjectId(\"...\")",
              "mission_id": "ObjectId(\"...\")",
              "ship_id": "ObjectId(\"...\")",
              "role": "PRIMARY",
              "capacity_at_launch": 8,
              "filled_at_launch": 7
            }
            ```
    *   Ensure all specified indexes are created for efficient querying.


2.  **Create Pydantic Models (or similar):**
    *   In the `bot/core/models` directory, create Python classes that correspond to each of the MongoDB collections. This will help with data validation and consistency.

3.  **Database Connection:**
    *   Ensure the bot can successfully connect to the MongoDB database.

## Phase 2: Core Logic and RP Calculation

This phase involves implementing the core logic for calculating and tracking RP.

1.  **RP Event Functions:**
    *   Create functions to handle each of the RP-earning events:
        *   `add_rp_for_mission_launch(player_id, mission_id)`
        *   `add_rp_for_crew_slot_filled(player_id, mission_id, ship_id)`
        *   `add_rp_for_mission_completed(player_id, mission_id)`
        *   `add_rp_for_aftermath_log(player_id, mission_id)`
        *   `add_rp_for_ship_fill_bonus(ship_id, mission_id)`
    *   These functions should read the current RP values from the `rp_settings` collection and add new entries to the `rp_ledger` or `ship_rp_ledger` collections.

2.  **Data Aggregation Functions:**
    *   Create functions to compute the aggregated data required for the commands:
        *   `get_player_total_rp(player_id)`
        *   `get_player_rank(player_id)`
        *   `get_player_30_day_rp_change(player_id)`
        *   `get_ship_high_fill_success_rate(ship_id)`
        *   `get_ship_total_rp(ship_id)`
        *   `get_ship_mission_history(ship_id)`

## Phase 3: Command Implementation

This phase focuses on creating the user-facing and admin commands.

1.  **Player Commands:**
    *   Implement the `/character_list` command with pagination.
    *   Implement the `/mycharacter` command.

2.  **Ship Commands:**
    *   Implement the `/ship_rp` command with pagination for the list view.
    *   Implement the `/ship_rp ship:<name>` command for the detail view.

3.  **Admin Commands:**
    *   Create a new cog for admin commands.
    *   Implement the `/rp_points view` and `/rp_points set` commands.
    *   Implement the `/ship_fillrate view` and `/ship_fillrate set` commands.
    *   Ensure all admin commands are ephemeral and have the appropriate permission checks.

## Phase 4: Event-Based Announcements and Final Touches

This final phase involves implementing the real-time announcements and polishing the user experience.

1.  **Event Listeners:**
    *   Create event listeners that trigger on mission launch and after-action log submission.
    *   These listeners should call the appropriate RP-awarding functions and send announcement messages to the channel.

2.  **Embeds and Formatting:**
    *   Ensure all embeds match the style and formatting specified in `mission_control_part_two.md`.
    *   Pay close attention to the MS-DOS style and fixed-width fonts.

3.  **Testing and Debugging:**
    *   Thoroughly test all commands and features to ensure they are working as expected.
    *   Pay special attention to edge cases and error handling.

