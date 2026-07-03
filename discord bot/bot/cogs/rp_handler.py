import asyncio
import re
import discord
from bson import ObjectId
from discord.ext import commands
from motor.motor_asyncio import AsyncIOMotorCollection
from pymongo import UpdateOne, ReturnDocument
from discord import app_commands
from bot import TIMEZONE
from bot.core.constant import Db_Constant, VALID_POINT_KEYS
from bot.core.models.database_models import RPLedger, ShipRPLedger
from bot.core.models.modal_schema import ModalFieldSchema
from bot.core.response_messages import general_transmission
from bot.utils.checks import is_admin
from bot.utils.embeds import dos_style_embed_builder
from bot.utils.helepr import is_emoji, dots_count
from bot.utils.modals import GenericModal
from datetime import datetime, timedelta

from bot.utils.time import to_local


class RpHandler(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.db = self.bot.db
        self.rp_setting_collection: AsyncIOMotorCollection = self.db[Db_Constant.RP_SETTING_COLLECTION]
        self.rp_ledger: AsyncIOMotorCollection = self.db[Db_Constant.RP_LEDGER]
        self.ship_rp_ledger: AsyncIOMotorCollection = self.db[Db_Constant.SHIP_RP_LEDGER]
        self.guild_collection: AsyncIOMotorCollection = self.db[Db_Constant.GUILD_CONFIG_COLLECTION]
        self.user_collection: AsyncIOMotorCollection = self.db[Db_Constant.USER]

    # ----------------- admin commands (unchanged) -----------------
    @commands.hybrid_command(name="add_rp", description="Add a new rp level")
    @is_admin()
    async def add_rp(self, ctx: commands.Context):
        fields = [
            ModalFieldSchema(
                label="Rank Title",
                placeholder="Enter RP Rank Title",
                required=True,
                max_length=30,
                style=1,
                custom_id="rank_title"
            ),
            ModalFieldSchema(
                label="Rp Range Min",
                placeholder="Set a minimum rp range for this level",
                required=True,
                max_length=30,
                style=1,
                custom_id="rank_range_min"
            ),
            ModalFieldSchema(
                label="Rp Range Max",
                placeholder="Set a maximum rp range for this level",
                required=False,
                max_length=30,
                style=1,
                custom_id="rank_range_max"
            ),
            ModalFieldSchema(
                label="Emoji",
                placeholder="Set a emoji to represent this rank",
                required=False,
                max_length=2,
                style=1,
                custom_id="emoji"
            )
        ]

        modal = GenericModal(
            title="Add Rp",
            fields=fields,
            custom_id=f"rp_modal",
            timeout=None,
            on_submit_callback=self.on_rp_modal_submit
        )

        await ctx.interaction.response.send_modal(modal)

    async def on_rp_modal_submit(self, interaction: discord.Interaction, children: list[discord.ui.TextInput]):
        await interaction.response.defer()

        custom_id = interaction.data.get("custom_id")
        max_rp = None
        min_rp = None
        rank_title = None
        emoji = None
        for text_field in children:
            if text_field.custom_id == "rank_range_max":
                max_rp = int(text_field.value)
            elif text_field.custom_id == "rank_range_min":
                min_rp = int(text_field.value)
            elif text_field.custom_id == "rank_title":
                rank_title = text_field.value
            elif text_field.custom_id == "emoji":
                emoji = text_field.value

        if max_rp and min_rp:
            if max_rp < 0 and min_rp < 0:
                await interaction.followup.send(f"RP Range can not be less than 0", ephemeral=True)
                return
            elif min_rp > max_rp:
                await interaction.followup.send(f"Min rp can not be greater than max rp", ephemeral=True)
                return

        # --- NEW: overlap check (minimal) ---
        overlap = await self.guild_collection.find_one(
            {
                "guild_id": interaction.guild.id,
                "rp_details": {
                    "$elemMatch": {
                        # existing.min_rp <= new.max_rp
                        "min_rp": {"$lte": max_rp},
                        # and (existing.max_rp is None OR existing.max_rp >= new.min_rp)
                        "$or": [{"max_rp": None}, {"max_rp": {"$gte": min_rp}}]
                    }
                }
            },
            projection={"_id": 1, "rp_details.$": 1}
        )

        if overlap:
            existing = overlap.get("rp_details", [{}])[0]
            title = existing.get("title", "an existing rank")
            er_min = existing.get("min_rp")
            er_max = existing.get("max_rp", "∞")
            await interaction.followup.send(
                f"Range overlap: **{min_rp}–{max_rp}** conflicts with **{title} ({er_min}–{er_max})**.",
                ephemeral=True
            )
            return

        if emoji and not is_emoji(emoji, interaction.guild):
            await interaction.followup.send(
                f"❌ The emoji you entered is invalid. Please enter a valid standard or custom emoji.",
                ephemeral=True,
            )
            return

        rp_name_exist = await self.guild_collection.find_one({
            "guild_id": interaction.guild.id,
            "rp_details.title": {
                "$regex": f"^{re.escape(rank_title)}$",
                "$options": "i"
            }
        })
        if rp_name_exist:
            await interaction.followup.send(f"Duplicate entry not allowed: {rank_title} already exists.")
            return

        try:
            update = {
                "min_rp": min_rp,
                "max_rp": max_rp,
                "title": rank_title,
                "emoji": emoji,
                "unlocks": []
            }

            db_update = await self.guild_collection.update_one(
                {"guild_id": interaction.guild.id},
                {
                    "$push": {"rp_details": update}
                },
                upsert=True
            )

            if db_update.modified_count > 0 or db_update.upserted_id:
                await interaction.followup.send(f"✅ **{rank_title}** added successfully.", ephemeral=True)
            else:
                await interaction.followup.send(
                    f"Nothing changed. **{rank_title}** may already exist or the document is identical.",
                    ephemeral=True
                )
        except Exception as e:
            await interaction.followup.send(
                f"Database error while saving **{rank_title}**. Details: `{type(e).__name__}`",
                ephemeral=True
            )

    @commands.hybrid_command(name="add_rp_rewards", description="Add rewards to an existing rp")
    @is_admin()
    async def app_rp_rewards(self, ctx: commands.Context, rp_name: str, rewards: str):
        await ctx.defer()

        title_filter = {
            "$regex": f"^{re.escape(rp_name)}$",
            "$options": "i"
        }

        rp_doc_exist = await self.guild_collection.find_one(
            {"guild_id": ctx.guild.id, "rp_details.title": title_filter},
            projection={"_id": 1}
        )
        if not rp_doc_exist:
            await ctx.send(f"**{rp_name}** not found in the database.", ephemeral=True)
            return

        rewards_list = [r.strip() for r in re.split(r"[|,]", rewards) if r.strip()]
        if not rewards_list:
            await ctx.send("Please provide at least one reward (comma or | separated).", ephemeral=True)
            return

        result = await self.guild_collection.update_one(
            {"guild_id": ctx.guild.id, "rp_details.title": title_filter},
            {"$addToSet": {"rp_details.$.unlocks": {"$each": rewards_list}}}
        )

        if result.modified_count > 0:
            await ctx.send(f"✅ Added reward(s) to **{rp_name}**: {', '.join(rewards_list)}", ephemeral=True)
        else:
            await ctx.send(f"ℹ️ No changes. The provided reward(s) may already exist for **{rp_name}**.",
                           ephemeral=True)

    @commands.hybrid_command(name="delete_rp", description="Delete an RP rank from the database")
    @is_admin()
    async def delete_rp(self, ctx: commands.Context, rp_name: str):
        await ctx.defer()

        title_filter = {
            "$regex": f"^{re.escape(rp_name)}$",
            "$options": "i"
        }

        rp_doc_exist = await self.guild_collection.find_one(
            {"guild_id": ctx.guild.id, "rp_details.title": title_filter},
            projection={"_id": 1, "rp_details.$": 1}
        )

        if not rp_doc_exist:
            await ctx.send(f"❌ **{rp_name}** not found in the database.", ephemeral=True)
            return

        result = await self.guild_collection.update_one(
            {"guild_id": ctx.guild.id},
            {"$pull": {"rp_details": {"title": title_filter}}}
        )

        if result.modified_count > 0:
            await ctx.send(f"🗑️ Successfully deleted **{rp_name}** from RP list.", ephemeral=True)
        else:
            await ctx.send(f"⚠️ Could not delete **{rp_name}**. Please try again.", ephemeral=True)

    @commands.hybrid_command(name="view_rp", description="View all rp ranks in the database")
    @is_admin()
    async def view_rp(self, ctx: commands.Context):
        await ctx.defer()

        guild_doc = await self.guild_collection.find_one({"guild_id": ctx.guild.id})
        if not guild_doc or not guild_doc.get("rp_details"):
            await ctx.send("No RP ranks found in the database.", ephemeral=True)
            return

        rp_details = sorted(guild_doc["rp_details"], key=lambda x: x.get("min_rp", 0))

        footer_lines = []
        for rp in rp_details:
            title = rp.get('title', 'N/A')
            emoji = rp.get('emoji', '')
            min_rp = rp.get('min_rp', 0)
            max_rp = rp.get('max_rp', '∞')
            unlocks = rp.get('unlocks', [])
            unlocks_str = ", ".join(unlocks) if unlocks else "None"
            
            dots = dots_count(left_text=f"{emoji} {title}", right_text=f"{min_rp} - {max_rp}", max_width=40)
            
            footer_lines.append(f"{emoji} {title} {'.' * dots} {min_rp} - {max_rp}")
            footer_lines.append(f"  Unlocks: {unlocks_str}")
            footer_lines.append("") # for a new line

        reason_block = general_transmission(
            transmission="RP Ranks",
            box_text="CURRENT RP RANK LIST",
            is_line=False,
            footer=footer_lines
        )

        embed = dos_style_embed_builder(
            title="",
            reason_block=reason_block
        )

        await ctx.send(embed=embed, ephemeral=True)

    @commands.hybrid_command(name="edit_rp", description="Edit an existing rp level")
    @is_admin()
    async def edit_rp(self, ctx: commands.Context, rp_name: str):

        guild_doc = await self.guild_collection.find_one(
            {"guild_id": ctx.guild.id, "rp_details.title": rp_name},
            {"rp_details.$": 1}
        )

        if not guild_doc or not guild_doc.get("rp_details"):
            await ctx.send(f"RP rank '{rp_name}' not found.", ephemeral=True)
            return

        rp_data = guild_doc["rp_details"][0]

        fields = [
            ModalFieldSchema(
                label="Rank Title",
                custom_id="rank_title",
                style=1,
                default=rp_data.get("title", ""),
                required=True,
            ),
            ModalFieldSchema(
                label="Rp Range Min",
                custom_id="rank_range_min",
                style=1,
                default=str(rp_data.get("min_rp", "")),
                required=True,
            ),
            ModalFieldSchema(
                label="Rp Range Max",
                custom_id="rank_range_max",
                style=1,
                default=str(rp_data.get("max_rp", "")),
                required=False,
            ),
            ModalFieldSchema(
                label="Emoji",
                custom_id="emoji",
                style=1,
                default=rp_data.get("emoji", ""),
                required=False,
            ),
        ]

        modal = GenericModal(
            title=f"Edit RP Rank: {rp_name}",
            fields=fields,
            custom_id=f"rp_edit_modal:{rp_data.get('title')}",
            on_submit_callback=self.on_rp_edit_modal_submit,
            timeout=None
        )
        await ctx.interaction.response.send_modal(modal)



    async def on_rp_edit_modal_submit(self, interaction: discord.Interaction, children: list[discord.ui.TextInput]):
        await interaction.response.defer(ephemeral=True)
        
        original_title = interaction.data["custom_id"].split(":")[1]

        new_values = {}
        for item in children:
            new_values[item.custom_id] = item.value

        update_payload = {
            "rp_details.$.title": new_values["rank_title"],
            "rp_details.$.min_rp": int(new_values["rank_range_min"]),
            "rp_details.$.max_rp": int(new_values["rank_range_max"]) if new_values["rank_range_max"] else None,
            "rp_details.$.emoji": new_values["emoji"],
        }

        result = await self.guild_collection.update_one(
            {"guild_id": interaction.guild.id, "rp_details.title": original_title},
            {"$set": update_payload}
        )

        if result.modified_count > 0:
            await interaction.followup.send(f"Successfully updated RP rank '{original_title}'.", ephemeral=True)
        else:
            await interaction.followup.send("Failed to update RP rank.", ephemeral=True)

    @edit_rp.autocomplete("rp_name")
    async def rp_name_autocomplete(self, interaction: discord.Interaction, current: str) -> list[app_commands.Choice[str]]:
        guild_doc = await self.guild_collection.find_one({"guild_id": interaction.guild.id})
        if not guild_doc or not guild_doc.get("rp_details"):
            return []

        rp_titles = [rp["title"] for rp in guild_doc["rp_details"]]
        
        return [
            app_commands.Choice(name=title, value=title)
            for title in rp_titles if current.lower() in title.lower()
        ]

    # ---------- READ / SHOW ----------
    @commands.hybrid_command(name="rp_points_view", description="Show current RP settings")
    @is_admin()
    async def rp_points_view(self, ctx: commands.Context):
        await ctx.defer()
        rp_doc = await self.rp_setting_collection.find_one({"guild_id": ctx.guild.id})
        if not rp_doc:
            await ctx.send("ℹ️ No RP settings found. Use `/rp_settings_create` to create defaults.")
            return

        points = rp_doc.get("points", {})
        crew_fill = points.get("crew_fill", {})
        min_crew = crew_fill.get("min",{})
        max_crew = crew_fill.get("max",{})

        launch_mission_dots = dots_count(left_text="Launch Mission", right_text="+1", max_width=40)
        crew_slot_dots = dots_count(left_text="Fill Crew Slot", right_text="+1-2", max_width=40)
        after_action_dots = dots_count(left_text="After-Action Log", right_text="+1", max_width=40)
        crew_rewards_threshold_dots = dots_count(left_text="Crew Fill Threshold", right_text="50-70%", max_width=40)
        ship_fill_bonous_dots = dots_count(left_text=f"Ship Fill Bonus (≥ %{rp_doc.get('threshold', '—')})", right_text="+1", max_width=40)

        reason_block = general_transmission(
            transmission="RP CONFIG - POINTS VIEW",
            box_text="CURRENT POINTS VALUES",
            is_line=False,
            footer=[
                f">> PLAYER EVENTS\n",
                f"Launch Mission {"." * launch_mission_dots} +{points.get("MISSION_LAUNCHED", "-")}",
                f"Fill Crew Slot {"." * crew_slot_dots} +{min_crew.get("points",1)}-{max_crew.get("points",2)}",
                f"Crew Fill Threshold {"." * crew_rewards_threshold_dots} {min_crew.get("threshold", "-")}-{max_crew.get("threshold","-")}%",
                f"After-Action Log {"." * after_action_dots} +{points.get("AFTERMATH_LOG", "-")}",
                f"\n>> SHIP EVENTS\n",
                f"Ship Fill Bonus (≥ %{rp_doc.get('threshold', '—')}) {"." * ship_fill_bonous_dots} +{points.get("SHIP_FILL_BONUS", "-")}",
            ]
        )

        updated_at = to_local(rp_doc.get('updated_at', '—')).strftime("%Y-%m-%d %H:%M")
        embed = dos_style_embed_builder(
            title="",
            reason_block=reason_block,
            footer_text=f"{updated_at}"
        )
        await ctx.send(embed=embed, ephemeral=True)

    # ---------- UPDATE: a single point key ----------
    @commands.hybrid_command(name="rp_settings_set_point", description="Set a single RP point by keys(MISSION_LAUNCHED,AFTERMATH_LOG, SHIP_FILL_BONUS)")
    @is_admin()
    async def rp_settings_set_point(self, ctx: commands.Context, key: str, value: int):
        await ctx.defer()
        key_u = key.upper()
        if key_u not in VALID_POINT_KEYS:
            await ctx.send(
                f"❌ Invalid key. Choose one of: {', '.join(sorted(VALID_POINT_KEYS))}"
            )
            return
        if value < 0:
            await ctx.send("❌ Value must be a non-negative integer.")
            return

        updated_by = f"{ctx.author} ({ctx.author.id})"
        result = await self.rp_setting_collection.update_one(
            {"guild_id": ctx.guild.id},
            {
                "$set": {
                    f"points.{key_u}": value,
                    "updated_by": updated_by,
                    "updated_at": datetime.now(TIMEZONE),
                    "reason": f"Updated {key_u}",
                }
            },
            upsert=True
        )

        if result.modified_count > 0 or result.upserted_id:
            await ctx.send(f"✅ `{key_u}` set to **{value}**.")
        else:
            await ctx.send(f"Failed to update RP Settings or value already set", ephemeral=True)

    @rp_settings_set_point.autocomplete(name="key")
    async def rp_key_autocomplete(self, interaction: discord.Interaction, current: str):
        return [
            app_commands.Choice(name=k, value=k)
            for k in VALID_POINT_KEYS if current.upper() in k
        ]


    @commands.hybrid_command(name="ship_fill_threshold", description="Set a single RP point key")
    @is_admin()
    async def ship_fill_threshold(self, ctx: commands.Context, threshold: int):
        await ctx.defer()

        if threshold < 0:
            await ctx.send("❌ Value must be a non-negative integer.")
            return

        updated_by = f"{ctx.author} ({ctx.author.id})"
        result = await self.rp_setting_collection.update_one(
            {"guild_id": ctx.guild.id},
            {
                "$set": {
                    "updated_by": updated_by,
                    "updated_at": datetime.now(TIMEZONE),
                    "reason": f"Updated threshold",
                    "threshold": threshold
                }
            },
            upsert=True
        )

        if result.modified_count > 0 or result.upserted_id:
            await ctx.send(f"✅ Ship fill rate threshold updated: `{threshold}%`", ephemeral=True)
        else:
            await ctx.send(f"Failed to update threshold or value already set", ephemeral=True)

    @commands.hybrid_command(name="crew_fill_range", description="Enter a crew fill range in this format: min:50, max:70.")
    @is_admin()
    async def crew_fill_range(self, ctx: commands.Context, min_range: int, max_range: int):
        await ctx.defer()

        # Validate bounds
        if min_range < 0 or max_range > 100:
            await ctx.send("❌ Values must be between 0 and 100.", ephemeral=True)
            return
        if min_range >= max_range:
            await ctx.send("❌ Min must be less than max (e.g. `50-70`).", ephemeral=True)
            return

        # Save to DB (upsert guild settings)
        update = await self.rp_setting_collection.update_one(
            {"guild_id": ctx.guild.id},
            {"$set": {
                "points.crew_fill.min.threshold": min_range,
                "points.crew_fill.max.threshold": max_range,
            }},
            upsert=True
        )

        if update.modified_count > 0 or update.upserted_id:
            await ctx.send(f"✅ Crew fill range set to **{min_range}-{max_range}%**.", ephemeral=True)
        else:
            # sometimes update.modified_count == 0 when document existed and values were identical
            await ctx.send(f"✅ Crew fill range saved (no changes detected). Current: **{min_range}-{max_range}%**.",
                           ephemeral=True)

    @commands.hybrid_command(name="crew_fill_points", description="This points will be given when a crew fill threshold reach.")
    @is_admin()
    async def crew_fill_points(self, ctx: commands.Context, min_point: int, max_points: int):
        await ctx.defer()

        # Validate bounds
        if min_point < 0:
            await ctx.send("❌ Values must be greater than 0.", ephemeral=True)
            return
        if min_point >= max_points:
            await ctx.send("❌ Min must be less than max.", ephemeral=True)
            return

        # Use dot notation so we only set points fields
        update = await self.rp_setting_collection.update_one(
            {"guild_id": ctx.guild.id},
            {"$set": {
                "points.crew_fill.min.points": min_point,
                "points.crew_fill.max.points": max_points
            }},
            upsert=True
        )

        if update.modified_count > 0 or update.upserted_id:
            await ctx.send(f"✅ Crew fill points set to **{min_point}-{max_points}**.", ephemeral=True)
        else:
            # sometimes update.modified_count == 0 when document existed and values were identical
            await ctx.send(f"✅ Crew fill points saved (no changes detected). Current: **{min_point}-{max_points}**.",
                           ephemeral=True)

    # ---------- DELETE ----------

    @commands.hybrid_command(name="delete_all_srp_details", description="Delete all RP title, points and emojis")
    @is_admin()
    async def delete_all_rp_details(self, ctx: commands.Context):
        await ctx.defer(ephemeral=True)

        await ctx.send("Are you sure you want to delete all the rp points, titles and emojis?. Reply yes or no.",ephemeral=True)

        def check(message: discord.Message):
            return (
                message.author == ctx.author
                and message.channel == ctx.channel
                and message.content.lower() in  ["yes", "no"]
            )
        try:
            msg: discord.Message = await self.bot.wait_for("message", check = check, timeout= 60.0)
        except asyncio.TimeoutError:
            await ctx.send(f"You did not reply in time. Cancelled", ephemeral=True)
            return

        if msg.content.lower() == "yes":
            # Run your deletion logic here

            delete = await self.guild_collection.update_one(
                {"guild_id": ctx.guild.id},
                {
                    "$set" :{
                        "rp_details" : []
                    }
                }
            )

            if delete.modified_count > 0 or delete.upserted_id:
                await ctx.send(f"✅ All RP details have been deleted.", ephemeral=True)
            else:
                await ctx.send(f"No rp details found")

        else:
            await ctx.send("❌ Cancelled.", ephemeral=True)




    @commands.hybrid_command(name="rp_settings_delete", description="Delete RP settings document")
    @is_admin()
    async def rp_settings_delete(self, ctx: commands.Context):
        await ctx.defer()
        result = await self.rp_setting_collection.delete_one({"guild_id": ctx.guild.id})
        if result.deleted_count > 0:
            await ctx.send("🗑️ RP settings deleted.")
        else:
            await ctx.send("ℹ️ No RP settings document found to delete.")

    async def get_rp_points_from_db(self, event_key: str):
        rp_doc_list = await self.rp_setting_collection.find({}).to_list(length=None)

        rp_doc = rp_doc_list[0] if rp_doc_list else None
        if not rp_doc:
            return 0

        return rp_doc.get("points", {}).get(f"{event_key.upper()}", 0)

    # ------------------------RP Event Functions------------------------#
    async def add_rp_for_mission_launch(self, player_id: int, guild_id: int, mission_id: ObjectId):
        points = await self.get_rp_points_from_db(event_key="MISSION_LAUNCHED")

        insert_rp = await self.rp_ledger.insert_one(
            RPLedger(
                player_id=player_id,
                mission_id=mission_id,
                event_code="MISSION_LAUNCH",
                points=points,
                guild_id=guild_id,
                applied_ts=datetime.now(tz=TIMEZONE)
            ).model_dump(mode="python")
        )

        if insert_rp.inserted_id:
            # increment user's total and update rank atomically
            await self.increment_user_rp_and_update_rank(guild_id=guild_id, player_id=player_id, points=points)
            return True
        return False

    async def add_rp_for_crew_slot_filled(
            self,
            guild_id: int,
            player_id: int,
            mission_id: ObjectId,
            ship_id: ObjectId,
            crew_fill_percent: int,
    ) -> dict:
        """Compact, safe: returns {'ok': bool, 'points': int, 'msg': str}."""

        # sanitize input
        try:
            crew_fill = max(0, min(100, int(crew_fill_percent)))
        except Exception:
            crew_fill = 0

        # load config (safe fallback)
        cfg = await self.rp_setting_collection.find_one({"guild_id": guild_id}) or {}
        crew_cfg = (cfg.get("points") or {}).get("crew_fill", {})
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

        # fix swapped thresholds
        if min_th > max_th:
            min_th, max_th = max_th, min_th

        # decide points
        if crew_fill < min_th:
            points = 0
        elif crew_fill <= max_th:
            points = min_pts
        else:
            points = max_pts


        # insert ledger and update rank, handle DB errors
        try:
            res = await self.rp_ledger.insert_one(
                RPLedger(
                    player_id=player_id,
                    mission_id=mission_id,
                    event_code="CREW_SLOT_FILLED",
                    points=points,
                    ship_id=ship_id,
                    guild_id=guild_id,
                    applied_ts=datetime.now(tz=TIMEZONE)
                ).model_dump(mode="python")
            )
        except Exception as e:
            return {"ok": False, "points": 0, "msg": f"❌ DB error: {e}"}

        if not getattr(res, "inserted_id", None):
            return {"ok": False, "points": 0, "msg": "❌ Ledger write failed."}

        # award and return
        await self.increment_user_rp_and_update_rank(guild_id=guild_id, player_id=player_id, points=points)
        return {"ok": True, "points": points, "player_id": player_id}


    async def add_rp_for_aftermath_log(self, guild_id: int, player_id: int, mission_id: ObjectId) -> tuple[int, bool]:
        points = await self.get_rp_points_from_db(event_key="AFTERMATH_LOG")
        insert_rp = await self.rp_ledger.insert_one(
            RPLedger(
                player_id=player_id,
                mission_id=mission_id,
                event_code="AFTERMATH_LOG",
                points=points,
                guild_id=guild_id,
                applied_ts=datetime.now(tz=TIMEZONE)
            ).model_dump(mode="python")
        )
        is_inserted = insert_rp.inserted_id is not None

        if is_inserted:
            await self.increment_user_rp_and_update_rank(guild_id=guild_id, player_id=player_id, points=points)

        return points, is_inserted

    async def add_rp_for_ship_fill_bonus(self, guild_id: int, ship_id: ObjectId, mission_id: ObjectId):
        points = await self.get_rp_points_from_db(event_key="SHIP_FILL_BONUS")
        insert_rp = await self.rp_ledger.insert_one(
            RPLedger(
                ship_id=ship_id,
                mission_id=mission_id,
                event_code="SHIP_FILL_BONUS",
                points=points,
                guild_id=guild_id,
                applied_ts=datetime.now(tz=TIMEZONE)
            ).model_dump(mode="python")
        )
        return insert_rp.inserted_id is not None

    async def award_ship_fill_bonus(
            self,
            ship_id: ObjectId,
            mission_id: ObjectId,
            guild_id: int,
            capacity_at_launch: int,
            filled_at_launch: int,
            role: str = "PRIMARY"
    ) -> int:
        settings = await self.rp_setting_collection.find({}).to_list(length=None)
        rp_doc = settings[0] if settings else None
        if not rp_doc:
            return 0

        threshold = rp_doc.get("threshold", 75)
        bonus_points = rp_doc.get("points", {}).get("SHIP_FILL_BONUS", 0)

        if capacity_at_launch <= 0:
            return 0
        fill_rate = round((filled_at_launch / capacity_at_launch) * 100)

        if fill_rate < threshold:
            return 0

        doc = ShipRPLedger(
            ship_id=ship_id,
            mission_id=mission_id,
            role=role,
            guild_id=guild_id,
            capacity_at_launch=capacity_at_launch,
            filled_at_launch=filled_at_launch,
            fill_rate=fill_rate,
            points_awarded=bonus_points,
            awarded_ts=datetime.now(tz=TIMEZONE),
            threshold_snapshot=threshold
        ).model_dump(mode="python")
        await self.ship_rp_ledger.insert_one(doc)
        return bonus_points

    # ----------------- ranking helpers -----------------
    async def load_rp_details_for_guild(self, guild_id: int) -> list:
        guild_doc = await self.guild_collection.find_one({"guild_id": guild_id})
        if not guild_doc:
            return []

        rp_details = guild_doc.get("rp_details", [])
        rp_details.sort(key=lambda d: (d.get("min_rp", 0) or 0))
        return rp_details

    async def get_player_total_rp_from_ledger(self, player_id: int, guild_id: int | None = None) -> int:
        """
        Sum points from rp_ledger for a given player (optionally scoped to guild).
        Returns integer total RP (0 if no entries).
        """
        match = {"player_id": player_id}
        if guild_id is not None:
            match["guild_id"] = guild_id

        pipeline = [
            {"$match": match},
            {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$points", 0]}}}}
        ]
        cursor = self.rp_ledger.aggregate(pipeline, allowDiskUse=True)
        docs = await cursor.to_list(length=1)
        total = int(docs[0]["total"]) if docs else 0
        return total

    def rank_for_total(self, total_rp: int, rp_details: list) -> dict:
        # synchronous helper — no need for async here
        matched = None
        for rp in rp_details:
            min_rp = rp.get("min_rp") or 0
            max_rp = rp.get("max_rp")

            if total_rp >= min_rp and (max_rp is None or total_rp <= max_rp):
                matched = rp

        if matched is None:
            matched = rp_details[0] if rp_details else {"title": "Unknown", "emoji": "", "min_rp": 0, "max_rp": 0}

        return {
            "title": matched.get("title"),
            "emoji": matched.get("emoji"),
            "min_rp": matched.get("min_rp"),
            "max_rp": matched.get("max_rp"),
            "unlocks": matched.get("unlocks", [])
        }

    async def compute_all_player_ranks(self, guild_id: int, upsert_batch_size: int = 500) -> int:
        """
        Bulk recompute: aggregates rp_ledger -> updates users collection.
        Use when you change thresholds or for initial population.
        """
        rp_details = await self.load_rp_details_for_guild(guild_id=guild_id)

        pipeline = [
            {"$match": {"guild_id": guild_id}},
            {"$group": {
                "_id": "$player_id",
                "total_rp": {"$sum": "$points"}
            }},
        ]
        cursor = self.rp_ledger.aggregate(pipeline, allowDiskUse=True)

        operations = []
        count = 0
        async for doc in cursor:
            player_id = int(doc["_id"])
            total_rp = int(doc.get("total_rp", 0))
            rank = self.rank_for_total(total_rp, rp_details)

            update_doc = {
                "$set": {
                    "total_rp": total_rp,
                    "rp_rank": {
                        "title": rank["title"],
                        "emoji": rank["emoji"],
                        "min_rp": rank["min_rp"],
                        "max_rp": rank["max_rp"],
                        "unlocks": rank.get("unlocks", [])
                    },
                    "rp_updated_ts": datetime.now(tz=TIMEZONE)
                }
            }

            operations.append(UpdateOne({"_id": player_id}, update_doc, upsert=True))
            count += 1

            if len(operations) >= upsert_batch_size:
                await self.user_collection.bulk_write(operations, ordered=False)
                operations = []

        if operations:
            await self.user_collection.bulk_write(operations, ordered=False)

        return count

    async def get_player_total_rp(self, player_id: int, guild_id: int) -> int:
        """
        Fast read: returns cached total_rp from user doc.
        Use compute_all_player_ranks() or incremental updates to populate/cache values.
        """
        user_doc = await self.user_collection.find_one({"_id": player_id})
        if not user_doc:
            return 0

        total_rp = user_doc.get("total_rp", 0)
        try:
            return int(total_rp)
        except Exception:
            return 0

    async def increment_user_rp_and_update_rank(self, guild_id: int, player_id: int, points: int):
        """
        Atomically increments the user's total_rp and updates the rp_rank fields according to guild rp_details.
        Call this after inserting a ledger entry to keep user doc in sync.
        """
        if points == 0:
            return None

        # Atomically increment and return the updated document
        updated_user = await self.user_collection.find_one_and_update(
            {"_id": player_id},
            {
                "$inc": {"total_rp": points},
                "$setOnInsert": {"_id": player_id},
                "$set": {"rp_updated_ts": datetime.now(tz=TIMEZONE)}
            },
            upsert=True,
            return_document=ReturnDocument.AFTER
        )

        total_rp = int(updated_user.get("total_rp", 0))
        rp_details = await self.load_rp_details_for_guild(guild_id=guild_id)
        rank = self.rank_for_total(total_rp, rp_details)

        await self.user_collection.update_one(
            {"_id": player_id},
            {"$set": {
                "rp_rank": {
                    "title": rank["title"],
                    "emoji": rank["emoji"],
                    "min_rp": rank["min_rp"],
                    "max_rp": rank["max_rp"],
                    "unlocks": rank.get("unlocks", [])
                },
                "rp_updated_ts": datetime.now(tz=TIMEZONE)
            }}
        )

        return total_rp

    async def get_player_rank(self, player_id: int) -> dict:
        player_doc = await self.user_collection.find_one({"_id": player_id})

        if not player_doc:
            return {}
        rp_rank = player_doc.get("rp_rank")
        if not rp_rank:
            return {}

        return rp_rank

    async def get_player_30_days_rp_change(self, player_id: int, guild_id: int | None = None) -> dict:
        now = datetime.now(tz=TIMEZONE)
        end = now

        start_last = now - timedelta(days=30)
        start_prev = now - timedelta(days=60)
        end_prev = start_last

        # Build batch base

        base_match = {"player_id": player_id}
        if guild_id is not None:
            base_match["guild_id"] = guild_id

        match_last = {
            **base_match,
            "applied_ts": {"$gte": start_last, "$lt": end}
        }

        cursor_last = self.rp_ledger.aggregate([
            {"$match": match_last},
            {"$group": {"_id": None, "sum": {"$sum": {"$ifNull": ["$points", 0]}}}}
        ], allowDiskUse=True)
        last_doc = await cursor_last.to_list(length=1)
        last_sum = int(last_doc[0]["sum"]) if last_doc else 0

        # Aggregate sum for previous 30 days
        match_prev = {
            **base_match,
            "applied_ts": {"$gte": start_prev, "$lt": end_prev}
        }
        cursor_prev = self.rp_ledger.aggregate([
            {"$match": match_prev},
            {"$group": {"_id": None, "sum": {"$sum": {"$ifNull": ["$points", 0]}}}}
        ], allowDiskUse=True)
        prev_doc = await cursor_prev.to_list(length=1)
        prev_sum = int(prev_doc[0]["sum"]) if prev_doc else 0

        absolute_change = last_sum - prev_sum
        if prev_sum == 0:
            percent_change = None
        else:
            percent_change = round((absolute_change / prev_sum) * 100, 2)

        return {
            "player_id": player_id,
            "guild_id": guild_id,
            "period_end": end,
            "last_30_days": last_sum,
            "prev_30_days": prev_sum,
            "absolute_change": absolute_change,
            "percent_change": percent_change
        }

    async def get_ship_rp_stats(self, ship_id: ObjectId, guild_id: int) -> dict:
        """
        Returns lifetime stats for a ship:
        - total_points (sum of points_awarded)
        - avg_fill_rate (average of fill_rate)
        - max_fill_rate (highest fill_rate)
        """
        pipeline = [
            {"$match": {"ship_id": ship_id, "guild_id": guild_id}},
            {"$group": {
                "_id": None,
                "total_points": {"$sum": "$points_awarded"},
                "avg_fill_rate": {"$avg": "$fill_rate"},
                "max_fill_rate": {"$max": "$fill_rate"}
            }}
        ]
        cursor = self.ship_rp_ledger.aggregate(pipeline)
        docs = await cursor.to_list(length=1)

        if not docs:
            return {
                "total_points": 0,
                "avg_fill_rate": 0.0,
                "max_fill_rate": 0.0
            }

        doc = docs[0]
        return {
            "total_points": int(doc.get("total_points", 0)),
            "avg_fill_rate": round(float(doc.get("avg_fill_rate", 0.0)), 2),
            "max_fill_rate": float(doc.get("max_fill_rate", 0.0))
        }

    async def get_all_ship_rp_stats(self, guild_id: int) -> list[dict]:
        """
        Returns lifetime stats for all ships in a guild.
        """
        pipeline = [
            {"$match": {"guild_id": guild_id}},
            {"$group": {
                "_id": "$ship_id",
                "total_points": {"$sum": "$points_awarded"},
                "avg_fill_rate": {"$avg": "$fill_rate"},
            }},
            {
                "$lookup": {
                    "from": "ships",  # The name of the ship collection
                    "localField": "_id",
                    "foreignField": "_id",
                    "as": "ship_info"
                }
            },
            {
                "$unwind": "$ship_info"
            },
            {
                "$project": {
                    "ship_id": "$_id",
                    "total_points": 1,
                    "avg_fill_rate": 1,
                    "ship_name": "$ship_info.ship_name",
                    "missions_completed": "$ship_info.missions_completed"
                }
            }
        ]
        cursor = self.ship_rp_ledger.aggregate(pipeline)
        return await cursor.to_list(length=None)

    async def fetch_leaderboard_page(self, guild_id: int, page: int = 1, per_page: int = 25):
        """
        Fast: read users collection sorted by total_rp descending.
        Returns list of docs shaped like aggregation output:
        { "_id": <player_id>, "total_rp": <int>, "user": <user_doc> }
        """
        skip = (page - 1) * per_page
        cursor = self.user_collection.find(
            {},  # optionally add a guild filter if you have per-guild users
            projection={"total_rp": 1, "rp_rank": 1, "citizen_name": 1, "missions_completed": 1}
        ).sort("total_rp", -1).skip(skip).limit(per_page)

        results = []
        async for doc in cursor:
            # doc is the user document; we want an object similar to aggregation shape
            results.append({
                "_id": doc.get("_id"),
                "total_rp": int(doc.get("total_rp", 0)),
                "user": doc
            })
        return results

    @commands.hybrid_command(name="rp_30d_change",
                             description="Show a player's RP change compared to the previous 30-day window")
    async def rp_30d_change(self, ctx: commands.Context, player: discord.Member = None):
        await ctx.defer()
        if not player:
            player = ctx.author

        rp_change = await self.get_player_30_days_rp_change(player_id=player.id, guild_id=ctx.guild.id)
        if not rp_change:
            await ctx.send(f"You have not earned any rp yet..!")
            return

        await ctx.send(f"{rp_change.get("absolute_change")}")


async def setup(bot):
    await bot.add_cog(RpHandler(bot))
