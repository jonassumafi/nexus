# RP Ledger Integration Plan

This document outlines where to integrate the `rp_handler.py` functions into the existing mission workflow to automatically award RP points based on player and ship actions, as detailed in `mission_control_part_two.md`.

The `rp_handler.py` already contains the necessary functions to record RP events. This plan focuses on calling those functions from the correct locations within the mission lifecycle.

---

## 1. Mission Launch Event

### **A. Award Points to Mission Creator (+1 RP)**

-   **Trigger:** A mission is successfully launched.
-   **Action:** Award points to the user who created the mission.
-   **File to Modify:** `bot/cogs/mission/mission_view.py`
-   **Function to Modify:** `LaunchMissionView.MissionSelect.launch_mission`
-   **Integration Point:** After the mission status is successfully updated to `INPROGRESS`.

-   **Code to Add:**
    ```python
    # Get the RpHandler cog
    rp_handler_cog = self.bot.get_cog("RpHandler")
    if rp_handler_cog:
        # Award points to the mission creator
        await rp_handler_cog.add_rp_for_mission_launch(
            player_id=mission_doc["created_by"],
            mission_id=mission_doc["_id"]
        )
    ```

### **B. Award Ship Fill Bonus (+3 RP per qualifying ship)**

-   **Trigger:** A mission is successfully launched.
-   **Action:** For each participating ship, check if its crew fill rate meets the admin-defined threshold. If it does, award bonus points to the ship's record.
-   **File to Modify:** `bot/cogs/mission/mission_view.py`
-   **Function to Modify:** `LaunchMissionView.MissionSelect.launch_mission`
-   **Integration Point:** After determining the list of `valid_ships` that will be part of the mission.

-   **Code to Add:**
    ```python
    # Get the RpHandler cog
    rp_handler_cog = self.bot.get_cog("RpHandler")
    if rp_handler_cog:
        for ship in ships: # Iterate through the list of valid ships
            # Calculate capacity and filled slots for the current ship
            capacity_at_launch = 0
            filled_at_launch = 0
            for role_data in ship.get("crew_roles", {}).values():
                capacity_at_launch += role_data.get("slots", 0)
                filled_at_launch += len(role_data.get("filled", []))

            # Call the function to check and award the bonus
            await rp_handler_cog.award_ship_fill_bonus(
                ship_id=ship["_id"],
                mission_id=mission_doc["_id"],
                capacity_at_launch=capacity_at_launch,
                filled_at_launch=filled_at_launch,
                role="PRIMARY" if ship["_id"] == mission_doc["primary_ship"] else "SUPPORT"
            )
    ```

---

## 2. Crew Slot Filled Event (+2 RP)

-   **Trigger:** A player successfully reserves a crew slot on a mission ship.
-   **Action:** Award points to the player who filled the slot.
-   **File to Modify:** `bot/cogs/mission/mission_view.py`
-   **Function to Modify:** `CrewRoleButton.callback`
-   **Integration Point:** After the user's `current_mission_assignment` is successfully updated in the database, confirming their slot.

-   **Code to Add:**
    ```python
    # Inside the `if update_result.modified_count > 0:` block
    
    # Get the RpHandler cog
    rp_handler_cog = self.parent_view.bot.get_cog("RpHandler")
    if rp_handler_cog:
        await rp_handler_cog.add_rp_for_crew_slot_filled(
            player_id=self.user_id,
            mission_id=self.mission_id,
            ship_id=self.ship_id
        )
    ```

---

## 3. Mission Completed Event (+2 RP)

-   **Trigger:** A mission is successfully marked as complete.
-   **Action:** Award points to every player who participated in the mission.
-   **File to Modify:** `bot/cogs/mission/mission_commands.py`
-   **Function to Modify:** `MissionCommands.mission_complete`
-   **Integration Point:** Inside the loop that iterates over the `crew_ids` set, where their `missions_completed` count is already being incremented.

-   **Code to Add:**
    ```python
    # Inside the `for crew_id in crew_ids:` loop
    
    # Get the RpHandler cog
    rp_handler_cog = self.bot.get_cog("RpHandler")
    if rp_handler_cog:
        await rp_handler_cog.add_rp_for_mission_completed(
            player_id=crew_id,
            mission_id=mission["_id"]
        )
    ```

---

## 4. After-Action Log Submitted Event (+3 RP)

-   **Trigger:** A player submits a mission log.
-   **Action:** Award points to the player who submitted the log.
-   **File to Modify:** `bot/cogs/mission/mission_commands.py`
-   **Function to Modify:** `MissionCommands.submit_logs_to_db`
-   **Integration Point:** After the log is successfully inserted into the `log_collection`.

-   **Code to Add:**
    ```python
    # After the await self.log_collection.insert_one(...) call
    
    # Get the RpHandler cog
    rp_handler_cog = self.bot.get_cog("RpHandler")
    if rp_handler_cog:
        await rp_handler_cog.add_rp_for_aftermath_log(
            player_id=interaction.user.id,
            mission_id=ObjectId(mission_id_str)
        )
    ```
