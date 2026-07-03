from typing import Any

import discord
from discord import Interaction
from motor.motor_asyncio import AsyncIOMotorCollection

from bot.core.constant import Db_Constant
from bot.utils.embeds import dos_style_embed_builder
from bot.utils.modals import OnBoardingDetailsSubmitModal, PortraitURLModal
from bot.cogs.profile.profile_card import profile_card
from bot.cogs.profile.profile_image import profile_public_id, upload_profile_image
import os
import aiohttp
import shutil
import asyncio
from discord.ext import commands
import logging


# --- The Modal for setting slot counts ---
class SlotSetupModal(discord.ui.Modal):
    def __init__(self, role_name: str, parent_view):
        super().__init__(title=f"Set slots for {role_name}")
        self.role_name = role_name
        self.parent_view = parent_view
        self.slots_input = discord.ui.TextInput(
            label="Number of slots for this role",
            placeholder="Enter a number (e.g., 3)",
            required=True,
            style=discord.TextStyle.short,
        )
        self.add_item(self.slots_input)

    async def on_submit(self, interaction: discord.Interaction):
        slots_value = self.slots_input.value
        if not slots_value.isdigit():
            await interaction.response.send_message(
                "Please enter a valid number.", ephemeral=True
            )
            return

        self.parent_view.slots[self.role_name] = int(slots_value)
        await self.parent_view.update_embed(interaction)


class HelpView(discord.ui.View):
    def __init__(self, categorized_commands: dict[str, list[dict]], commands_per_page: int = 10):
        super().__init__(timeout=180)  # 3 minutes timeout
        self.categorized_commands = categorized_commands
        self.commands_per_page = commands_per_page
        self.current_page = 0

        self.flattened_commands = []
        for category, commands_list in categorized_commands.items():
            for cmd in commands_list:
                self.flattened_commands.append({"category": category, **cmd})

        self.total_pages = (len(self.flattened_commands) + commands_per_page - 1) // commands_per_page
        self.update_buttons()

    def get_current_page_embed(self) -> discord.Embed:
        start_index = self.current_page * self.commands_per_page
        end_index = start_index + self.commands_per_page
        commands_on_page = self.flattened_commands[start_index:end_index]

        embed = discord.Embed(
            title="Bot Commands",
            description="Here are the commands you can use:",
            color=discord.Color.blue()
        )

        current_category = None
        for cmd in commands_on_page:
            if cmd["category"] != current_category:
                current_category = cmd["category"]
                embed.add_field(name=f"\n__**{current_category} Commands**__", value="\u200b",
                                inline=False)  # Add a category header

            embed.add_field(name=f"> /{cmd['name']}", value=f"{cmd['description']}", inline=False)

        embed.set_footer(text=f"Page {self.current_page + 1}/{self.total_pages}")
        return embed

    def update_buttons(self):
        self.clear_items()
        self.add_item(self.PrevButton(self))
        self.add_item(self.NextButton(self))

    class PrevButton(discord.ui.Button):
        def __init__(self, parent_view):
            super().__init__(label="Previous", style=discord.ButtonStyle.primary,
                             disabled=(parent_view.current_page == 0))
            self.parent_view = parent_view

        async def callback(self, interaction: discord.Interaction):
            self.parent_view.current_page -= 1
            self.parent_view.update_buttons()
            await interaction.response.edit_message(embed=self.parent_view.get_current_page_embed(),
                                                    view=self.parent_view)

    class NextButton(discord.ui.Button):
        def __init__(self, parent_view):
            super().__init__(label="Next", style=discord.ButtonStyle.primary,
                             disabled=(parent_view.current_page == parent_view.total_pages - 1))
            self.parent_view = parent_view

        async def callback(self, interaction: discord.Interaction):
            self.parent_view.current_page += 1
            self.parent_view.update_buttons()
            await interaction.response.edit_message(embed=self.parent_view.get_current_page_embed(),
                                                    view=self.parent_view)


class EditCrewRoleView(discord.ui.View):
    def __init__(self, bot, crew_roles):
        super().__init__()
        self.bot = bot
        self.crew_roles = crew_roles
        self.add_item(self.CrewRoleSelect(self.bot, self.crew_roles))

    class CrewRoleSelect(discord.ui.Select):
        def __init__(self, bot, crew_roles):
            self.bot = bot
            options = []

            for cr in crew_roles:
                desc = cr.get("description", "")
                if len(desc) > 100:
                    desc = desc[:97] + ".."

                options.append(discord.SelectOption(
                    label=cr["name"],
                    description=desc,
                    emoji=cr.get("emoji") or None
                ))

            super().__init__(placeholder="Select a crew role to edit...", min_values=1, max_values=1, options=options)

        async def callback(self, interaction: discord.Interaction):
            from bot.utils.modals import CrewRoleModal
            selected_crew_role_name = self.values[0]
            selected_crew_role = next((cr for cr in self.view.crew_roles if cr["name"] == selected_crew_role_name),
                                      None)

            if selected_crew_role:
                modal = CrewRoleModal(self.bot, selected_crew_role)
                await interaction.response.send_modal(modal)
            else:
                await interaction.response.send_message("Could not find the selected crew role.", ephemeral=True)


class DeleteCrewRoleView(discord.ui.View):
    def __init__(self, bot, crew_roles):
        super().__init__()
        self.bot = bot
        self.crew_roles = crew_roles
        self.add_item(self.CrewRoleSelect(self.bot, self.crew_roles))

    class CrewRoleSelect(discord.ui.Select):
        def __init__(self, bot, crew_roles):
            self.bot = bot
            options = [
                discord.SelectOption(
                    label=cr["name"],
                    description=cr.get("description", ""),
                    emoji=cr.get("emoji") or None
                ) for cr in crew_roles
            ]
            super().__init__(placeholder="Select a crew role to delete...", min_values=1, max_values=1, options=options)

        async def callback(self, interaction: discord.Interaction):
            selected_crew_role_name = self.values[0]
            self.view.clear_items()
            self.view.add_item(self.view.ConfirmDeleteButton(self.bot, selected_crew_role_name))
            self.view.add_item(self.view.CancelDeleteButton())
            await interaction.response.edit_message(
                content=f"Are you sure you want to delete the crew role **{selected_crew_role_name}**?", view=self.view)

    class ConfirmDeleteButton(discord.ui.Button):
        def __init__(self, bot, crew_role_name):
            super().__init__(label="Confirm", style=discord.ButtonStyle.danger)
            self.bot = bot
            self.crew_role_name = crew_role_name

        async def callback(self, interaction: discord.Interaction):
            guild_id = interaction.guild.id
            guild_collection = self.bot.db[Db_Constant.GUILD_CONFIG_COLLECTION]
            guild_config = await guild_collection.find_one({"guild_id": guild_id})

            if not guild_config or "crew_roles" not in guild_config:
                await interaction.response.edit_message(content="No crew roles are configured to delete.", view=None)
                return

            initial_count = len(guild_config["crew_roles"])
            updated_crew_roles = [cr for cr in guild_config["crew_roles"] if
                                  cr["name"].lower() != self.crew_role_name.lower()]

            if len(updated_crew_roles) == initial_count:
                await interaction.response.edit_message(content=f"Crew role '{self.crew_role_name}' not found.",
                                                        view=None)
                return

            await guild_collection.update_one(
                {"guild_id": guild_id},
                {"$set": {"crew_roles": updated_crew_roles}}
            )
            await interaction.response.edit_message(content=f"Crew role '{self.crew_role_name}' deleted successfully!",
                                                    view=None)

    class CancelDeleteButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="Cancel", style=discord.ButtonStyle.secondary)

        async def callback(self, interaction: discord.Interaction):
            await interaction.response.edit_message(content="Deletion cancelled.", view=None)


class OnBoardingView(discord.ui.View):
    def __init__(self, user_id: int, user_collection: AsyncIOMotorCollection, bot: commands.Bot):
        super().__init__(timeout=None)
        self.user_id = user_id
        self.current_screen = 0
        self.total_screen = len(ONBOARDING_SCREENS)
        self.user_data = {}
        self.collection = user_collection
        self.bot = bot  # Inject bot instance

        self.update_buttons()

    def update_buttons(self):
        self.clear_items()

        back = self.BackButton(self)

        # Disable "Next" button if on screen 2 and user_data is empty
        disable_next = (
                self.current_screen >= self.total_screen - 1 or
                (self.current_screen == 2 and not self.user_data)
        )
        next_ = self.NextButton(self, disabled=disable_next)

        submit = self.SubmitButton(self)
        finish = self.FinishButton(self)

        self.add_item(back)
        self.add_item(next_)
        if self.current_screen == self.total_screen - 1:
            self.add_item(finish)
        if self.current_screen == 2:
            self.add_item(submit)

        # Screen 4: Portrait Configuration
        if self.current_screen == 3:  # Index 3 is now Verification, wait... let me check indices.
            pass  # Logic handled below based on accurate indexing

        # Re-evaluating indices based on new flow:
        # 0: Welcome
        # 1: Reg Unlock
        # 2: Intake (Submit Details)
        # 3: Portrait Config (Use Avatar/Upload) -> NEW
        # 4: ID Card Verify (Confirm/Retake) -> NEW
        # 5: System Overview -> Was index 6
        
        # Adjusting logic:
        if self.current_screen == 3:
            self.add_item(self.UseAvatarButton(self))
            self.add_item(self.UploadImageButton(self))

        if self.current_screen == 4:
            # Confirm handled by Next button
            pass

    async def update_state(self):
        await self.collection.update_one(
            {"_id": self.user_id},
            {"$set": {
                "onboarding": True,
                "citizen_name": self.user_data.get("citizen_name", None),
                "place_of_birth": self.user_data.get("place_of_birth", None),
                "citizenship": self.user_data.get("citizenship", None),
                "biography": self.user_data.get("biography", None),
                "profile_url": self.user_data.get("profile_url", None)
            }},
            upsert=True
        )

    async def generate_id_card_file(self):
        # Temp path setup
        base_path = f"temp/{self.user_id}_onboarding"
        os.makedirs(base_path, exist_ok=True)
        portrait_path = f"{base_path}/avatar.png"
        card_path = f"{base_path}/card.png"

        
        
        # Download portrait if URL exists
        url = self.user_data.get("profile_url")
        if url and url != "Not Set":
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(str(url)) as resp:
                        if resp.status == 200:
                            content = await resp.read()
                            with open(portrait_path, "wb") as f:
                                f.write(content)
                        else:
                            portrait_path = None
            except Exception as e:
                print(f"Error downloading avatar: {e}")
                portrait_path = None
        else:
            portrait_path = None

        # Render card
        try:
            await profile_card(
                profile_data=self.user_data,
                output_path=card_path,
                portrait_path=portrait_path,
                portrait_size=(110, 120),
                portrait_position=(300, 90),
                font_size=15
            )
        except Exception as e:
            logging.warning(f"Error rendering card: {e}")
            # Ensure cleanup if possible or let cleanup logic handle it
            pass

        return card_path, base_path

    # ────────────────────────────────
    # Portrait Buttons (Screen 4)
    # ────────────────────────────────
    class UseAvatarButton(discord.ui.Button):
        def __init__(self, parent_view):
            self.parent_view = parent_view
            super().__init__(label="Use Discord Avatar", style=discord.ButtonStyle.primary)

        async def callback(self, interaction: Interaction):
            # Get user's avatar URL
            avatar_url = interaction.user.display_avatar.url
            self.parent_view.user_data["profile_url"] = str(avatar_url)

            # Refresh page to show updated status
            embed = onboarding_screen(self.parent_view.current_screen, self.parent_view.user_data)
            self.parent_view.update_buttons()
            
            # Since we haven't responded yet, we can update the message directly via response.edit_message
            await interaction.response.edit_message(embed=embed, view=self.parent_view)
            
            # Optionally show ephemeral confirmation using followup if needed, but edit_message consumes the token.
            # So we can't send ephemeral confirmation easily unless we use defer.
            # But the UI update (Current Setting: URL) is feedback enough.

    class UploadImageButton(discord.ui.Button):
        def __init__(self, parent_view):
            self.parent_view = parent_view
            super().__init__(label="Upload Image", style=discord.ButtonStyle.secondary)

        async def callback(self, interaction: Interaction):
            # 1. Edit the current message to show the prompt
            # We replace the Onboarding UI with the prompt.
            await interaction.response.edit_message(
                content="**Please upload your image in the chat now (JPEG/PNG).**\nYou have 60 seconds.\n(The onboarding screen will return after duplicate checking.)",
                embed=None,
                view=None
            )

            def check(m):
                return m.author.id == interaction.user.id and m.channel.id == interaction.channel.id and m.attachments

            try:
                # Wait for message with attachment
                msg = await self.parent_view.bot.wait_for('message', check=check, timeout=60.0)
                attachment = msg.attachments[0]

                if not attachment.content_type.startswith('image/'):
                    # Restore view with error
                    embed = onboarding_screen(self.parent_view.current_screen, self.parent_view.user_data)
                    self.parent_view.update_buttons()
                    await interaction.edit_original_response(content="❌ That wasn't an image. Please try again.", embed=embed, view=self.parent_view)
                    
                    try:
                        await msg.delete()
                    except:
                        pass
                    return

                # Process upload
                temp_dir = f"temp/{interaction.guild.id}/{interaction.user.id}_upload"
                os.makedirs(temp_dir, exist_ok=True)
                temp_path = f"{temp_dir}/{attachment.filename}"

                await attachment.save(temp_path)

                # Delete user message immediately to keep chat clean
                try:
                    await msg.delete()
                except:
                    pass

                # Upload to Cloudinary
                public_id = await profile_public_id(user_id=interaction.user.id)
                new_url = await upload_profile_image(public_id=public_id, file_path=temp_path)

                # Cleanup temp
                if os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir)

                if new_url:
                    self.parent_view.user_data["profile_url"] = new_url
                    
                    # Refresh view with success
                    embed = onboarding_screen(self.parent_view.current_screen, self.parent_view.user_data)
                    self.parent_view.update_buttons()
                    
                    # Restore the UI
                    await interaction.edit_original_response(content="✅ Image uploaded successfully!", embed=embed, view=self.parent_view)
                else:
                    # Restore view with failure
                    embed = onboarding_screen(self.parent_view.current_screen, self.parent_view.user_data)
                    self.parent_view.update_buttons()
                    await interaction.edit_original_response(content="❌ Failed to upload image. Please try again.", embed=embed, view=self.parent_view)

            except asyncio.TimeoutError:
                # Restore view on timeout
                embed = onboarding_screen(self.parent_view.current_screen, self.parent_view.user_data)
                self.parent_view.update_buttons()
                await interaction.edit_original_response(content="❌ Time limit exceeded.", embed=embed, view=self.parent_view)
                
            except Exception as e:
                print(f"Upload error: {e}")
                # Restore view on error
                embed = onboarding_screen(self.parent_view.current_screen, self.parent_view.user_data)
                self.parent_view.update_buttons()
                await interaction.edit_original_response(content=f"❌ An error occurred: {e}", embed=embed, view=self.parent_view)

    # ────────────────────────────────
    # Back Button
    # ────────────────────────────────
    class BackButton(discord.ui.Button):
        def __init__(self, parent_view):
            self.parent_view = parent_view
            super().__init__(
                label="⬅ Back",
                style=discord.ButtonStyle.secondary,
                disabled=(parent_view.current_screen == 0)
            )

        async def callback(self, interaction: Interaction) -> Any:
            if interaction.user.id != self.parent_view.user_id:
                return await interaction.response.send_message("You can't control this view.", ephemeral=True)

            self.parent_view.current_screen -= 1
            embed = onboarding_screen(self.parent_view.current_screen, self.parent_view.user_data)
            self.parent_view.update_buttons()
            await interaction.response.edit_message(embed=embed, view=self.parent_view)

    # ────────────────────────────────
    # Next Button
    # ────────────────────────────────
    class NextButton(discord.ui.Button):
        def __init__(self, parent_view, disabled=False):
            self.parent_view = parent_view
            super().__init__(
                label=self.get_label(),
                style=discord.ButtonStyle.success,
                disabled=disabled
            )

        def get_label(self):
            if self.parent_view.current_screen == 4:  # ID Card Verify
                return "➡ Confirm & Finish"
            return "➡ Next"

        async def callback(self, interaction: Interaction) -> Any:
            if interaction.user.id != self.parent_view.user_id:
                return await interaction.response.send_message("You can't control this view.", ephemeral=True)

            self.parent_view.current_screen += 1

            # Special handling for ID Card Screen (Index 4)
            if self.parent_view.current_screen == 4:
                # Defer because image generation takes time
                await interaction.response.defer(ephemeral=True)

                try:
                    card_path, base_path = await self.parent_view.generate_id_card_file()
                    file = discord.File(card_path, filename="id_card.png")

                    embed = onboarding_screen(self.parent_view.current_screen, self.parent_view.user_data)
                    embed.set_image(url="attachment://id_card.png")

                    self.parent_view.update_buttons()
                    
                    # We must modify the message to include the attachment. 
                    # Use edit_original_response instead of message.edit to avoid Unknown Message errors after defer
                    await interaction.edit_original_response(embed=embed, view=self.parent_view, attachments=[file])

                    # Cleanup temp
                    if os.path.exists(base_path):
                        shutil.rmtree(base_path)

                except Exception as e:
                    print(f"Error generating card: {e}")
                    # await interaction.followup.send(f"Debug: generation failed - {e}", ephemeral=True)
                    try:
                        await interaction.edit_original_response(content="Error generating ID card. Please try again.",
                                                       view=self.parent_view)
                    except:
                        pass

                return

            embed = onboarding_screen(self.parent_view.current_screen, self.parent_view.user_data)
            self.parent_view.update_buttons()
            await interaction.response.edit_message(embed=embed, view=self.parent_view)

    # ────────────────────────────────
    # Profile Details Submit Button
    # ────────────────────────────────

    class SubmitButton(discord.ui.Button):
        def __init__(self, parent_view):
            self.parent_view = parent_view
            super().__init__(label="📝 Submit Details", disabled=(parent_view.current_screen != 2))

        async def callback(self, interaction: Interaction):
            if interaction.user.id != self.parent_view.user_id:
                return await interaction.response.send_message("You can not control this view", ephemeral=True)

            modal = OnBoardingDetailsSubmitModal(self.parent_view)
            await interaction.response.send_modal(modal)

    # ────────────────────────────────
    # Finish Button (only on last screen)
    # ────────────────────────────────
    class FinishButton(discord.ui.Button):
        def __init__(self, parent_view):
            self.parent_view = parent_view
            super().__init__(
                label="✅ Finish",
                style=discord.ButtonStyle.green,
                disabled=(parent_view.current_screen != parent_view.total_screen - 1)
            )

        async def callback(self, interaction: Interaction) -> Any:
            if interaction.user.id != self.parent_view.user_id:
                return await interaction.response.send_message("You can't control this view.", ephemeral=True)

            await self.parent_view.update_state()
            await interaction.response.send_message("🎉 You have completed onboarding!", ephemeral=True)

    async def on_timeout(self) -> None:
        pass


def onboarding_screen(index: int, user_data: dict = None) -> discord.Embed:
    if index == 3:  # Portrait Config
        current_url = user_data.get("profile_url", "Not Set")
        # Truncate if too long (simple check)
        if len(current_url) > 50:
            current_url = current_url[:47] + "..."
            
        return dos_style_embed_builder("CITIZEN PORTRAIT CONFIGURATION", f"""\
========================================================
             CITIZEN PORTRAIT CONFIGURATION
========================================================
Please configure your official identification portrait.

CURRENT SETTING: {current_url}

OPTIONS:
1. Use Discord Avatar: Auto-imports your current pfp.
2. Upload Image: Upload a custom file directly.

[✅] Next   |   [⬅] Back
==================================================
""")

    if index == 4: # ID Card Verification
        return dos_style_embed_builder("ID CARD VERIFICATION", f"""\
========================================================
               OFFICIAL ID CARD PREVIEW
========================================================
Please review your finalized identification card below.

Ensure all details are correct and the portrait is
visible and appropriate.

[✅] Confirm & Finish   |   [⬅] Go Back to edit.
==================================================
""")

    return ONBOARDING_SCREENS[index]


ONBOARDING_SCREENS = [

    dos_style_embed_builder("HOPEWELL CONTINUUM :: MISSION CONTROL SYSTEM", """\
=================================================
                     WELCOME, CITIZEN
=================================================
You are now interfacing with the Hopewell Continuum
Detachment Mission Control System.

To access fleet mission data and personnel files,
you must complete onboarding.

The onboarding process requires Citizens to divulge
certain details about their background and life history.
Criminal records are weighed but not immediately disqualifying.

Do you wish to proceed?   [✅] Next   |   [❌] No
==================================================
"""),

    dos_style_embed_builder("HOPEWELL CONTINUUM :: MISSION CONTROL SYSTEM", """\
========================================================
            REGISTRATION UNLOCKS THE FOLLOWING:
========================================================
• Host and join missions
• Reserve crew slots aboard ships
• Submit mission logs
• Earn and track Reputation Points (RP)

ACTION: Press ➡ to continue.
========================================================
"""),

    dos_style_embed_builder("HOPEWELL CONTINUUM :: MISSION CONTROL SYSTEM", """\
========================================================
         BORDER INTAKE FORM — SECTION 1
========================================================
As per UEE Customs Authority, the following are required:

• Citizen Name
• Place of Birth (select planet/moon)
• Planet of Citizenship
• Biography

Please enter this information using the "Submit Details" button below.
========================================================
"""),

    None,  # index 3 is dynamic (Portrait Config)
    None,  # index 4 is dynamic (ID Card Verify)

    dos_style_embed_builder("SYSTEM OVERVIEW", """\
========================================================
          COMMANDS UNLOCKED AFTER ONBOARDING:
========================================================
• /ships
• /view_ship
• /view_logs
• /registership
• /submit_logs
• /mycharacter
• /edit_character
• /help
========================================================
"""),

    dos_style_embed_builder("🌌 REPUTATION POINTS (RP) SYSTEM", """\
========================================================
      THE RP SYSTEM REWARDS MULTI-CREW GAMEPLAY
========================================================
• Hosting a Mission → +1 RP
• Filling a Crew Slot → +2 RP
• Submitting a Crew Log → +3 RP
• >70% Crew Fill Bonus → +3 RP

Higher RP = Greater trust and access.
ACTION: Press ➡ to view the rank progression matrix.
========================================================
"""),

    dos_style_embed_builder("HOPEWELL CONTINUUM :: RANK DESIGNATION MATRIX", """\
============================================
RP RANGE  | RANK TITLE             | EMOJI |
============================================
0–49      | Drifter                | 🕶️    |
50–149    | Signal-Seeker          | 📡    |
150–249   | Initiate               | 🧬    |
250–349   | Surveyor               | 🧭    |
350–449   | Pathbreaker            | 🛠️    |
450–599   | Flight Officer         | 🔫    |
600–749   | Senior Flight Officer  | 🦺    |
750–899   | Continuum Navigator    | 🧭    |
900–1099  | Detachment Marshal     | 📋    |
1500–1799 | Prime of 3 Vessels     | ⚓    |
2400–2699 | Hopewell Steward       | 🕊️    |
============================================
"""),

    dos_style_embed_builder("SHIP REGISTRATION REQUIRED", """\
========================================================
             SHIP REGISTRATION INITIATION
========================================================
• To participate fully in Hopewell Continuum missions,
  you must register your personal vessel(s).

• Initial Limit: You may register up to 2 ships.

• Rank-Based Unlock: Achieve Commander rank to
  unlock a 3rd ship slot.

• Automatic Naming: All ships will be prefixed
  with "HCS" → (Hopewell Continuum Ship).

ACTION: Use the /registership command to begin.
========================================================
""")
]


class MissionPaginationView(discord.ui.View):
    def __init__(self, missions: list[dict], bot, guild: discord.Guild, guild_config: dict, mission_archive_collection,
                 log_collection, items_per_page: int = 9):
        super().__init__(timeout=300)  # 5 minutes timeout
        self.missions = missions
        self.bot = bot
        self.guild = guild
        self.guild_config = guild_config
        self.mission_archive_collection = mission_archive_collection
        self.log_collection = log_collection
        self.items_per_page = items_per_page
        self.current_page = 0
        self.total_pages = (len(missions) + items_per_page - 1) // items_per_page
        self.showing_mission_details = False
        self.showing_logs = False
        self.current_mission_details = None

        self.update_buttons()

    def get_page_missions(self) -> list[dict]:
        """Get missions for the current page"""
        start_idx = self.current_page * self.items_per_page
        end_idx = start_idx + self.items_per_page
        return self.missions[start_idx:end_idx]

    def get_main_embed(self) -> discord.Embed:
        """Create the main pagination embed showing mission list"""
        from bot.core.response_messages import build_mission_completed_embed

        page_missions = self.get_page_missions()

        # Add page numbers starting from 1 for each page
        for i, mission in enumerate(page_missions):
            mission["display_number"] = i + 1

        embed = build_mission_completed_embed(missions=page_missions)
        embed.set_footer(text=f"Page {self.current_page + 1}/{self.total_pages} • Click number buttons to view details")
        return embed

    async def get_mission_details_embed(self, mission: dict) -> discord.Embed:
        """Create detailed embed for a specific mission"""
        from bot.core.response_messages import build_mission_summary_embed

        # Get mission from archive
        mission_doc = await self.mission_archive_collection.find_one({"_id": mission["_id"]})
        if not mission_doc:
            return discord.Embed(title="Error", description="Mission not found", color=discord.Color.red())

        # Use archived ship data directly (no need to fetch from ship collection)
        ships = []

        # Add primary ship from archived data
        if mission_doc.get("primary_ship"):
            ships.append(mission_doc["primary_ship"])

        # Add supporting ships from archived data
        for support_ship in mission_doc.get("supporting_ships", []):
            ships.append(support_ship)

        # Build the detailed embed
        embed = await build_mission_summary_embed(mission_doc, ships, self.guild, self.guild_config)
        embed.set_footer(text=f"Mission Details • Click 'Back to List' to return or 'Check Logs' to view logs")
        return embed

    async def get_mission_logs_embed(self, mission: dict) -> discord.Embed:
        """Create logs embed for a specific mission"""
        from bot.core.response_messages import dos_style_embed_builder, create_box, format_block, create_line

        # Get logs for this mission
        logs = await self.log_collection.find({"mission_id": mission["_id"]}).to_list(length=None)

        if not logs:
            text = (
                    f"[TRANSMISSION INCOMING...] >> [31mMISSION LOGS[0m\n"
                    + create_box("NO LOGS FOUND")
                    + format_block([
                ("MISSION:", mission.get("title", "Unknown Mission")),
                ("STATUS:", "NO LOG ENTRIES SUBMITTED")
            ])
                    + create_line()
                    + "📝 No crew members have submitted logs for this mission yet."
            )
            embed = dos_style_embed_builder(title="", reason_block=text)
            return embed

        # Build logs display
        text = (
                f"[TRANSMISSION INCOMING...] >> [31mMISSION LOGS[0m\n"
                + create_box(f"MISSION: {mission.get('title', 'Unknown Mission').upper()}")
        )

        for i, log_entry in enumerate(logs, 1):
            user_id = log_entry.get("user_id")
            member = self.guild.get_member(int(user_id)) if user_id else None
            user_name = member.display_name if member else f"User ID: {user_id}"

            log_content = log_entry.get("log", "No log content")
            timestamp = log_entry.get("timestamp")

            # Format timestamp if available
            time_str = timestamp.strftime("%Y-%m-%d %H:%M UTC") if timestamp else "Unknown Time"

            log_fields = [
                ("LOG ENTRY:", f"#{i}"),
                ("SUBMITTED BY:", user_name.upper()),
                ("TIMESTAMP:", time_str),
                ("CONTENT:", log_content)
            ]

            text += format_block(log_fields)
            text += create_line()

        text += "📋 End of mission logs."

        embed = dos_style_embed_builder(title="", reason_block=text)
        embed.set_footer(text="Mission Logs • Click 'Back to Details' to return")
        return embed

    def update_buttons(self):
        """Update the view with appropriate buttons"""
        self.clear_items()

        if self.showing_logs:
            # Show only back to details button when viewing logs
            self.add_item(self.BackToDetailsButton())
        elif self.showing_mission_details:
            # Show back to list and check logs buttons when viewing mission details
            self.add_item(self.BackToListButton())
            self.add_item(self.CheckLogsButton())
            self.add_item(self.DeleteMissionButton())
        else:
            # Show navigation buttons in first row (only if multiple pages)
            if self.total_pages > 1:
                self.add_item(self.FirstPageButton())
                self.add_item(self.PreviousPageButton())
                self.add_item(self.NextPageButton())
                self.add_item(self.LastPageButton())

            # Add mission number buttons for current page (distribute across rows)
            page_missions = self.get_page_missions()

            for i, mission in enumerate(page_missions):
                mission_number = i + 1  # Start from 1 on each page
                # Calculate row: first 5 buttons in row 1, next 4 in row 2
                button_row = 1 if i < 5 else 2
                self.add_item(self.MissionButton(mission_number, mission, button_row))

    class FirstPageButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="⏮️", style=discord.ButtonStyle.secondary, row=0)

        async def callback(self, interaction: discord.Interaction):
            if self.view.current_page == 0:
                await interaction.response.defer()
                return

            self.view.current_page = 0
            self.view.update_buttons()
            embed = self.view.get_main_embed()
            await interaction.response.edit_message(embed=embed, view=self.view)

    class PreviousPageButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="⏪", style=discord.ButtonStyle.secondary, row=0)

        async def callback(self, interaction: discord.Interaction):
            if self.view.current_page <= 0:
                await interaction.response.defer()
                return

            self.view.current_page -= 1
            self.view.update_buttons()
            embed = self.view.get_main_embed()
            await interaction.response.edit_message(embed=embed, view=self.view)

    class NextPageButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="⏩", style=discord.ButtonStyle.secondary, row=0)

        async def callback(self, interaction: discord.Interaction):
            if self.view.current_page >= self.view.total_pages - 1:
                await interaction.response.defer()
                return

            self.view.current_page += 1
            self.view.update_buttons()
            embed = self.view.get_main_embed()
            await interaction.response.edit_message(embed=embed, view=self.view)

    class LastPageButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="⏭️", style=discord.ButtonStyle.secondary, row=0)

        async def callback(self, interaction: discord.Interaction):
            if self.view.current_page == self.view.total_pages - 1:
                await interaction.response.defer()
                return

            self.view.current_page = self.view.total_pages - 1
            self.view.update_buttons()
            embed = self.view.get_main_embed()
            await interaction.response.edit_message(embed=embed, view=self.view)

    class MissionButton(discord.ui.Button):
        def __init__(self, mission_number: int, mission: dict, row: int = 1):
            # Use number emojis for buttons 1-9
            number_emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"]
            emoji = number_emojis[mission_number - 1] if mission_number <= 9 else f"{mission_number}"

            super().__init__(emoji=emoji, style=discord.ButtonStyle.primary, row=row)
            self.mission = mission
            self.mission_number = mission_number

        async def callback(self, interaction: discord.Interaction):
            await interaction.response.defer()

            self.view.showing_mission_details = True
            self.view.current_mission_details = self.mission
            self.view.update_buttons()

            embed = await self.view.get_mission_details_embed(self.mission)
            await interaction.edit_original_response(embed=embed, view=self.view)

    class BackToListButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="⬅️ Back to List", style=discord.ButtonStyle.secondary)

        async def callback(self, interaction: discord.Interaction):
            self.view.showing_mission_details = False
            self.view.showing_logs = False
            self.view.current_mission_details = None
            self.view.update_buttons()

            embed = self.view.get_main_embed()
            await interaction.response.edit_message(embed=embed, view=self.view)

    class CheckLogsButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="📋 Check Logs", style=discord.ButtonStyle.primary)

        async def callback(self, interaction: discord.Interaction):
            await interaction.response.defer()

            self.view.showing_logs = True
            self.view.update_buttons()

            embed = await self.view.get_mission_logs_embed(self.view.current_mission_details)
            await interaction.edit_original_response(embed=embed, view=self.view)

    class BackToDetailsButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="⬅️ Back to Details", style=discord.ButtonStyle.secondary)

        async def callback(self, interaction: discord.Interaction):
            await interaction.response.defer()

            self.view.showing_logs = False
            self.view.update_buttons()

            embed = await self.view.get_mission_details_embed(self.view.current_mission_details)
            await interaction.edit_original_response(embed=embed, view=self.view)

    class DeleteMissionButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="🗑️ Delete Mission", style=discord.ButtonStyle.danger)

        async def callback(self, interaction: discord.Interaction):
            # Create confirmation view
            confirm_view = DeleteMissionConfirmView(self.view.current_mission_details, self.view)

            mission_name = self.view.current_mission_details.get("name", "Unknown Mission")
            embed = discord.Embed(
                title="⚠️ Confirm Mission Deletion",
                description=f"Are you sure you want to delete the mission **{mission_name}**?\n\n"
                            f"**This action will:**\n"
                            f"• Delete the mission permanently\n"
                            f"• Delete all associated mission logs\n"
                            f"• Cannot be undone\n\n"
                            f"Please confirm your choice below.",
                color=discord.Color.red()
            )

            await interaction.response.edit_message(embed=embed, view=confirm_view)

    async def on_timeout(self):
        """Disable all buttons when the view times out"""
        for item in self.children:
            item.disabled = True


class DeleteMissionConfirmView(discord.ui.View):
    def __init__(self, mission: dict, parent_view: MissionPaginationView):
        super().__init__(timeout=60)  # 1 minute timeout for confirmation
        self.mission = mission
        self.parent_view = parent_view

    @discord.ui.button(label="✅ Yes, Delete", style=discord.ButtonStyle.danger)
    async def confirm_delete(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer()

        try:
            # Delete all logs for this mission
            logs_result = await self.parent_view.log_collection.delete_many({"mission_id": self.mission["_id"]})

            # Delete the mission from archive
            mission_result = await self.parent_view.mission_archive_collection.delete_one({"_id": self.mission["_id"]})

            if mission_result.deleted_count > 0:
                # Remove mission from parent view's missions list
                self.parent_view.missions = [m for m in self.parent_view.missions if m["_id"] != self.mission["_id"]]

                # Recalculate pagination
                self.parent_view.total_pages = (
                                                           len(self.parent_view.missions) + self.parent_view.items_per_page - 1) // self.parent_view.items_per_page

                # Adjust current page if necessary
                if self.parent_view.current_page >= self.parent_view.total_pages and self.parent_view.total_pages > 0:
                    self.parent_view.current_page = self.parent_view.total_pages - 1

                # Reset view state
                self.parent_view.showing_mission_details = False
                self.parent_view.showing_logs = False
                self.parent_view.current_mission_details = None
                self.parent_view.update_buttons()

                # Create success embed
                mission_name = self.mission.get("name", "Unknown Mission")
                embed = discord.Embed(
                    title="✅ Mission Deleted Successfully",
                    description=f"Mission **{mission_name}** and {logs_result.deleted_count} associated log(s) have been deleted.",
                    color=discord.Color.green()
                )

                # If no missions left, show empty state
                if len(self.parent_view.missions) == 0:
                    embed = discord.Embed(
                        title="📋 No Missions Found",
                        description="All missions have been deleted. No completed missions to display.",
                        color=discord.Color.light_grey()
                    )
                    await interaction.edit_original_response(embed=embed, view=None)
                else:
                    # Show updated mission list
                    list_embed = self.parent_view.get_main_embed()
                    await interaction.edit_original_response(embed=list_embed, view=self.parent_view)

                # Send confirmation message
                await interaction.followup.send(embed=embed, ephemeral=True)
            else:
                # Mission not found
                embed = discord.Embed(
                    title="❌ Error",
                    description="Mission not found or already deleted.",
                    color=discord.Color.red()
                )
                await interaction.edit_original_response(embed=embed, view=None)

        except Exception as e:
            # Handle any errors during deletion
            embed = discord.Embed(
                title="❌ Deletion Failed",
                description=f"An error occurred while deleting the mission: {str(e)}",
                color=discord.Color.red()
            )
            await interaction.edit_original_response(embed=embed, view=None)

    @discord.ui.button(label="❌ Cancel", style=discord.ButtonStyle.secondary)
    async def cancel_delete(self, interaction: discord.Interaction, button: discord.ui.Button):
        # Return to mission details view
        self.parent_view.update_buttons()
        embed = await self.parent_view.get_mission_details_embed(self.parent_view.current_mission_details)
        await interaction.response.edit_message(embed=embed, view=self.parent_view)

    async def on_timeout(self):
        """Handle timeout by returning to mission details"""
        try:
            self.parent_view.update_buttons()
            embed = await self.parent_view.get_mission_details_embed(self.parent_view.current_mission_details)
            # Note: This will only work if the original interaction is still valid
        except:
            pass  # Ignore errors if interaction has expired
