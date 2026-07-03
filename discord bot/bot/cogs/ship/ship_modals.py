import discord

from bot.core.constant import Db_Constant
from bot.utils.helepr import is_emoji


class ShipRegistrationModal(discord.ui.Modal, title="Register New Ship"):
    ship_name = discord.ui.TextInput(
        label="Ship Name",
        placeholder="Enter a roleplay-inspired name for your ship. 'HCS' (Hopewell Continuum Ship) will be auto-applied.",
        required=True,
    )
    ship_description = discord.ui.TextInput(
        label="Ship Description",
        placeholder="Describe your ship in roleplay terms and explain its features, history, and exploits.",
        style=discord.TextStyle.long,
        required=True,
        max_length=300,
    )

    def __init__(self):
        super().__init__()
        self.name = None
        self.description = None

    async def on_submit(self, interaction: discord.Interaction):
        self.name = self.ship_name.value
        self.description = self.ship_description.value
        await interaction.response.defer()  # Defer the interaction to allow for follow-up actions
        self.stop()  # Stop the modal interaction


class EditShipModal(discord.ui.Modal, title="Edit Ship Details"):
    def __init__(self, current_name: str, current_description: str):
        super().__init__()
        self.new_name = discord.ui.TextInput(
            label="New Ship Name",
            placeholder="Enter the new name for your ship",
            default=current_name,
            required=True,
        )
        self.new_description = discord.ui.TextInput(
            label="New Ship Description",
            placeholder="Enter the new description for your ship",
            default=current_description,
            style=discord.TextStyle.long,
            required=True,
        )
        self.add_item(self.new_name)
        self.add_item(self.new_description)
        self.name_value = None
        self.description_value = None

    async def on_submit(self, interaction: discord.Interaction):
        self.name_value = self.new_name.value
        self.description_value = self.new_description.value
        await interaction.response.defer()
        self.stop()


class ShipTypeModal(discord.ui.Modal):
    def __init__(self, bot, guild_id: int, mode: str = "add", ship_type: dict = None):
        title = "Edit Ship Type" if mode == "edit" else "Add Ship Type"
        super().__init__(title=title)

        self.bot = bot
        self.mode = mode
        self.guild_id = guild_id
        self.original_ship_type = ship_type
        self.guild_collection = self.bot.db[Db_Constant.GUILD_CONFIG_COLLECTION]

        self.name = discord.ui.TextInput(
            label="Ship Type Name",
            default=ship_type["name"] if ship_type else None,
            required=True,
        )
        self.description = discord.ui.TextInput(
            label="Description",
            default=ship_type["description"] if ship_type else None,
            style=discord.TextStyle.long,
            required=True,
        )
        self.emoji = discord.ui.TextInput(
            label="Emoji",
            default=ship_type.get("emoji", "") if ship_type else "",
            required=False,
        )

        self.add_item(self.name)
        self.add_item(self.description)
        self.add_item(self.emoji)

    async def on_submit(self, interaction: discord.Interaction):
        name = self.name.value
        description = self.description.value
        emoji = self.emoji.value

        if emoji and not is_emoji(emoji, interaction.guild):
            await interaction.response.send_message(
                f"❌ The emoji you entered is invalid. Please enter a valid standard or custom emoji.",
                ephemeral=True,
            )
            return

        guild_config = await self.guild_collection.find_one({"guild_id": self.guild_id})
        ship_types = guild_config.get("ship_types", []) if guild_config else []

        if self.mode == "add":
            for st in ship_types:
                if st["name"].lower() == name.lower():
                    await interaction.response.send_message(
                        f"A ship type with the name '{name}' already exists.",
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
                {"$push": {"ship_types": new_type}},
                upsert=True,
            )
            await interaction.response.send_message(
                f"✅ Ship type **{name}** added.", ephemeral=True
            )

        elif self.mode == "edit":
            if name.lower() != self.original_ship_type["name"].lower():
                for st in ship_types:
                    if st["name"].lower() == name.lower():
                        await interaction.response.send_message(
                            f"A ship type with the name '{name}' already exists.",
                            ephemeral=True,
                        )
                        return

            for st in ship_types:
                if st["name"].lower() == self.original_ship_type["name"].lower():
                    st["name"] = name
                    st["description"] = description
                    st["emoji"] = emoji if emoji else ""
                    break

            await self.guild_collection.update_one(
                {"guild_id": self.guild_id}, {"$set": {"ship_types": ship_types}}
            )
            await interaction.response.send_message(
                f"✅ Ship type **{self.original_ship_type['name']}** updated.",
                ephemeral=True,
            )


class ShipModelNameModal(discord.ui.Modal, title="Create Ship Model"):
    """Modal for entering a new ship model name."""
    
    model_name = discord.ui.TextInput(
        label="Model Name",
        placeholder="Enter the ship model name (e.g., Gladius, Hammerhead)",
        required=True,
        max_length=100,
    )
    
    def __init__(self, category: str):
        super().__init__()
        self.category = category
        self.name_value = None
    
    async def on_submit(self, interaction: discord.Interaction):
        self.name_value = self.model_name.value
        await interaction.response.defer()
        self.stop()

