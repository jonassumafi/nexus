import logging
import math
import os
import shutil
from typing import override

import aiohttp
import discord
from discord.ext import commands
from motor.motor_asyncio import AsyncIOMotorCollection

from bot.cogs.mission.mission_view import GenericMissionView
from bot.cogs.profile.profile_card import profile_card
from bot.cogs.profile.profile_image import profile_public_id, get_resource_info, delete_resource, upload_profile_image
from bot.core.constant import Db_Constant
from bot.core.models.modal_schema import ModalFieldSchema
from bot.utils.embeds import dos_style_embed_builder
from bot.utils.helepr import _resolve_handle
from bot.utils.modals import GenericModal



class Character(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.db = self.bot.db
        self.guild_collection: AsyncIOMotorCollection = self.db[Db_Constant.GUILD_CONFIG_COLLECTION]
        self.user_collection: AsyncIOMotorCollection = self.db[Db_Constant.USER]



    @commands.hybrid_command(
        name="mycharacter",
        description="View your character information and mission stats",
    )
    async def mycharacter(self, ctx: commands.Context, member: discord.Member = None):
        await ctx.defer()

        if member is None:
            member = ctx.author

        # Example: rp handler cog usage — keep original behaviour if you have it
        rp_handler_cog = self.bot.get_cog("RpHandler")
        try:
            if rp_handler_cog:
                members_rp = await rp_handler_cog.compute_all_player_ranks(guild_id=ctx.guild.id)
                logging.info(f"RP Calculated for {members_rp}")
        except Exception as e:
            logging.error(f"Failed to calculate rp for members: {e}")

        # Fetch user data from DB
        user_data = await self.user_collection.find_one({"_id": member.id})
        if not user_data:
            await ctx.send(
                "No character data found. Please complete onboarding first.",
                ephemeral=True,
            )
            return

        # Prepare temp path
        base_path = f"temp/{ctx.guild.id}/{member.id}"
        portrait_path = f"{base_path}/avatar.png"
        profile_card_path = f"{base_path}/profile_card.png"
        os.makedirs(base_path, exist_ok=True)

        avatar_url = ""
        url = user_data.get("profile_url")
        if url:
            avatar_url = url
        else:
            avatar_url =ctx.author.display_avatar.url

        try:
            if avatar_url:
                async with aiohttp.ClientSession() as session:
                    async with session.get(str(avatar_url)) as resp:
                        if resp.status == 200:
                            with open(portrait_path, "wb") as f:
                                f.write(await resp.read())
                        else:
                            logging.warning(
                                f"Could not download avatar, status {resp.status}. Will render without portrait.")
                            portrait_path = None
        except Exception as e:
            logging.error(f"Failed to download avatar: {e}")
            portrait_path = None



        # Render profile card
        try:
            await profile_card(
                profile_data=user_data,
                output_path=profile_card_path,
                portrait_path=portrait_path,
                portrait_size=(110, 120),
                portrait_position=(300, 90),
                font_size=15,
            )
        except Exception as e:
            logging.error(f"Failed to render profile card: {e}")
            # attempt to clean and bail out
            if os.path.exists(base_path):
                try:
                    shutil.rmtree(base_path)
                except Exception as rm_e:
                    logging.error(f"Failed to remove temp after render failure: {rm_e}")
            await ctx.send("Failed to generate profile card.", ephemeral=True)
            return

        # Send the image (ephemeral)
        try:
            file = discord.File(profile_card_path, filename="profile_card.png")
            await ctx.send(file=file, ephemeral=True)
            logging.info(f"Sent profile card for {member.id}")
        except Exception as send_err:
            logging.error(f"Failed to send profile card: {send_err}")
            # fallback: send a message saying file send failed
            try:
                await ctx.send("Failed to send profile card image.", ephemeral=True)
            except Exception:
                pass
        finally:
            # Clean up the temp folder
            try:
                if os.path.exists(base_path):
                    shutil.rmtree(base_path)
                    logging.info(f"Removed temp folder: {base_path}")
            except Exception as rm_err:
                logging.error(f"Failed to remove temp folder {base_path}: {rm_err}")

    @commands.hybrid_command(name="upload_profile_image", description="Upload profile image for character card")
    async def upload_profile_image(self, ctx: commands.Context, image: discord.Attachment):
        await ctx.defer()

        if not image:
            await ctx.send("No profile image provided.", ephemeral= True)
            return

        if not image.content_type.startswith("image/"):
            await ctx.send("Profile image must be an image.", ephemeral=True)
            return
        public_id = await profile_public_id(user_id=ctx.author.id)

        # Delete existing
        existing_image = await get_resource_info(public_id= public_id)
        if existing_image:
            del_resp = await delete_resource(public_id= public_id)
            if del_resp.get("result") not in ["ok", "not found"]:
                await ctx.send(f"Failed to delete profile image: {del_resp}", ephemeral= True)
                return

        # Download the image to a temporary file
        temp_dir = f"temp/{ctx.guild.id}/{ctx.author.id}"
        os.makedirs(temp_dir, exist_ok=True)
        temp_path = f"{temp_dir}/{image.filename}"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(image.url) as resp:
                    if resp.status == 200:
                        with open(temp_path, "wb") as f:
                            f.write(await resp.read())
                    else:
                        await ctx.send(f"Failed to download profile image, status {resp.status}", ephemeral= True)
                        return
        except Exception as e:
            logging.error(f"Download error: {e}")
            await ctx.send("Failed to download your image.", ephemeral=True)
            return
        new_url = None
        try:
            new_url = await upload_profile_image(public_id=public_id, file_path=temp_path)
        except Exception as e:
            logging.error(f"Failed to upload profile image: {e}")
            new_url = None
            await ctx.send("Failed to upload your image.", ephemeral=True)
            return
        finally:
            try:
                if os.path.exists(temp_dir):
                    import shutil
                    shutil.rmtree(temp_dir)
            except Exception as e:
                logging.error(f"Failed to remove temp folder: {temp_dir}: {e}")

        await self.user_collection.update_one(
            {"_id": ctx.author.id},
            {"$set":{"profile_url": new_url}},
            upsert=True
        )

        embed = discord.Embed(title="Profile Image Uploaded", description="Profile Image Uploaded", color=discord.Color.green())
        embed.set_image(url=new_url)
        await ctx.send(embed=embed)



    @commands.hybrid_command(
        name="edit_character", description="Edit your server roleplay character"
    )
    async def edit_character(self, ctx: commands.Context):

        user_doc = await self.user_collection.find_one({"_id": ctx.author.id})
        if not user_doc:
            await ctx.send(f"You are an unknown citizen", ephemeral=True)
            return

        text_fields = [
            ModalFieldSchema(
                label="Citizen Designation",
                placeholder="e.g., Kara Morrow, Aidan Kallis, Thorne-918",
                required=True,
                max_length=50,
                default=user_doc.get("citizen_name", ""),
                custom_id=f"{ctx.author.id}_citizen_name",
            ),
            ModalFieldSchema(
                label="UEE Registered Birthplace (City)",
                placeholder="e.g., ArcCorp, Terra, Earth, MicroTech",
                required=True,
                max_length=50,
                default=user_doc.get("citizenship", ""),
                custom_id=f"{ctx.author.id}_citizenship",
            ),
            ModalFieldSchema(
                label="Citizen Biography",
                placeholder="e.g., Born on Terra, served in UEE Navy, now freelance pilot in Stanton",
                required=True,
                style=2,
                max_length=300,
                default=(user_doc.get("biography") or "")[:300],
                custom_id=f"{ctx.author.id}_biography",
            ),
        ]

        modal = GenericModal(
            title="Update Character",
            fields=text_fields,
            custom_id=f"{ctx.author.id}_update_character",
            on_submit_callback=self.on_update_character_modal_submit,
        )
        await ctx.interaction.response.send_modal(modal)

    async def on_update_character_modal_submit(
            self, interaction: discord.Interaction, children: list[discord.ui.TextInput]
    ):
        await interaction.response.defer(ephemeral=True)
        try:
            modal_custom_id = interaction.data.get("custom_id", "")
            if modal_custom_id != f"{interaction.user.id}_update_character":
                await interaction.followup.send("Invalid modal ID.", ephemeral=True)
                return

            update_data = {}
            for field in children:
                if field.custom_id == f"{interaction.user.id}_citizen_name":
                    update_data["citizen_name"] = field.value
                elif field.custom_id == f"{interaction.user.id}_citizenship":
                    update_data["citizenship"] = field.value
                elif field.custom_id == f"{interaction.user.id}_biography":
                    update_data["biography"] = field.value

            if not update_data:
                await interaction.followup.send("No data to update.", ephemeral=True)
                return

            await self.user_collection.update_one(
                {"_id": interaction.user.id}, {"$set": update_data}
            )

            await interaction.followup.send(
                "✅ Your character information has been updated!", ephemeral=True
            )

        except Exception as e:
            print(f"An error occurred when updating the character: {e}")
            if not interaction.response.is_done():
                await interaction.followup.send(
                    "❌ Failed to update your character. Please try again",
                    ephemeral=True,
                )

    def _format_row(
            self,
            rank_no: int,
            handle: str,
            total_rp: int,
            next_threshold: str,
            rank_emoji: str,
            rank_title: str,
            max_width: int
    ):
        """
        Build single aligned row with dot leaders.
        Example: 001) ➤ Eric The Red ...... 184 / 300 – 🛡️ Captain
        """
        handle = (handle or "Unknown")[:16]
        left = f"{rank_no:03} ➤ \u001b[36m{handle:<16}\u001b[0m"
        # Avoid f-string quote nesting issues by using explicit fallback values
        emoji_part = rank_emoji or ""
        title_part = rank_title or ""
        right = f"{total_rp} / {next_threshold} - {emoji_part} {title_part}".strip()

        dots_count = max(2, max_width - (len(left) + len(right)))
        dots = " " * dots_count
        total_text = f"{left}{dots}{right}"

        return f"{total_text}\n\n"

    async def build_character_list_block(
            self,
            guild_id: int,
            max_width: int,
            page: int = 1,
            per_page: int = 25,

    ) -> str:
        rp_handler_cog = self.bot.get_cog("RpHandler")

        # Use users-based page (fast)
        rows = await rp_handler_cog.fetch_leaderboard_page(guild_id=guild_id, page=page, per_page=per_page)

        lines = []
        lines.append("[TRANSMISSION INCOMING...] >> CHARACTER REGISTRY")
        lines.append("=" * max_width)
        # create_box already returns borders, so just use the title line rather than double-borders
        lines.append("| HOPEWELL PERSONNEL INDEX |".center(max_width))
        lines.append("=" * max_width)

        start_rank = (page - 1) * per_page + 1
        guild: discord.Guild = self.bot.get_guild(guild_id)



        for i, doc in enumerate(rows):
            rank_no = start_rank + i
            # now doc has '_id' because fetch_leaderboard_page returns that
            player_id = doc["_id"]

            try:
                player_id_int = int(player_id)
            except Exception:
                player_id_int = player_id  # keep as-is if not convertible

            total_rp = int(doc.get("total_rp", 0))
            user = doc.get("user") or {}

            handle = await _resolve_handle(guild, player_id_int, user)
            # prefer rank fields from user.rp_rank if present
            rp_rank = user.get("rp_rank") or {}
            next_threshold = rp_rank.get("max_rp")
            next_threshold_display = str(next_threshold) if next_threshold is not None else "MAX"
            rank_emoji = rp_rank.get("emoji", "")
            rank_title = rp_rank.get("title", "")

            row = self._format_row(
                rank_no=rank_no,
                handle=handle,
                total_rp=total_rp,
                next_threshold=next_threshold_display,
                rank_emoji=rank_emoji,
                rank_title=rank_title,
                max_width=max_width
            )

            lines.append(row)

        # footer and nav hint
        lines.append("-" * max_width)
        lines.append("Use ⬅️ ➡️ to change pages. Try /mycharacter for your profile.")
        return "\n".join(lines)

    def _make_character_embed(self, title: str, block_text: str, footer_text: str = None,
                              color: discord.Color = discord.Color.red()):
        """
        Use your dos_style_embed_builder to build final embed.
        The builder wraps the block_text inside a ```ansi codeblock already, so pass raw block.
        """
        return dos_style_embed_builder(title=title, reason_block=block_text, color=color, footer_text=footer_text)

    # ------- View with paging buttons using your GenericMissionView -------

    async def _get_leaderboard_total_count(self, guild_id: int) -> int:
        """
        Return number of rows for the leaderboard.
        Modify the filter if you need guild-scoped counts.
        """
        # If your users are global and you want to count all users:
        filter_doc = {}

        # If you keep per-guild rp inside users as rp_by_guild.<guild_id>, use:
        # gid_str = str(guild_id)
        # filter_doc = {f"rp_by_guild.{gid_str}.total_rp": {"$exists": True}}

        # If you use a separate player_ranks collection per guild, query that collection instead.
        total = await self.user_collection.count_documents(filter_doc)
        return int(total)

    class CharacterListView(GenericMissionView):
        def __init__(self, cog, guild_id: int, max_width: int, page: int = 1, per_page: int = 25,
                     timeout: float | None = 120):
            super().__init__(timeout=timeout)
            self.cog = cog
            self.guild_id = guild_id
            self.page = page
            self.per_page = per_page
            self.max_width = max_width

            # compute total pages (async, but we can schedule it via create_task or call sync in init caller)
            # We'll set defaults and call refresh_paging() after creation from the command.
            self.total_pages = 1

            # Create buttons now (we'll update enabled/disabled state in refresh_paging)
            self.prev_button = discord.ui.Button(label="⬅️ Prev", style=discord.ButtonStyle.secondary,
                                                 custom_id=f"char_prev_{id(self)}")
            self.refresh_button = discord.ui.Button(label="🔄 Refresh", style=discord.ButtonStyle.primary,
                                                    custom_id=f"char_refresh_{id(self)}")
            self.next_button = discord.ui.Button(label="➡️ Next", style=discord.ButtonStyle.secondary,
                                                 custom_id=f"char_next_{id(self)}")

            # assign callbacks
            self.prev_button.callback = self.on_prev
            self.refresh_button.callback = self.on_refresh
            self.next_button.callback = self.on_next

            # add items
            self.add_item(self.prev_button)
            self.add_item(self.refresh_button)
            self.add_item(self.next_button)

        async def refresh_paging(self):
            """
            Recompute total_pages and update button disabled states.
            Call this whenever the view is created or refreshed.
            """
            total = await self.cog._get_leaderboard_total_count(self.guild_id)
            self.total_pages = max(1, math.ceil(total / self.per_page))

            # update disabled states
            self.prev_button.disabled = self.page <= 1
            self.next_button.disabled = self.page >= self.total_pages

        async def update_message(self, interaction_or_message):
            """Rebuild embed for current page and update the message (works for both message or interaction)."""
            # Refresh paging info before building block so button states are correct
            await self.refresh_paging()

            block = await self.cog.build_character_list_block(self.guild_id, page=self.page, per_page=self.per_page,
                                                              max_width=self.max_width)
            embed = self.cog._make_character_embed(title="HOPEWELL PERSONNEL INDEX", block_text=block,
                                                   footer_text=f"Page {self.page} / {self.total_pages}")

            if isinstance(interaction_or_message, discord.Interaction):
                try:
                    await interaction_or_message.response.edit_message(embed=embed, view=self)
                except Exception:
                    await interaction_or_message.edit_original_response(embed=embed, view=self)
            else:
                await interaction_or_message.edit(embed=embed, view=self)

        async def on_prev(self, interaction: discord.Interaction):
            await interaction.response.defer()
            if self.page <= 1:
                return
            self.page -= 1
            await self.update_message(interaction)

        async def on_next(self, interaction: discord.Interaction):
            await interaction.response.defer()
            # refresh total_pages before deciding
            await self.refresh_paging()
            if self.page >= self.total_pages:
                return
            self.page += 1
            await self.update_message(interaction)

        async def on_refresh(self, interaction: discord.Interaction):
            await interaction.response.defer()
            # keep same page but recompute paging & data
            await self.update_message(interaction)

    # ------- command to show character list -------
    @commands.hybrid_command(name="character_list", description="Show character registry (public).")
    async def character_list(self, ctx: commands.Context, page: int = 1):
        await ctx.defer()
        guild_id = ctx.guild.id if ctx.guild else None
        if guild_id is None:
            await ctx.send("This command must be used in a guild.", ephemeral=True)
            return

        block = await self.build_character_list_block(guild_id=guild_id, page=page, per_page=25, max_width=50)
        embed = self._make_character_embed(title="HOPEWELL PERSONNEL INDEX", block_text=block,
                                           footer_text=f"Page {page}")
        view = self.CharacterListView(self, guild_id=guild_id, page=page, per_page=25, max_width=50)
        await view.refresh_paging()  # ensure total_pages computed and buttons correct
        await ctx.send(embed=embed, view=view)

