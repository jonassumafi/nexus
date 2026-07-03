
import discord
from discord import Interaction

from bot.core.constant import Db_Constant
from bot.core.models.modal_schema import ModalFieldSchema
from bot.utils.helepr import is_emoji


class OnBoardingDetailsSubmitModal(discord.ui.Modal):
    def __init__(self, parent_view):
        super().__init__(title="Enter your details")
        self.parent_view =parent_view


        self.name = discord.ui.TextInput(
            label="Citizen Designation",
            placeholder= "e.g., Kara Morrow, Aidan Kallis, Thorne-918",
            required=True,
            max_length= 50
        )
        self.place_of_birth = discord.ui.TextInput(
            label="UEE Registered Birthplace (City)",
            placeholder="e.g., New Babbage, Lorville, Area 18, Orison",
            required=True,
            max_length=50
        )
        self.citizenship  = discord.ui.TextInput(
            label="Declared Planet of Citizenship",
            placeholder="e.g., ArcCorp, Terra, Earth, MicroTech",
            required=True,
            max_length=50
        )

        self.biography = discord.ui.TextInput(
            label="Citizen Biography",
            placeholder="e.g., Born on Terra, served in UEE Navy, now freelance pilot in Stanton",
            required=True,
            style= discord.TextStyle.paragraph,
            max_length=300
        )

        items = [self.name, self.place_of_birth, self.citizenship, self.biography]
        for item in items:
            self.add_item(item)

    async def on_submit(self, interaction: Interaction):
        print("✅ Modal submitted!")

        try:
            print("Trying to update user_data…")
            print("Parent View:", self.parent_view)
            print("Before Update:", self.parent_view.user_data)

            self.parent_view.user_data.update({
                "citizen_name": self.name.value,
                "place_of_birth": self.place_of_birth.value,
                "citizenship": self.citizenship.value,
                "biography": self.biography.value
            })

            print("After Update:", self.parent_view.user_data)

        except Exception as e:
            print("❌ Failed to update user_data:", e)
            if not interaction.response.is_done():
                await interaction.response.send_message("❌ Failed to update your data.", ephemeral=True)
            return

            # ✅ REQUIRED: Respond to the modal interaction
        try:
            from bot.utils.views import onboarding_screen
            view = self.parent_view
            embed =onboarding_screen(index=self.parent_view.current_screen, user_data=self.parent_view.user_data)
            view.update_buttons()
            await interaction.response.edit_message(view=view,  embed=embed)
        except Exception as e:
            print("❌ Failed to respond to modal interaction:", e)


class CrewRoleModal(discord.ui.Modal):
    def __init__(self, bot, crew_role=None):
        super().__init__(title="Edit Crew Role" if crew_role else "Add Crew Role")
        self.bot = bot
        self.crew_role = crew_role
        self.guild_collection = self.bot.db[Db_Constant.GUILD_CONFIG_COLLECTION]

        # Inputs
        self.name = discord.ui.TextInput(
            label="Role Name",
            default=self.crew_role["name"] if crew_role else None,
            placeholder="Enter the name of the crew role",
            required=True,
        )
        self.description = discord.ui.TextInput(
            label="Description",
            default=self.crew_role["description"] if crew_role else None,
            placeholder="Enter a description for the crew role",
            style=discord.TextStyle.long,
            required=True,
        )
        self.emoji = discord.ui.TextInput(
            label="Emoji",
            default=self.crew_role.get("emoji", "") if crew_role else None,
            placeholder="Enter an emoji for the crew role",
            required=False,
        )

        self.add_item(self.name)
        self.add_item(self.description)
        self.add_item(self.emoji)

    async def on_submit(self, interaction: discord.Interaction):
        name = self.name.value
        description = self.description.value
        emoji = self.emoji.value or ""
        guild_id = interaction.guild.id


        if emoji and not is_emoji(emoji, interaction.guild):
            await interaction.response.send_message(
                f"❌ The emoji you entered is invalid. Please enter a valid standard or custom emoji.",
                ephemeral=True
            )
            return

        guild_config = await self.guild_collection.find_one({"guild_id": guild_id})
        crew_roles = guild_config.get("crew_roles", []) if guild_config else []

        # Editing mode
        if self.crew_role:
            # Check for duplicate name only if name has changed
            if name.lower() != self.crew_role["name"].lower():
                if any(cr["name"].lower() == name.lower() for cr in crew_roles):
                    await interaction.response.send_message(
                        f"A crew role with the name '{name}' already exists. Please choose a unique name.",
                        ephemeral=True
                    )
                    return

            # Update role
            for cr in crew_roles:
                if cr["name"].lower() == self.crew_role["name"].lower():
                    cr["name"] = name.capitalize()
                    cr["description"] = description.capitalize()
                    cr["emoji"] = emoji
                    break

            await self.guild_collection.update_one(
                {"guild_id": guild_id},
                {"$set": {"crew_roles": crew_roles}},
                upsert=True,
            )

            await interaction.response.send_message(
                f"Crew role `{self.crew_role['name']}` updated successfully!",
                ephemeral=True
            )
        else:
            # Add mode
            if any(cr["name"].lower() == name.lower() for cr in crew_roles):
                await interaction.response.send_message(
                    f"A crew role with the name '{name}' already exists. Please choose a unique name.",
                    ephemeral=True
                )
                return

            new_crew_role = {
                "name": name.capitalize(),
                "description": description.capitalize(),
                "emoji": emoji,
            }
            await self.guild_collection.update_one(
                {"guild_id": guild_id},
                {"$push": {"crew_roles": new_crew_role}},
                upsert=True,
            )

            await interaction.response.send_message(
                f"Crew role **{name}** (Emoji: {emoji if emoji else 'None'}) has been successfully added.",
                ephemeral=True
            )


class GenericModal(discord.ui.Modal):
    def __init__(
        self,
        title: str,
        fields: list[ModalFieldSchema],
        on_submit_callback=None,
        custom_id: str | None = None,
        timeout: float | None = None
    ):
        super().__init__(title=title, timeout=timeout, custom_id=custom_id)
        for field in fields:
            text_input = discord.ui.TextInput(
                label=field.label,
                placeholder=field.placeholder,
                required=field.required,
                min_length=field.min_length,
                max_length=field.max_length,
                style=discord.TextStyle.short if field.style == 1 else discord.TextStyle.paragraph,
                default=field.default,
                custom_id=field.custom_id
            )
            self.add_item(text_input)
        self._on_submit_callback = on_submit_callback

    async def on_submit(self, interaction: discord.Interaction):
        if self._on_submit_callback:
            await self._on_submit_callback(interaction, self.children)


class PortraitURLModal(discord.ui.Modal):
    def __init__(self, parent_view):
        super().__init__(title="Enter Portrait URL")
        self.parent_view = parent_view

        self.url_input = discord.ui.TextInput(
            label="Image URL",
            placeholder="https://example.com/my_character.png",
            required=True,
            style=discord.TextStyle.short
        )
        self.add_item(self.url_input)

    async def on_submit(self, interaction: discord.Interaction):
            from bot.utils.views import onboarding_screen
            view = self.parent_view
            # Advance to Portrait Config (Index 3)
            view.current_screen = 3
            
            embed = onboarding_screen(index=view.current_screen, user_data=view.user_data)
            view.update_buttons()
            await interaction.response.edit_message(view=view, embed=embed)
