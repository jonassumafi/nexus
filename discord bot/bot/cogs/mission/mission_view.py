import asyncio
import datetime
import logging

import discord
from bson.objectid import ObjectId
from discord import Interaction

from bot import UTC_TZ, TIMEZONE
from bot.core.constant import Db_Constant
from bot.core.mission_state import MissionState
from bot.core.models.buttonSchema import ButtonSchema
from bot.core.models.database_models import MissionCreate
from bot.core.response_messages import generate_mission_preview_text, _format_time_difference, \
    build_mission_launch_embed
from bot.utils.embeds import dos_style_embed_builder
from bot.utils.helepr import extract_flat_crew_list, delayed_send_messages
from motor.motor_asyncio import AsyncIOMotorCollection


class MissionCreationView(discord.ui.View):
    def __init__(
            self,
            author,
            bot,
            mission_name,
            mission_time,
            mission_status,
            objectives,
            mission_types,
            max_mission_ships,
            ship_prefix,
            thread
    ):
        super().__init__(timeout=300)  # 5 minutes timeout
        self.author = author
        self.bot = bot
        self.mission_name = mission_name
        self.primary_ship = None
        self.supporting_ships = []
        self.mission_type = None
        self.mission_time = mission_time
        self.mission_status = mission_status
        self.objectives = objectives
        self.mission_types = mission_types  # Store mission types
        self.max_mission_ships = max_mission_ships  # Store max mission ships
        self.ship_prefix = ship_prefix
        self.thread = thread
        self.update_buttons()

    def get_embed(self):
        embed = discord.Embed(
            title="Mission Creation",
            description=f"Mission '{self.mission_name}' is being created. Please select the primary and supporting ships.",
            color=discord.Color.blurple()
        )
        embed.add_field(name="Primary Ship",
                        value=f"{self.ship_prefix} {self.primary_ship["ship_name"]}" if self.primary_ship else "Not Selected",
                        inline=False)
        embed.add_field(name="Supporting Ships", value=", ".join(
            [f"{self.ship_prefix} {ship["ship_name"]}" for ship in
             self.supporting_ships]) if self.supporting_ships else "Not Selected",
                        inline=False)
        return embed

    def update_buttons(self):
        self.clear_items()
        self.add_item(self.PrimaryShipButton(self))
        self.add_item(self.SupportingShipButton(self))
        self.add_item(self.NextButton(self))
        self.add_item(self.CancelButton(self))
        self.add_item(self.MissionTypeSelect(self, self.mission_types))

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user != self.author:
            await interaction.response.send_message("You are not authorized to interact with this.", ephemeral=True)
            return False
        return True

    class PrimaryShipButton(discord.ui.Button):
        def __init__(self, parent_view):
            super().__init__(label="Primary Ship", style=discord.ButtonStyle.primary)
            self.parent_view = parent_view

        async def callback(self, interaction: discord.Interaction):
            ship_selection_view = ShipSelectionView(self.parent_view, "primary", self.parent_view.ship_prefix)
            await ship_selection_view.load_ships()
            await interaction.response.edit_message(embed=ship_selection_view.get_embed(), view=ship_selection_view)

    class SupportingShipButton(discord.ui.Button):
        def __init__(self, parent_view):
            super().__init__(label="Supporting Ship", style=discord.ButtonStyle.secondary)
            self.parent_view = parent_view

        async def callback(self, interaction: discord.Interaction):
            ship_selection_view = ShipSelectionView(self.parent_view, "supporting", self.parent_view.ship_prefix)
            await ship_selection_view.load_ships()
            await interaction.response.edit_message(embed=ship_selection_view.get_embed(), view=ship_selection_view)

    class CancelButton(discord.ui.Button):
        def __init__(self, parent_view):
            super().__init__(label="Cancel", style=discord.ButtonStyle.danger)
            self.parent_view = parent_view

        async def callback(self, interaction: discord.Interaction):
            await interaction.response.edit_message(content="Mission creation cancelled.", embed=None, view=None)
            await self.parent_view.thread.delete()
            self.parent_view.stop()

    class NextButton(discord.ui.Button):
        def __init__(self, parent_view):
            super().__init__(label="Next", style=discord.ButtonStyle.success)
            self.parent_view = parent_view

        async def callback(self, interaction: discord.Interaction):
            try:
                if not self.parent_view.primary_ship:
                    await interaction.response.send_message("Please select a primary ship.", ephemeral=True)
                    return
                if not self.parent_view.mission_type:
                    await interaction.response.send_message("Please select a mission type.", ephemeral=True)
                    return

                total_ships_selected = 0
                if self.parent_view.primary_ship:
                    total_ships_selected += 1
                total_ships_selected += len(self.parent_view.supporting_ships)

                if total_ships_selected > self.parent_view.max_mission_ships:
                    await interaction.response.send_message(
                        f"You have selected {total_ships_selected} ships, but the maximum allowed is {self.parent_view.max_mission_ships}. Please adjust your selection.",
                        ephemeral=True
                    )
                    return
                # Generate the MS-DOS style preview text
                guild_config = await self.parent_view.bot.db[Db_Constant.GUILD_CONFIG_COLLECTION].find_one(
                    {"guild_id": self.parent_view.author.guild.id})
                preview_text = generate_mission_preview_text(
                    mission_name=self.parent_view.mission_name,
                    mission_type=self.parent_view.mission_type,
                    mission_state=self.parent_view.mission_status,
                    mission_time=self.parent_view.mission_time.strftime("%Y-%m-%d %H:%M"),
                    primary_ship=self.parent_view.primary_ship,
                    supporting_ships=self.parent_view.supporting_ships,
                    guild_config=guild_config,
                    objectives=self.parent_view.objectives,
                    ship_prefix=guild_config["ship_prefix"] if guild_config else "HCS"
                )

                # Create the MS-DOS style embed
                preview_embed = dos_style_embed_builder(
                    title=" ",
                    reason_block=preview_text,
                    color=discord.Color.green(),
                    footer_text=_format_time_difference(self.parent_view.mission_time.strftime("%Y-%m-%d %H:%M"))
                )

                self.parent_view.clear_items()
                self.parent_view.add_item(self.parent_view.ConfirmButton(self.parent_view))
                self.parent_view.add_item(self.parent_view.BackButton(self.parent_view))
                await interaction.response.edit_message(embed=preview_embed, view=self.parent_view)
            except Exception as e:
                print(f"Error in NextButton callback: {e}")
                await interaction.response.send_message(
                    "An unexpected error occurred. Please try again or contact support.", ephemeral=True)

    class ConfirmButton(discord.ui.Button):
        def __init__(self, parent_view):
            super().__init__(label="Confirm", style=discord.ButtonStyle.success)
            self.parent_view = parent_view

        async def callback(self, interaction: discord.Interaction):
            await interaction.response.defer()  # Defer the interaction immediately
            try:
                # Calculate queue expiration (30 minutes from now)
                queue_expires_at = datetime.datetime.now(UTC_TZ) + datetime.timedelta(minutes=30)
                
                # Use Pydantic model for validation
                mission = MissionCreate(
                    name=self.parent_view.mission_name,
                    primary_ship=self.parent_view.primary_ship["_id"],
                    supporting_ships=[ship["_id"] for ship in self.parent_view.supporting_ships],
                    status=MissionState.WAITING.value,
                    created_at=datetime.datetime.now(UTC_TZ),
                    mission_type=self.parent_view.mission_type,
                    created_by=interaction.user.id,
                    mission_time=self.parent_view.mission_time,
                    objectives=self.parent_view.objectives,
                    guild_id=interaction.guild.id,
                    queue_expires_at=queue_expires_at,
                    thread_id=self.parent_view.thread.id,
                    thread_channel_id=self.parent_view.thread.parent_id,
                )
                
                # Insert validated mission data
                result = await self.parent_view.bot.db[Db_Constant.MISSION].insert_one(mission.to_mongo_dict())

                ship_ids = [self.parent_view.primary_ship["_id"]] + [ship["_id"] for ship in
                                                                     self.parent_view.supporting_ships]
                await self.parent_view.bot.db[Db_Constant.SHIP].update_many({"_id": {"$in": ship_ids}}, {
                    "$set": {"is_mission": True, "current_mission_id": result.inserted_id}})

                # Get mission channel for the message
                guild_config = await self.parent_view.bot.db[Db_Constant.GUILD_CONFIG_COLLECTION].find_one(
                    {"guild_id": interaction.guild.id}
                )
                mission_channel_id = guild_config.get("mission_channel") if guild_config else None
                channel_mention = f"<#{mission_channel_id}>" if mission_channel_id else "the configured channel"
                
                # Create Discord timestamp for countdown (expires_at in Unix)
                expires_unix = int(queue_expires_at.timestamp())
                countdown_display = f"<t:{expires_unix}:R>"  # Relative time (e.g., "in 30 minutes")
                countdown_exact = f"<t:{expires_unix}:T>"    # Exact time

                await interaction.followup.edit_message(
                    message_id=interaction.message.id,
                    content=(
                        f"✅ **Mission created!**\n\n"
                        f"⏰ **Queue expires:** {countdown_display} ({countdown_exact})\n"
                        f"📋 Use `/finalize` to post it for crew sign-ups.\n"
                        f"📢 Missions will be announced in {channel_mention}.\n\n"
                        f"⚠️ *This thread will remain open until you finalize or the queue expires.*"
                    ),
                    embed=None,
                    view=None
                )

                try:
                    ship_cog = self.parent_view.bot.get_cog("ShipCommands")
                    await ship_cog.update_crew_fill_percentage()
                except Exception as e:
                    logging.error(f"Failed to update crew fill from mission view confirm button: {e}")

                # Don't delete the thread - it will be deleted by:
                # 1. The /finalize command (on success)
                # 2. The clear_queue_expired_missions job (on expiry)
                self.parent_view.stop()
            except Exception as e:
                print(f"Error in ConfirmButton callback: {e}")
                await interaction.followup.send(
                    content="An error occurred while creating the mission. Please try again.", ephemeral=True)

    class BackButton(discord.ui.Button):
        def __init__(self, parent_view):
            super().__init__(label="Back", style=discord.ButtonStyle.danger)
            self.parent_view = parent_view

        async def callback(self, interaction: discord.Interaction):
            self.parent_view.update_buttons()
            await interaction.response.edit_message(embed=self.parent_view.get_embed(), view=self.parent_view)

    class MissionTypeSelect(discord.ui.Select):
        def __init__(self, parent_view, mission_types):
            options = []
            if mission_types:
                for mt in mission_types:
                    desc = mt.get("description", "")
                    if len(desc) > 100:
                        desc = desc[:97] + "..."
                    options.append(discord.SelectOption(
                        label=mt["name"],
                        description=desc,
                        emoji=mt.get("emoji") or None
                    ))

            if not options:
                options.append(
                    discord.SelectOption(
                        label="No Mission Types Configured",
                        description="Use /addmissiontype to add types.",
                        emoji="⚠️",
                        default=True
                    )
                )
                self.disabled = True  # Disable the select if no types are configured

            super().__init__(placeholder="Select Mission Type", options=options, row=4)
            self.parent_view = parent_view

        async def callback(self, interaction: discord.Interaction):
            if self.disabled:  # Prevent interaction if no types are configured
                await interaction.response.send_message("No mission types are configured for this guild.",
                                                        ephemeral=True)
                return

            self.parent_view.mission_type = self.values[0]
            await interaction.response.send_message(
                f"Mission Type set to **{self.values[0]}**. Please click **Next** to continue.", ephemeral=True)
            await interaction.message.edit(embed=self.parent_view.get_embed(), view=self.parent_view)


class ShipSelectionView(discord.ui.View):
    def __init__(self, parent_view, ship_type, ship_prefix):
        super().__init__(timeout=None)
        self.parent_view = parent_view
        self.ship_type = ship_type
        self.ships = []
        self.crew_roles_data = []
        self.current_page = 0
        self.page_size = 4
        self.ship_prefix = ship_prefix

    async def load_ships(self):
        # Start with ships not currently on a mission and with slots > 0
        query = {"$or": [{"is_mission": {"$exists": False}}, {"is_mission": False}]}

        # Get all ships that meet the basic criteria
        all_available_ships = await self.parent_view.bot.db[Db_Constant.SHIP].find(query).to_list(length=None)

        filtered_ships = []
        for ship in all_available_ships:
            total_slots = 0
            if "crew_roles" in ship and ship["crew_roles"]:
                for role_data in ship["crew_roles"].values():
                    total_slots += role_data.get("slots", 0)

            if total_slots > 0:
                # Check for duplication based on ship_type
                if self.ship_type == "primary":
                    # If selecting primary, exclude ships already in supporting_ships
                    if ship not in self.parent_view.supporting_ships:
                        filtered_ships.append(ship)
                elif self.ship_type == "supporting":
                    # If selecting supporting, exclude the primary ship
                    if self.parent_view.primary_ship and ship["_id"] == self.parent_view.primary_ship["_id"]:
                        continue  # Skip this ship, it's the primary
                    filtered_ships.append(ship)
                else:  # Should not happen, but as a fallback
                    filtered_ships.append(ship)

        self.ships = filtered_ships
        self.crew_roles_data = await self.parent_view.bot.db[Db_Constant.GUILD_CONFIG_COLLECTION].find_one(
            {"guild_id": self.parent_view.author.guild.id})
        self.update_view()

    def get_embed(self):
        embed = discord.Embed(title=f"Select a {self.ship_type.capitalize()} Ship", color=discord.Color.blue())
        start_index = self.current_page * self.page_size
        end_index = start_index + self.page_size
        ships_on_page = self.ships[start_index:end_index]

        if not ships_on_page:
            embed.description = "No ships found on this page or all ships are currently on a mission."

        for ship in ships_on_page:
            crew_info = ""
            total_slots = 0
            if "crew_roles" in ship and ship["crew_roles"]:
                for role_name, role_data in ship["crew_roles"].items():
                    slots = role_data.get("slots", 0)
                    total_slots += slots
                    emoji = ""
                    if self.crew_roles_data and "crew_roles" in self.crew_roles_data:
                        for crew_role_entry in self.crew_roles_data["crew_roles"]:
                            if crew_role_entry["name"] == role_name:
                                emoji = crew_role_entry.get("emoji", "")
                                break
                    crew_info += f"{emoji} {role_name}: {slots}\n"
            else:
                crew_info = "No crew roles defined."

            embed.add_field(name=f"{self.ship_prefix} {ship["ship_name"]}",
                            value=f"Type: {ship.get('type', 'N/A')}\nDescription: {ship.get('description', 'N/A')}\nTotal Crew Slots: {total_slots}\n{crew_info}",
                            inline=False)

        return embed

    def update_view(self):
        self.clear_items()

        start_index = self.current_page * self.page_size
        end_index = start_index + self.page_size
        ships_on_page = self.ships[start_index:end_index]

        for ship in ships_on_page:
            # Disable primary ship if selecting supporting ship
            is_disabled = False
            if self.ship_type == "supporting" and self.parent_view.primary_ship and ship["_id"] == \
                    self.parent_view.primary_ship["_id"]:
                is_disabled = True
            self.add_item(self.ShipButton(ship, self, row=0, disabled=is_disabled))

        self.add_item(self.PrevPageButton(self, row=1))
        self.add_item(self.NextPageButton(self, row=1))
        self.add_item(self.BackButton(self.parent_view, row=1))

    def get_total_pages(self):
        return (len(self.ships) + self.page_size - 1) // self.page_size

    class ShipButton(discord.ui.Button):
        def __init__(self, ship, parent_view, row, disabled=False):
            super().__init__(label=f"{parent_view.ship_prefix} {ship["ship_name"]}", style=discord.ButtonStyle.primary,
                             row=row, disabled=disabled)
            self.ship = ship
            self.parent_view = parent_view

        async def callback(self, interaction: discord.Interaction):
            if self.parent_view.ship_type == "primary":
                self.parent_view.parent_view.primary_ship = self.ship
            else:  # This is for supporting ships
                # Check if the ship is already in the supporting_ships list
                found_index = -1
                for i, s_ship in enumerate(self.parent_view.parent_view.supporting_ships):
                    if s_ship["_id"] == self.ship["_id"]:
                        found_index = i
                        break

                if found_index != -1:
                    # If found, remove it (toggle off)
                    self.parent_view.parent_view.supporting_ships.pop(found_index)
                else:
                    # If not found, add it (toggle on)
                    self.parent_view.parent_view.supporting_ships.append(self.ship)

            self.parent_view.parent_view.update_buttons()
            await interaction.response.edit_message(embed=self.parent_view.parent_view.get_embed(),
                                                    view=self.parent_view.parent_view)

    class PrevPageButton(discord.ui.Button):
        def __init__(self, parent_view, row):
            super().__init__(label="<<", style=discord.ButtonStyle.secondary, row=row)
            self.parent_view = parent_view
            if self.parent_view.current_page == 0:
                self.disabled = True

        async def callback(self, interaction: discord.Interaction):
            self.parent_view.current_page -= 1
            self.parent_view.update_view()
            await interaction.response.edit_message(embed=self.parent_view.get_embed(), view=self.parent_view)

    class NextPageButton(discord.ui.Button):
        def __init__(self, parent_view, row):
            super().__init__(label=">>", style=discord.ButtonStyle.secondary, row=row)
            self.parent_view = parent_view
            if self.parent_view.current_page >= self.parent_view.get_total_pages() - 1:
                self.disabled = True

        async def callback(self, interaction: discord.Interaction):
            self.parent_view.current_page += 1
            self.parent_view.update_view()
            await interaction.response.edit_message(embed=self.parent_view.get_embed(), view=self.parent_view)

    class BackButton(discord.ui.Button):
        def __init__(self, parent_view, row):
            super().__init__(label="Back", style=discord.ButtonStyle.danger, row=row)
            self.parent_view = parent_view

        async def callback(self, interaction: discord.Interaction):
            self.parent_view.update_buttons()
            await interaction.response.edit_message(embed=self.parent_view.get_embed(), view=self.parent_view)


class MissionFinalizeView(discord.ui.View):
    def __init__(self, bot, mission_data, primary_ship_data, supporting_ships_data, crew_roles_data, ship_prefix):
        super().__init__(timeout=None)  # Persistent view
        self.bot = bot
        self.mission_data = mission_data
        self.primary_ship_data = primary_ship_data
        self.supporting_ships_data = supporting_ships_data
        self.crew_roles_data = crew_roles_data  # Guild's crew roles config
        self.ship_prefix = ship_prefix

        self.message = None  # To store the message object for updating

        self.add_ship_buttons()

    def set_message(self, message: discord.Message):
        self.message = message

    async def update_main_embed(self):
        if not self.message:
            print("Warning: MissionFinalizeView message not set. Cannot update embed.")
            return

        new_embed = await self.get_embed()
        await self.message.edit(embed=new_embed, view=self)

    async def refresh_crew_fill(self):
        try:
            ship_cog = self.bot.get_cog("ShipCommands")
            await ship_cog.update_crew_fill_percentage()
        except Exception as e:
            logging.error(f"Failed to update crew fill from mission view confirm button: {e}")

    def add_ship_buttons(self):
        self.clear_items()
        # Add primary ship button
        self.add_item(ShipFinalizeButton(self.primary_ship_data, self.mission_data['_id'], self))
        # Add supporting ship buttons
        for ship in self.supporting_ships_data:
            self.add_item(ShipFinalizeButton(ship, self.mission_data['_id'], self))
        self.add_item(self.WithdrawButton(self))
        self.add_item(self.RefreshButton(self))  # Add the refresh button

    async def refresh_data(self):
        # Re-fetch mission data
        self.mission_data = await self.bot.db[Db_Constant.MISSION].find_one({"_id": self.mission_data["_id"]})
        # Re-fetch primary ship data
        self.primary_ship_data = await self.bot.db[Db_Constant.SHIP].find_one(
            {"_id": self.mission_data["primary_ship"]})
        # Re-fetch supporting ships data
        supporting_ships_data = []
        for ship_id in self.mission_data["supporting_ships"]:
            s_ship = await self.bot.db[Db_Constant.SHIP].find_one({"_id": ship_id})
            if s_ship:
                supporting_ships_data.append(s_ship)
        self.supporting_ships_data = supporting_ships_data

        # Re-fetch crew roles data
        self.crew_roles_data = await self.bot.db[Db_Constant.GUILD_CONFIG_COLLECTION].find_one(
            {"guild_id": self.message.guild.id})

        # Update the buttons and the embed
        self.add_ship_buttons()
        await self.update_main_embed()

    class WithdrawButton(discord.ui.Button):
        def __init__(self, parent_view):
            mission_id = str(parent_view.mission_data["_id"])
            super().__init__(label="Withdraw", style=discord.ButtonStyle.danger, custom_id=f"withdraw_{mission_id}")
            self.parent_view = parent_view

        async def callback(self, interaction: discord.Interaction):
            await interaction.response.defer(ephemeral=True)
            user_id = interaction.user.id

            user_doc = await self.parent_view.bot.db[Db_Constant.USER].find_one({"_id": user_id})

            if not user_doc or not user_doc.get("current_mission_assignment") or user_doc["current_mission_assignment"][
                "mission_id"] != ObjectId(self.parent_view.mission_data["_id"]):
                await interaction.followup.send("You are not part of this mission's crew. Join a crew first.",
                                                ephemeral=True)
                return

            assignment = user_doc["current_mission_assignment"]
            ship_id = assignment["ship_id"]
            role_name = assignment["role_name"]

            ship_data = await self.parent_view.bot.db[Db_Constant.SHIP].find_one({"_id": ship_id})

            # Remove user from the ship's crew
            update_result = await self.parent_view.bot.db[Db_Constant.SHIP].update_one(
                {"_id": ship_id},
                {"$pull": {f"crew_roles.{role_name}.filled": user_id}}
            )

            if update_result.modified_count > 0:
                # Remove user's mission assignment
                await self.parent_view.bot.db[Db_Constant.USER].update_one(
                    {"_id": user_id},
                    {"$unset": {"current_mission_assignment": ""}}
                )

                await interaction.followup.send("You have successfully withdrawn from the mission.", ephemeral=True)

                # Run refresh and announcement in the background
                self.parent_view.bot.loop.create_task(
                    self._perform_withdrawal_updates(user_id, role_name, ship_data, self.parent_view.message,
                                                     interaction))

                await self.parent_view.refresh_crew_fill()

        async def _perform_withdrawal_updates(self, user_id, role_name, ship_data, message: discord.Message,
                                              interaction):
            await self.parent_view.refresh_data()
            guild_config = await self.parent_view.bot.db[Db_Constant.GUILD_CONFIG_COLLECTION].find_one(
                {"guild_id": self.parent_view.message.guild.id})
            if guild_config and "mission_channel" in guild_config:
                mission_channel = self.parent_view.bot.get_channel(guild_config["mission_channel"])
                if mission_channel:
                    announcement_message = f"<@{user_id}> has withdrawn their {role_name} slot reservation aboard {self.parent_view.ship_prefix} {ship_data['ship_name']}."
                    await mission_channel.send(announcement_message)
            else:
                await interaction.followup.send("Could not withdraw you from the mission. Please try again.",
                                                ephemeral=True)

    class RefreshButton(discord.ui.Button):
        def __init__(self, parent_view):
            mission_id = str(parent_view.mission_data["_id"])
            super().__init__(label="Refresh", style=discord.ButtonStyle.secondary, custom_id=f"refresh_{mission_id}")
            self.parent_view = parent_view

        async def callback(self, interaction: discord.Interaction):
            await interaction.response.defer()
            await self.parent_view.refresh_data()
            await interaction.followup.send("Mission data refreshed!", ephemeral=True)
            await self.parent_view.refresh_crew_fill()

    async def get_embed(self) -> discord.Embed:
        # This method will generate the main mission embed
        # It needs to fetch the latest ship data to show current crew fill status
        # This will be called by the /finalize command and also when crew slots are booked

        # Re-fetch latest ship data to ensure accurate crew status
        primary_ship_latest = self.primary_ship_data
        if self.primary_ship_data['_id'] != 'MISSING':
            primary_ship_latest = await self.bot.db[Db_Constant.SHIP].find_one({"_id": self.primary_ship_data["_id"]})

        supporting_ships_latest = []
        for ship_data in self.supporting_ships_data:
            if ship_data['_id'] != 'MISSING':
                s_ship = await self.bot.db[Db_Constant.SHIP].find_one({"_id": ship_data["_id"]})
                if s_ship:
                    supporting_ships_latest.append(s_ship)
            else:
                supporting_ships_latest.append(ship_data)

        # Generate the MS-DOS style preview text (similar to newmission preview)
        preview_text = generate_mission_preview_text(
            mission_name=self.mission_data["name"],
            mission_type=self.mission_data["mission_type"],
            mission_time=f"{self.mission_data["mission_time"].strftime("%Y-%m-%d %H:%M")}",  # Pass as string
            mission_state=self.mission_data["status"],
            primary_ship=primary_ship_latest,
            supporting_ships=supporting_ships_latest,
            guild_config=self.crew_roles_data,
            objectives=self.mission_data["objectives"],
            ship_prefix=self.ship_prefix
        )
        
        # Get mission time for timestamp
        mission_time = self.mission_data["mission_time"]
        mission_timestamp = int(mission_time.timestamp())

        embed = dos_style_embed_builder(
            title="MISSION BRIEFING",
            reason_block=preview_text,
            color=discord.Color.green(),
            footer_text=f"Mission Time: {mission_time.strftime('%B %d, %Y at %I:%M %p')} UTC"
        )
        
        # Add sign-up message as a separate field (outside ANSI block so timestamps render)
        embed.add_field(
            name="",
            value=f"_This mission will remain open for sign-up until_ <t:{mission_timestamp}:f>",
            inline=False
        )
        
        return embed

    async def on_error(self, interaction: discord.Interaction, error: Exception, item: discord.ui.Item) -> None:
        print(f"Error in MissionFinalizeView: {error}")
        await interaction.followup.send("An unexpected error occurred in the mission view.", ephemeral=True)


class ShipFinalizeButton(discord.ui.Button):
    def __init__(self, ship_data, mission_id, parent_view):
        super().__init__(label=f"{parent_view.ship_prefix} {ship_data["ship_name"]}",
                         style=discord.ButtonStyle.primary, custom_id=f"ship_finalize_{ship_data['_id']}")
        self.ship_data = ship_data
        self.mission_id = mission_id
        self.parent_view = parent_view  # Reference to MissionFinalizeView

    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)  # Defer ephemeral response

        # Create and send the CrewSelectionView
        crew_selection_view = CrewSelectionView(
            bot=self.parent_view.bot,
            ship_data=self.ship_data,
            mission_id=self.mission_id,
            user_id=interaction.user.id,
            crew_roles_data=self.parent_view.crew_roles_data,
            main_finalize_view=self.parent_view  # Pass the MissionFinalizeView instance
        )
        embed = await crew_selection_view.get_embed()
        message = await interaction.followup.send(embed=embed, view=crew_selection_view, ephemeral=True)
        crew_selection_view.set_message(message)
        await self.parent_view.refresh_crew_fill()


class CrewSelectionView(discord.ui.View):
    def __init__(self, bot, ship_data, mission_id, user_id, crew_roles_data, main_finalize_view,
                 message: discord.Message = None):
        super().__init__(timeout=None)  # Persistent view
        self.message = message  # Store the message object
        self.bot = bot
        self.ship_data = ship_data
        self.mission_id = mission_id
        self.user_id = user_id
        self.crew_roles_data = crew_roles_data  # Guild's crew roles config
        self.main_finalize_view = main_finalize_view  # Reference to the main MissionFinalizeView

        self.add_crew_role_buttons()

    def set_message(self, message: discord.Message):
        self.message = message

    def add_crew_role_buttons(self):
        self.clear_items()
        if "crew_roles" in self.ship_data and self.ship_data["crew_roles"]:
            for role_name, role_info in self.ship_data["crew_roles"].items():
                slots = role_info.get("slots", 0)
                filled_by = role_info.get("filled", [])

                # Check if the user has already filled a slot in this role
                user_has_slot_in_this_role = self.user_id in filled_by

                # Check if the role is full
                is_full = len(filled_by) >= slots

                # Get emoji for the role
                emoji = ""
                if self.crew_roles_data and "crew_roles" in self.crew_roles_data:
                    for crew_role_entry in self.crew_roles_data["crew_roles"]:
                        if crew_role_entry["name"] == role_name:
                            emoji = crew_role_entry.get("emoji", "")
                            break

                button_label = f"{emoji} {role_name} ({len(filled_by)}/{slots})"
                button_style = discord.ButtonStyle.success if not is_full and not user_has_slot_in_this_role else discord.ButtonStyle.red

                # Disable if full and user has NOT claimed this slot
                disabled = is_full and not user_has_slot_in_this_role

                self.add_item(
                    CrewRoleButton(role_name, self.ship_data["_id"], self.mission_id, self.user_id, self, disabled,
                                   button_label, button_style, self.main_finalize_view))
        else:
            # No crew roles defined for this ship
            self.add_item(
                discord.ui.Button(label="No crew roles defined for this ship.", style=discord.ButtonStyle.gray,
                                  disabled=True))

    async def get_embed(self) -> discord.Embed:
        # Re-fetch latest ship data to ensure accurate crew status
        latest_ship_data = await self.bot.db[Db_Constant.SHIP].find_one({"_id": self.ship_data["_id"]})
        if not latest_ship_data:
            return discord.Embed(title="Error", description="Ship data not found.", color=discord.Color.red())

        self.ship_data = latest_ship_data  # Update internal ship_data

        embed = discord.Embed(
            title=f"Crew Selection for {self.main_finalize_view.ship_prefix} {self.ship_data['ship_name']}",
            description=f"Select a role to book a slot. Current status:",
            color=discord.Color.blue()
        )

        crew_info = ""
        total_slots = 0
        filled_slots = 0

        if "crew_roles" in self.ship_data and self.ship_data["crew_roles"]:
            for role_name, role_info in self.ship_data["crew_roles"].items():
                slots = role_info.get("slots", 0)
                filled_by = role_info.get("filled", [])
                total_slots += slots
                filled_slots += len(filled_by)

                emoji = ""
                if self.crew_roles_data and "crew_roles" in self.crew_roles_data:
                    for crew_role_entry in self.crew_roles_data["crew_roles"]:
                        if crew_role_entry["name"] == role_name:
                            emoji = crew_role_entry.get("emoji", "")
                            break

                crew_info += f"{emoji} {role_name}: {len(filled_by)}/{slots} {'(Reserve)' if self.user_id in filled_by else ''}\n"
        else:
            crew_info = "No crew roles defined."

        embed.add_field(name="Crew Status", value=crew_info, inline=False)
        embed.set_footer(text=f"Total Crew: {filled_slots}/{total_slots}")
        return embed

    async def on_timeout(self):
        # Disable all buttons on timeout
        for item in self.children:
            item.disabled = True


class CrewRoleButton(discord.ui.Button):
    def __init__(self, role_name, ship_id, mission_id, user_id, parent_view, disabled, label, style,
                 main_finalize_view):
        super().__init__(label=label, style=style, disabled=disabled, custom_id=f"crew_role_{ship_id}_{role_name}")
        self.role_name = role_name
        self.ship_id = ship_id
        self.mission_id = mission_id
        self.user_id = user_id
        self.parent_view = parent_view  # Reference to CrewSelectionView
        self.main_finalize_view = main_finalize_view  # Reference to the main MissionFinalizeView

    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)  # Defer ephemeral response

        # Check if user already has a slot in ANY ship for this mission
        # This requires iterating through all ships in the mission and checking their filled slots
        mission_doc = await self.parent_view.bot.db[Db_Constant.MISSION].find_one({"_id": self.mission_id})
        if not mission_doc:
            await interaction.followup.send("Mission not found.", ephemeral=True)
            return

        # Check user's current assignment across all missions
        user_doc = await self.parent_view.bot.db[Db_Constant.USER].find_one({"_id": self.user_id})

        if user_doc and user_doc.get("current_mission_assignment"):
            assigned_mission_id = user_doc["current_mission_assignment"]["mission_id"]
            print(f"DEBUG: Assigned Mission ID from user_doc: {assigned_mission_id}")
            if assigned_mission_id != self.mission_id:

                # Fetch the name of the mission and ship the user is currently assigned to
                assigned_mission_doc = await self.parent_view.bot.db[Db_Constant.MISSION].find_one(
                    {"_id": assigned_mission_id})
                assigned_ship_doc = await self.parent_view.bot.db[Db_Constant.SHIP].find_one(
                    {"_id": user_doc["current_mission_assignment"]["ship_id"]})

                assigned_mission_name = assigned_mission_doc["name"] if assigned_mission_doc else "Unknown Mission"
                assigned_ship_name = f"{self.main_finalize_view.ship_prefix} {assigned_ship_doc["ship_name"]}" if assigned_ship_doc else "Unknown Ship"

                await interaction.followup.send(
                    f"You are already assigned to mission **{assigned_mission_name}** on ship **{assigned_ship_name}**. You can only be in one mission at a time.",
                    ephemeral=True)
                return
            else:
                # User is assigned to this mission, but let's double check if they are trying to book another slot on this mission
                # This part of the logic is already handled by the existing `user_already_booked_any_slot` check below.
                pass

        all_ship_ids_in_mission = [mission_doc["primary_ship"]] + mission_doc["supporting_ships"]

        user_already_booked_any_slot = False
        for s_id in all_ship_ids_in_mission:
            ship_doc = await self.parent_view.bot.db[Db_Constant.SHIP].find_one({"_id": s_id})
            if ship_doc and "crew_roles" in ship_doc:
                for role_info in ship_doc["crew_roles"].values():
                    if self.user_id in role_info.get("filled", []):
                        user_already_booked_any_slot = True
                        break
            if user_already_booked_any_slot:
                break

        if user_already_booked_any_slot:
            await interaction.followup.send(
                "You have already reverse a crew slot for this mission. You can only book one slot per mission.",
                ephemeral=True)
            return

        # Attempt to book the slot
        ship_doc = await self.parent_view.bot.db[Db_Constant.SHIP].find_one({"_id": self.ship_id})
        if not ship_doc or self.role_name not in ship_doc.get("crew_roles", {}):
            await interaction.followup.send("Crew role not found on this ship.", ephemeral=True)
            return

        role_info = ship_doc["crew_roles"][self.role_name]
        slots = role_info.get("slots", 0)
        filled_by = role_info.get("filled", [])

        if len(filled_by) >= slots:
            await interaction.followup.send("This crew slot is already full.", ephemeral=True)
            return

        if self.user_id in filled_by:  # Double check in case of race condition
            await interaction.followup.send("You have already booked this specific slot.", ephemeral=True)
            return

        # Book the slot
        filled_by.append(self.user_id)
        update_result = await self.parent_view.bot.db[Db_Constant.SHIP].update_one(
            {"_id": self.ship_id},
            {"$set": {f"crew_roles.{self.role_name}.filled": filled_by}}
        )

        if update_result.modified_count > 0:
            # Update user's current mission assignment
            await self.parent_view.bot.db[Db_Constant.USER].update_one(
                {"_id": self.user_id},
                {"$set": {
                    "current_mission_assignment": {
                        "mission_id": self.mission_id,
                        "ship_id": self.ship_id,
                        "role_name": self.role_name
                    }
                }},
                upsert=True
            )

            await interaction.followup.send(
                f"You have successfully reserve the {self.role_name} slot on {self.main_finalize_view.ship_prefix} {ship_doc['ship_name']}!",
                ephemeral=True)

            # Run announcement and embed updates in the background
            self.parent_view.bot.loop.create_task(
                self._perform_booking_updates(ship_doc, self.parent_view.message, interaction))

        else:
            await interaction.followup.send("Failed to book the slot. Please try again.", ephemeral=True)

    async def _perform_booking_updates(self, ship_doc: dict, message: discord.Message, interaction):
        # Send announcement to fleet channel
        guild_config = await self.parent_view.bot.db[Db_Constant.GUILD_CONFIG_COLLECTION].find_one(
            {"guild_id": interaction.guild.id})
        if guild_config and "mission_channel" in guild_config:
            mission_channel = self.parent_view.bot.get_channel(guild_config["mission_channel"])
            if mission_channel:
                announcement_message = f"<@{self.user_id}> has reserved a {self.role_name} slot aboard {self.main_finalize_view.ship_prefix} {ship_doc['ship_name']}."
                await mission_channel.send(announcement_message)

            # Update the CrewSelectionView embed and buttons
            new_crew_embed = await self.parent_view.get_embed()
            self.parent_view.add_crew_role_buttons()  # Re-add buttons to update their state
            if message:
                try:
                    await message.edit(embed=new_crew_embed, view=self.parent_view)
                except discord.errors.NotFound:
                    print(
                        "Warning: Could not find the ephemeral message to edit. It might have been dismissed by the user.")
                    return  # Exit if message is not found
                except Exception as e:
                    print(f"An unexpected error occurred while editing the ephemeral message: {e}")
                    return  # Exit on other exceptions
            else:
                print("Warning: message is None. Cannot edit ephemeral message.")
                return  # Exit if message is None

            # Trigger update of the main MissionFinalizeView embed
            await self.main_finalize_view.update_main_embed()

        else:
            await interaction.followup.send("Failed to reserve the slot. Please try again.", ephemeral=True)


class EditMissionTypeView(discord.ui.View):
    def __init__(self, bot, mission_types):
        super().__init__()
        self.bot = bot
        self.mission_types = mission_types
        self.add_item(self.MissionTypeSelect(self.bot, self.mission_types))

    class MissionTypeSelect(discord.ui.Select):
        def __init__(self, bot, mission_types):
            self.bot = bot
            options = []
            for mt in mission_types:
                desc = mt.get("description", "")
                if len(desc) > 100:
                    desc = desc[:97] + "..."
                options.append(discord.SelectOption(
                    label=mt["name"],
                    description=desc,
                    emoji=mt.get("emoji") or None
                ))
            super().__init__(placeholder="Select a mission type to edit...", min_values=1, max_values=1,
                             options=options)

        async def callback(self, interaction: discord.Interaction):
            from bot.cogs.mission.mission_modals import MissionTypeModal
            selected_mission_type_name = self.values[0]
            selected_mission_type = next(
                (mt for mt in self.view.mission_types if mt["name"] == selected_mission_type_name), None)

            if selected_mission_type:
                modal = MissionTypeModal(bot=self.bot, guild_id=interaction.guild.id, mode="edit",
                                         mission_type=selected_mission_type)
                await interaction.response.send_modal(modal)
            else:
                await interaction.response.send_message("Could not find the selected mission type.", ephemeral=True)


class DeleteMissionTypeView(discord.ui.View):
    def __init__(self, bot, mission_types):
        super().__init__()
        self.bot = bot
        self.mission_types = mission_types
        self.add_item(self.MissionTypeSelect(self.bot, self.mission_types))

    class MissionTypeSelect(discord.ui.Select):
        def __init__(self, bot, mission_types):
            self.bot = bot
            options = [
                discord.SelectOption(
                    label=mt["name"],
                    description=mt.get("description", ""),
                    emoji=mt.get("emoji") or None
                ) for mt in mission_types
            ]
            super().__init__(placeholder="Select a mission type to delete...", min_values=1, max_values=1,
                             options=options)

        async def callback(self, interaction: discord.Interaction):
            selected_mission_type_name = self.values[0]
            self.view.clear_items()
            self.view.add_item(self.view.ConfirmDeleteButton(self.bot, selected_mission_type_name))
            self.view.add_item(self.view.CancelDeleteButton())
            await interaction.response.edit_message(
                content=f"Are you sure you want to delete the mission type **{selected_mission_type_name}**?",
                view=self.view)

    class ConfirmDeleteButton(discord.ui.Button):
        def __init__(self, bot, mission_type_name):
            super().__init__(label="Confirm", style=discord.ButtonStyle.danger)
            self.bot = bot
            self.mission_type_name = mission_type_name

        async def callback(self, interaction: discord.Interaction):
            guild_id = interaction.guild.id
            guild_collection = self.bot.db[Db_Constant.GUILD_CONFIG_COLLECTION]
            guild_config = await guild_collection.find_one({"guild_id": guild_id})

            if not guild_config or "mission_types" not in guild_config:
                await interaction.response.edit_message(content="No mission types are configured to delete.", view=None)
                return

            initial_count = len(guild_config["mission_types"])
            updated_mission_types = [mt for mt in guild_config["mission_types"] if
                                     mt["name"].lower() != self.mission_type_name.lower()]

            if len(updated_mission_types) == initial_count:
                await interaction.response.edit_message(content=f"Mission type '{self.mission_type_name}' not found.",
                                                        view=None)
                return

            await guild_collection.update_one(
                {"guild_id": guild_id},
                {"$set": {"mission_types": updated_mission_types}}
            )
            await interaction.response.edit_message(
                content=f"Mission type '{self.mission_type_name}' deleted successfully!", view=None)

    class CancelDeleteButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="Cancel", style=discord.ButtonStyle.secondary)

        async def callback(self, interaction: discord.Interaction):
            await interaction.response.edit_message(content="Deletion cancelled.", view=None)


class MissionSelectionView(discord.ui.View):
    def __init__(self, bot, missions, is_admin, action="finalize"):
        super().__init__(timeout=180)  # 3 minutes timeout
        self.bot = bot
        self.missions = missions
        self.is_admin = is_admin
        self.action = action
        self.add_item(self.MissionSelect(missions, action))

    class MissionSelect(discord.ui.Select):
        def __init__(self, missions, action):
            options = []
            for mission in missions:
                options.append(discord.SelectOption(label=mission["name"],
                                                    value=str(mission["_id"])))
            super().__init__(placeholder=f"Select a mission to {action}...", options=options)
            self.action = action

        async def callback(self, interaction: discord.Interaction):
            selected_mission_id = self.values[0]
            try:
                selected_mission_object_id = ObjectId(selected_mission_id)
                mission_doc = next((m for m in self.view.missions if m["_id"] == selected_mission_object_id), None)

                if mission_doc:
                    mission_commands_cog = self.view.bot.get_cog("MissionCommands")
                    if mission_commands_cog:
                        if self.action == "finalize":
                            await interaction.response.edit_message(content="Finalizing mission...", view=None,
                                                                    embed=None)
                            await mission_commands_cog._finalize_mission(interaction, mission_doc)
                        elif self.action == "addships":
                            guild_config = await self.view.bot.db[Db_Constant.GUILD_CONFIG_COLLECTION].find_one(
                                {"guild_id": interaction.guild.id})
                            ship_prefix = guild_config.get("ship_prefix", "")
                            view = AddShipsView(self.view.bot, mission_doc, ship_prefix, interaction.user)
                            await interaction.response.edit_message(embed=view.get_embed(), view=view)
                    else:
                        print(f"Error: MissionCommands cog not found.")
                        await interaction.response.send_message("Error: MissionCommands cog not found.", ephemeral=True)
                else:
                    print(f"Error: Selected mission with ID {selected_mission_id} not found in the list.")
                    await interaction.response.send_message("Selected mission not found.", ephemeral=True)
            except Exception as e:
                print(f"An unexpected error occurred in MissionSelect callback: {e}")
                await interaction.followup.send(
                    "An unexpected error occurred while processing the mission. Please try again.", ephemeral=True)
            finally:
                self.view.stop()


class AddShipsView(discord.ui.View):
    def __init__(self, bot, mission_doc, ship_prefix, author):
        super().__init__(timeout=300)
        self.bot = bot
        self.mission_doc = mission_doc
        self.ship_prefix = ship_prefix
        self.author = author
        self.primary_ship = None
        self.supporting_ships = []
        self.update_buttons()

    def get_embed(self):
        embed = discord.Embed(
            title=f"Add Ships to {self.mission_doc['name']}",
            description="Select primary and supporting ships to add to the mission.",
            color=discord.Color.blurple()
        )
        embed.add_field(name="Primary Ship",
                        value=f"{self.ship_prefix} {self.primary_ship['ship_name']}" if self.primary_ship else "Not Selected",
                        inline=False)
        embed.add_field(name="Supporting Ships", value=", ".join(
            [f"{self.ship_prefix} {ship['ship_name']}" for ship in
             self.supporting_ships]) if self.supporting_ships else "Not Selected",
                        inline=False)
        return embed

    def update_buttons(self):
        self.clear_items()
        self.add_item(self.PrimaryShipButton(self))
        self.add_item(self.SupportingShipButton(self))
        self.add_item(self.ConfirmButton(self))
        self.add_item(self.CancelButton(self))

    class PrimaryShipButton(discord.ui.Button):
        def __init__(self, parent_view):
            super().__init__(label="Primary Ship", style=discord.ButtonStyle.primary)
            self.parent_view = parent_view

        async def callback(self, interaction: discord.Interaction):
            ship_selection_view = ShipSelectionView(self.parent_view, "primary", self.parent_view.ship_prefix)
            await ship_selection_view.load_ships()
            await interaction.response.edit_message(embed=ship_selection_view.get_embed(), view=ship_selection_view)

    class SupportingShipButton(discord.ui.Button):
        def __init__(self, parent_view):
            super().__init__(label="Supporting Ship", style=discord.ButtonStyle.secondary)
            self.parent_view = parent_view

        async def callback(self, interaction: discord.Interaction):
            ship_selection_view = ShipSelectionView(self.parent_view, "supporting", self.parent_view.ship_prefix)
            await ship_selection_view.load_ships()
            await interaction.response.edit_message(embed=ship_selection_view.get_embed(), view=ship_selection_view)

    class ConfirmButton(discord.ui.Button):
        def __init__(self, parent_view):
            super().__init__(label="Confirm", style=discord.ButtonStyle.success)
            self.parent_view = parent_view

        async def callback(self, interaction: discord.Interaction):
            await interaction.response.defer()
            try:
                update_query = {"$addToSet": {}}
                ship_ids_to_update = []

                if self.parent_view.primary_ship:
                    update_query["$set"] = {"primary_ship": self.parent_view.primary_ship["_id"]}
                    ship_ids_to_update.append(self.parent_view.primary_ship["_id"])

                if self.parent_view.supporting_ships:
                    update_query["$addToSet"]["supporting_ships"] = {
                        "$each": [ship["_id"] for ship in self.parent_view.supporting_ships]}
                    ship_ids_to_update.extend([ship["_id"] for ship in self.parent_view.supporting_ships])

                if update_query:
                    await self.parent_view.bot.db[Db_Constant.MISSION].update_one(
                        {"_id": self.parent_view.mission_doc["_id"]},
                        update_query
                    )
                if ship_ids_to_update:
                    await self.parent_view.bot.db[Db_Constant.SHIP].update_many(
                        {"_id": {"$in": ship_ids_to_update}},
                        {"$set": {"is_mission": True, "current_mission_id": self.parent_view.mission_doc["_id"]}}
                    )

                await interaction.followup.edit_message(message_id=interaction.message.id,
                                                        content="Ships added successfully!", embed=None, view=None)
                self.parent_view.stop()
            except Exception as e:
                print(f"Error in ConfirmButton callback: {e}")
                await interaction.followup.send(
                    content="An error occurred while adding ships. Please try again.", ephemeral=True)

    class CancelButton(discord.ui.Button):
        def __init__(self, parent_view):
            super().__init__(label="Cancel", style=discord.ButtonStyle.danger)
            self.parent_view = parent_view

        async def callback(self, interaction: discord.Interaction):
            await interaction.response.edit_message(content="Adding ships cancelled.", embed=None, view=None)
            self.parent_view.stop()


class DeleteMissionView(discord.ui.View):
    def __init__(self, bot, missions):
        super().__init__()
        self.bot = bot
        self.missions = missions
        self.add_item(self.MissionSelect(self.bot, self.missions))

    class MissionSelect(discord.ui.Select):
        def __init__(self, bot, missions):
            self.bot = bot
            options = [
                discord.SelectOption(
                    label=mt["name"],
                    description=f"Status: {mt['status']}",
                    value=str(mt["_id"])
                ) for mt in missions
            ]
            super().__init__(placeholder="Select a mission to delete...", min_values=1, max_values=1, options=options)

        async def callback(self, interaction: discord.Interaction):
            selected_mission_id = ObjectId(self.values[0])
            mission_doc = await self.bot.db[Db_Constant.MISSION].find_one({"_id": selected_mission_id})
            if not mission_doc:
                await interaction.response.edit_message(content="Selected mission not found.", view=None)
                return

            self.view.clear_items()
            self.view.add_item(self.view.ConfirmDeleteButton(self.bot, mission_doc))
            self.view.add_item(self.view.CancelDeleteButton())
            await interaction.response.edit_message(
                content=f"Are you sure you want to delete the mission **{mission_doc['name']}**? This action is irreversible.",
                view=self.view)

    class ConfirmDeleteButton(discord.ui.Button):
        def __init__(self, bot, mission_doc):
            super().__init__(label="Confirm Delete", style=discord.ButtonStyle.danger)
            self.bot = bot
            self.mission_doc = mission_doc

        async def callback(self, interaction: discord.Interaction):
            await interaction.response.defer()
            mission_name = self.mission_doc["name"]

            try:
                mission_commands_cog = self.bot.get_cog("MissionCommands")
                if mission_commands_cog:
                    await mission_commands_cog._reset_mission_associations(self.mission_doc)

                await self.bot.db[Db_Constant.MISSION].delete_one({"_id": self.mission_doc["_id"]})

                await interaction.followup.edit_message(message_id=interaction.message.id,
                                                        content=f"Mission '{mission_name}' and all its associations have been successfully deleted.",
                                                        view=None)

            except Exception as e:
                print(f"Error deleting mission {mission_name}: {e}")
                await interaction.followup.edit_message(message_id=interaction.message.id,
                                                        content="An error occurred while deleting the mission. Please check the logs.",
                                                        view=None)

    class CancelDeleteButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="Cancel", style=discord.ButtonStyle.secondary)

        async def callback(self, interaction: discord.Interaction):
            await interaction.response.edit_message(content="Deletion cancelled.", view=None)


class LaunchMissionView(discord.ui.View):
    def __init__(self, bot, missions):
        super().__init__(timeout=None)
        self.bot = bot
        self.missions = missions
        self.guild_collection: AsyncIOMotorCollection = self.bot.guild_collection
        self.user_collection: AsyncIOMotorCollection = self.bot.user_collection
        self.rp_settings_collection: AsyncIOMotorCollection = self.bot.db[Db_Constant.RP_SETTING_COLLECTION]
        self.add_item(self.MissionSelect(bot=self.bot, missions=self.missions, parent_view=self))

    async def post_embed(self, interaction: discord.Interaction, mission_doc: dict, mission_status,
                         total_mission_rp: int):
        guild_config = await  self.bot.guild_collection.find_one(
            {"guild_id": interaction.guild.id}
        )

        ship_ids = [mission_doc["primary_ship"]] + mission_doc.get("supporting_ships", [])
        ships_all = await self.bot.db["ships"].find({"_id": {"$in": ship_ids}}).to_list(length=None)

        embed = await  build_mission_launch_embed(
            mission_doc=mission_doc,
            ships=ships_all,
            guild=interaction.guild,
            guild_config=guild_config,
            mission_status=mission_status,
            total_mission_rp=total_mission_rp
        )

        channel = interaction.guild.get_channel(guild_config["launch_channel"])

        await channel.send(embed=embed)

    class MissionSelect(discord.ui.Select):
        def __init__(self, bot, missions, parent_view):
            self.bot = bot
            self.guild_collection: AsyncIOMotorCollection = parent_view.guild_collection
            self.user_collection: AsyncIOMotorCollection = parent_view.user_collection
            self.rp_settings_collection: AsyncIOMotorCollection = parent_view.rp_settings_collection
            options = [
                discord.SelectOption(
                    label=m["name"],
                    description=f"Status: {m['status']}",
                    value=str(m["_id"])
                )
                for m in missions
            ]
            super().__init__(placeholder="Select a mission to launch", min_values=1, max_values=1, options=options)
            self.parent_view = parent_view

        async def callback(self, interaction: Interaction):
            try:
                selected_mission_id = ObjectId(self.values[0])
                mission_doc = await self.bot.db["missions"].find_one({"_id": selected_mission_id})
                if not mission_doc:
                    await interaction.response.edit_message(content="Selected mission not found.", view=None)
                    return

                await self.check_and_launch_mission(interaction, mission_doc)
            except Exception as e:
                await interaction.response.send_message(f"Error: {e}", ephemeral=True)

        async def check_and_launch_mission(self, interaction: Interaction, mission_doc: dict):
            # MongoDB stores ObjectId, not {"$oid":...}
            ship_ids = [mission_doc["primary_ship"]] + mission_doc.get("supporting_ships", [])

            ships = await self.bot.db["ships"].find({"_id": {"$in": ship_ids}}).to_list(length=None)

            valid_ships = []
            empty_ships = []
            total_crew_count = 0

            for ship in ships:
                crew_count = 0
                has_pilot = False

                for role, data in ship["crew_roles"].items():
                    if data["filled"]:
                        crew_count += len(data["filled"])
                    if role.lower() == "pilot" and len(data["filled"]) > 0:
                        has_pilot = True

                if crew_count == 0:
                    empty_ships.append(ship)
                    continue

                if not has_pilot:
                    await interaction.response.send_message(
                        f"Ship **{ship['ship_name']}** needs a pilot before launching.",
                        ephemeral=True
                    )
                    return

                valid_ships.append(ship)
                total_crew_count += crew_count

            if total_crew_count < 2:
                await interaction.response.send_message(
                    "❌ You need at least **2 participants** to launch a mission.",
                    ephemeral=True
                )
                return

            if empty_ships:
                view = LaunchMissionView.ConfirmDropShipsView(
                    bot=self.bot,
                    mission_doc=mission_doc,
                    valid_ships=valid_ships,
                    empty_ships=empty_ships,
                    parent_view=self.parent_view
                )

                await interaction.response.send_message(
                    f"⚠️ The following ships have no crew and will be removed:\n"
                    f"{', '.join([s['ship_name'] for s in empty_ships])}\n\n"
                    "Do you want to proceed?",
                    view=view,
                    ephemeral=True
                )
                return

            await self.launch_mission(interaction, mission_doc, valid_ships)

        async def launch_mission(self, interaction: Interaction, mission_doc: dict, ships: list):
            await self.bot.db["missions"].update_one(
                {"_id": mission_doc["_id"]},
                {
                    "$set": {
                        "status": MissionState.INPROGRESS.value,
                        "start_time": datetime.datetime.now(tz=TIMEZONE)
                    }
                }

            )

            guild_doc = await  self.guild_collection.find_one({"guild_id": interaction.guild.id})
            new_mission_docs = await self.bot.db["missions"].find_one({"_id": mission_doc["_id"]})
            rp_settings_docs = await self.rp_settings_collection.find_one({"guild_id": interaction.guild.id}) or {}

            channel = interaction.guild.get_channel(guild_doc["launch_channel"])
            crew_list = extract_flat_crew_list(ships=ships)
            points_doc = rp_settings_docs.get("points", {})

            total_mission_rp = 0
            message_to_send = []
            for crew in crew_list:
                user_doc = await self.user_collection.find_one({"_id": crew.get("id")})
                display_name = None
                if user_doc:
                    display_name = user_doc.get("citizen_name")

                # try cached member, then fallback to fetch (safe)
                member = interaction.guild.get_member(crew["id"])
                if not display_name and member:
                    display_name = member.display_name

                crew_fill_parcentage = crew["crew_fill_parcentage"] or 50

                crew_cfg = points_doc.get("crew_fill", {})
                min_cfg = crew_cfg.get("min", {})
                max_cfg = crew_cfg.get("max", {})

                # extract with sane defaults
                try:
                    min_th = int(min_cfg.get("threshold", 50))
                    max_th = int(max_cfg.get("threshold", 70))
                    min_pts = int(min_cfg.get("points", 1))
                    max_pts = int(max_cfg.get("points", 2))
                except Exception:
                    min_th, max_th, min_pts, max_pts = 50, 70, 1, 2

                # # fix swapped thresholds
                # if min_th > max_th:
                #     min_th, max_th = max_th, min_th

                # decide points
                if crew_fill_parcentage < min_th:
                    points = 0
                elif crew_fill_parcentage <= max_th:
                    points = min_pts
                else:
                    points = max_pts

                total_mission_rp+= points

                message = f"_**{display_name.upper()}** will earn +{points} RP points for their **{crew.get("role")}** role aboard **{guild_doc.get("ship_prefix", "HCS")} {crew.get("ship_name")}** upon completion of mission **{new_mission_docs["name"]}** _"
                if crew_fill_parcentage >= min_th:
                    message_to_send.append(message)


            await self.parent_view.post_embed(interaction=interaction, mission_doc=mission_doc,
                                              mission_status=new_mission_docs["status"],
                                              total_mission_rp=total_mission_rp)

            await self.parent_view.bot.get_cog("MissionCommands").start_mission_complete_check(
                interaction=interaction,
                mission_id=str(mission_doc["_id"])
            )





            await interaction.response.send_message(
                f"✅ Mission **{mission_doc['name']}** launched with ships: "
                f"{', '.join([s['ship_name'] for s in ships])}",
                ephemeral=True
            )

            try:
                ship_cog = self.bot.get_cog("ShipCommands")
                await ship_cog.update_crew_fill_percentage()
            except Exception as e:
                logging.error(f"Failed to update crew fill from mission view confirm button: {e}")



            await self.bot.loop.create_task(delayed_send_messages(channel=channel, messages=message_to_send))

    class ConfirmDropShipsView(discord.ui.View):
        def __init__(self, bot, mission_doc, valid_ships, empty_ships, parent_view):
            super().__init__(timeout=60)
            self.bot = bot
            self.mission_doc = mission_doc
            self.valid_ships = valid_ships
            self.empty_ships = empty_ships
            self.parent_view = parent_view
            self.add_item(self.LaunchButton(self))
            self.add_item(self.WaitButton(self))

        class LaunchButton(discord.ui.Button):
            def __init__(self, parent_view):
                super().__init__(label="Launch Mission", style=discord.ButtonStyle.green)
                self.parent_view = parent_view

            async def callback(self, interaction: Interaction):
                updated_supporting = [
                    s["_id"]
                    for s in self.parent_view.valid_ships
                    if s["_id"] != self.parent_view.mission_doc["primary_ship"]
                ]

                await self.parent_view.bot.db["missions"].update_one(
                    {"_id": self.parent_view.mission_doc["_id"]},
                    {"$set": {
                        "supporting_ships": updated_supporting,
                        "status": MissionState.INPROGRESS.value,
                        "start_time": datetime.datetime.now(TIMEZONE)
                    }}
                )

                await interaction.response.edit_message(
                    content=f"✅ Mission **{self.parent_view.mission_doc['name']}** launched.\n"
                            f"Removed ships: {', '.join([s['ship_name'] for s in self.parent_view.empty_ships])}",
                    view=None
                )
                await self.parent_view.bot.get_cog("MissionCommands").start_mission_complete_check(
                    interaction=interaction,
                    mission_id=str(self.parent_view.mission_doc["_id"])
                )
                new_mission_docs = await self.parent_view.bot.db["missions"].find_one(
                    {"_id": self.parent_view.mission_doc["_id"]})
                await self.parent_view.parent_view.post_embed(
                    interaction=interaction,
                    mission_doc=self.parent_view.mission_doc,
                    mission_status=new_mission_docs["status"],
                    total_mission_rp= 0
                )

        class WaitButton(discord.ui.Button):
            def __init__(self, parent_view):
                super().__init__(label="Wait for Crew", style=discord.ButtonStyle.gray)
                self.parent_view = parent_view

            async def callback(self, interaction: Interaction):
                await interaction.response.edit_message(
                    content="⏳ Mission launch canceled. Waiting for more crew.",
                    view=None
                )


class AbortMissionView(discord.ui.View):
    def __init__(self, bot, missions):
        super().__init__()
        self.bot = bot
        self.missions = missions
        self.add_item(self.MissionSelect(self.bot, self.missions))

    class MissionSelect(discord.ui.Select):
        def __init__(self, bot, missions):
            self.bot = bot
            options = [
                discord.SelectOption(
                    label=mt["name"],
                    description=f"Status: {mt['status']}",
                    value=str(mt["_id"])
                ) for mt in missions
            ]
            super().__init__(placeholder="Select a mission to abort...", min_values=1, max_values=1, options=options)

        async def callback(self, interaction: discord.Interaction):
            selected_mission_id = ObjectId(self.values[0])
            mission_doc = await self.bot.db[Db_Constant.MISSION].find_one({"_id": selected_mission_id})
            if not mission_doc:
                await interaction.response.edit_message(content="Selected mission not found.", view=None)
                return

            self.view.clear_items()
            self.view.add_item(self.view.ConfirmAbortButton(self.bot, mission_doc))
            self.view.add_item(self.view.CancelAbortButton())
            await interaction.response.edit_message(
                content=f"Are you sure you want to abort the mission **{mission_doc['name']}**?", view=self.view)

    class ConfirmAbortButton(discord.ui.Button):
        def __init__(self, bot, mission_doc):
            super().__init__(label="Confirm Abort", style=discord.ButtonStyle.danger)
            self.bot = bot
            self.mission_doc = mission_doc

        async def callback(self, interaction: discord.Interaction):
            await interaction.response.defer()
            mission_name = self.mission_doc["name"]

            try:
                mission_commands_cog = self.bot.get_cog("MissionCommands")
                if mission_commands_cog:
                    await mission_commands_cog._reset_mission_associations(self.mission_doc)

                await self.bot.db[Db_Constant.MISSION].update_one(
                    {"_id": self.mission_doc["_id"]},
                    {"$set": {"status": MissionState.ABORT.value}}
                )

                await interaction.followup.edit_message(message_id=interaction.message.id,
                                                        content=f"Mission '{mission_name}' has been successfully aborted.",
                                                        view=None)

                try:
                    ship_cog = self.bot.get_cog("ShipCommands")
                    await ship_cog.update_crew_fill_percentage()
                except Exception as e:
                    logging.error(f"Failed to update crew fill from mission view confirm button: {e}")

            except Exception as e:
                print(f"Error aborting mission {mission_name}: {e}")
                await interaction.followup.edit_message(message_id=interaction.message.id,
                                                        content="An error occurred while aborting the mission. Please check the logs.",
                                                        view=None)

    class CancelAbortButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="Cancel", style=discord.ButtonStyle.secondary)

        async def callback(self, interaction: discord.Interaction):
            await interaction.response.edit_message(content="Abort cancelled.", view=None)


class GenericMissionView(discord.ui.View):
    def __init__(self, timeout: float | None = None):
        super().__init__(timeout=timeout)

    def add_select(
            self,
            placeholder: str,
            options: list[discord.SelectOption],
            min_values: int = 1,
            max_values: int = 1,
            custom_id: str | None = None,
            disabled: bool = False,
            callback=None
    ):
        select = discord.ui.Select(
            placeholder=placeholder,
            min_values=min_values,
            max_values=max_values,
            options=options,
            disabled=disabled
        )
        if custom_id is not None:
            select["custom_id"] = custom_id
        if callback:
            select.callback = callback
        self.add_item(select)

    def add_buttons(self, buttons: list[ButtonSchema]):
        for button_data in buttons:
            button = discord.ui.Button(
                label=button_data.label,
                style=button_data.style,
                emoji=button_data.emoji,
                custom_id=button_data.custom_id or f"button_{id(self)}",
                disabled=button_data.disabled
            )
            if button_data.callback:
                button.callback = button_data.callback

            self.add_item(button)
