import re
from datetime import datetime

import discord

from bot import TIMEZONE, UTC_TZ
from bot.core.constant import Db_Constant
from bot.core.mission_state import MissionState
from bot.utils.helepr import is_emoji


class MissionCreationModal(discord.ui.Modal, title="New Mission"):
    def __init__(self, bot, guild_config):
        super().__init__()

        now = datetime.now(TIMEZONE)
        formatted_now = now.strftime("%m-%d-%y %H:%M")
        self.mission_name = discord.ui.TextInput(
            label="Mission Name",
            placeholder="Enter the name of the mission",
            required=True,
        )
        self.mission_time = discord.ui.TextInput(
            label="Mission Time (MM-DD-YY HH:MM)",
            placeholder=f"e.g., {formatted_now}",
            required=True,
        )
        self.objectives = discord.ui.TextInput(
            label="Objectives",
            placeholder="Enter the mission objectives",
            style=discord.TextStyle.long,
            required=True,
        )

        self.add_item(self.mission_name)
        self.add_item(self.mission_time)
        self.add_item(self.objectives)

        self.bot = bot
        self.guild_config = guild_config
        self.mission_collection = self.bot.db[Db_Constant.MISSION]

    async def on_submit(self, interaction: discord.Interaction):
        mission_name = self.mission_name.value
        mission_time = self.mission_time.value
        objectives = self.objectives.value

        mission_config = await self.mission_collection.find_one(
            {"name": re.compile(f"^{re.escape(mission_name)}$", re.IGNORECASE)}
        )

        if mission_config:
            await interaction.response.send_message(
                f"A mission with the name '{mission_name}' already exists. Please choose a unique name.",
                ephemeral=True,
            )
            return
        try:
            mission_naive_datetime = datetime.strptime(mission_time, "%m-%d-%y %H:%M")
            mission_eastern_datetime = TIMEZONE.localize(mission_naive_datetime)
            mission_utc_datetime = mission_eastern_datetime.astimezone(UTC_TZ)

            if mission_utc_datetime <= datetime.now(UTC_TZ):
                await interaction.response.send_message(
                    "Mission time must be in the future. Please provide a future date and time (MM-DD-YYYY HH:MM).",
                    ephemeral=True,
                )
                return
        except ValueError:
            await interaction.response.send_message(
                "Invalid mission time format. Please use MM-DD-YY HH:MM (e.g., 07-20-25 20:00).",
                ephemeral=True,
            )
            return
        except Exception as e:
            print(f"Mission Modal Failed, {e}")

        # Handle case where guild_config might be None
        if not self.guild_config:
            await interaction.response.send_message(
                "Guild configuration not found. Please contact an admin to set up mission types first.",
                ephemeral=True,
            )
            return

        mission_types = self.guild_config.get("mission_types", [])
        max_mission_ships = self.guild_config.get("max_mission_ships", 1)
        ship_prefix = self.guild_config.get("ship_prefix", "")

        # Safe to assign default status
        mission_status = MissionState.WAITING.value

        thread = await interaction.channel.create_thread(
            name=f"Mission Creation - {mission_name}",
            type=discord.ChannelType.private_thread,
        )
        await thread.add_user(interaction.user)
        from bot.cogs.mission.mission_view import MissionCreationView

        view = MissionCreationView(
            interaction.user,
            self.bot,
            mission_name,
            mission_utc_datetime,
            mission_status,
            objectives,
            mission_types,
            max_mission_ships,
            ship_prefix,
            thread=thread,
        )
        embed = view.get_embed()
        await thread.send(embed=embed, view=view)
        await interaction.response.send_message(
            f"Started mission creation in {thread.mention}", ephemeral=True
        )


class MissionTypeModal(discord.ui.Modal):
    def __init__(
        self, bot, guild_id: int, mode: str = "add", mission_type: dict = None
    ):
        title = "Edit Mission Type" if mode == "edit" else "Add Mission Type"
        super().__init__(title=title)

        self.bot = bot
        self.mode = mode
        self.guild_id = guild_id
        self.original_mission_type = mission_type
        self.guild_collection = self.bot.db[Db_Constant.GUILD_CONFIG_COLLECTION]

        self.name = discord.ui.TextInput(
            label="Mission Type Name",
            default=mission_type["name"] if mission_type else None,
            required=True,
        )
        self.description = discord.ui.TextInput(
            label="Description",
            default=mission_type["description"] if mission_type else None,
            style=discord.TextStyle.long,
            required=True,
        )
        self.emoji = discord.ui.TextInput(
            label="Emoji",
            default=mission_type.get("emoji", "") if mission_type else "",
            required=False,
        )

        self.add_item(self.name)
        self.add_item(self.description)
        self.add_item(self.emoji)

    async def on_submit(self, interaction: discord.Interaction):
        name = self.name.value
        description = self.description.value
        emoji = self.emoji.value.strip()

        # ✅ Validate emoji if entered
        if emoji and not is_emoji(emoji, interaction.guild):
            await interaction.response.send_message(
                f"❌ The emoji you entered is invalid. Please enter a valid emoji.",
                ephemeral=True,
            )
            return

        guild_config = await self.guild_collection.find_one({"guild_id": self.guild_id})
        mission_types = guild_config.get("mission_types", []) if guild_config else []

        if self.mode == "add":
            for mt in mission_types:
                if mt["name"].lower() == name.lower():
                    await interaction.response.send_message(
                        f"A mission type with the name '{name}' already exists.",
                        ephemeral=True,
                    )
                    return

            new_type = {
                "name": name,
                "description": description,
                "emoji": emoji if emoji else "",
            }

            await self.guild_collection.update_one(
                {"guild_id": self.guild_id},
                {"$push": {"mission_types": new_type}},
                upsert=True,
            )
            await interaction.response.send_message(
                f"✅ Mission type **{name}** added.", ephemeral=True
            )

        elif self.mode == "edit":
            if name.lower() != self.original_mission_type["name"].lower():
                for mt in mission_types:
                    if mt["name"].lower() == name.lower():
                        await interaction.response.send_message(
                            f"A mission type with the name '{name}' already exists.",
                            ephemeral=True,
                        )
                        return

            for mt in mission_types:
                if mt["name"].lower() == self.original_mission_type["name"].lower():
                    mt["name"] = name
                    mt["description"] = description
                    mt["emoji"] = emoji if emoji else ""
                    break

            await self.guild_collection.update_one(
                {"guild_id": self.guild_id}, {"$set": {"mission_types": mission_types}}
            )
            await interaction.response.send_message(
                f"✅ Mission type **{self.original_mission_type['name']}** updated.",
                ephemeral=True,
            )
