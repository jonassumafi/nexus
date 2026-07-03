import asyncio
import logging
import traceback
from datetime import datetime, timedelta, timezone

import discord
from bson import ObjectId
from discord.ext import commands
from motor.motor_asyncio import AsyncIOMotorCollection
from pymongo.asynchronous.collection import ReturnDocument

from bot import TIMEZONE, openai_client
from bot.cogs.mission import mission_view, mission_modals as modals
from bot.cogs.mission.mission_view import GenericMissionView
from bot.core import response_messages
from bot.core.constant import Db_Constant
from bot.core.mission_state import MissionState
from bot.core.models.buttonSchema import ButtonSchema
from bot.core.models.modal_schema import ModalFieldSchema
from bot.core.models.database_models import Missions
from bot.core.response_messages import (
    build_post_mission_dm_embed,
    build_mission_complete_embed,
)
from bot.utils.checks import is_admin, is_guild_owner
from bot.utils.embeds import dos_style_embed_builder
from bot.utils.helepr import delayed_send_messages
from bot.utils.modals import GenericModal
from bot.utils.time import to_local


class MissionCommands(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.mission_collection: AsyncIOMotorCollection = self.bot.db[
            Db_Constant.MISSION
        ]
        self.ship_collection: AsyncIOMotorCollection = self.bot.db[Db_Constant.SHIP]
        self.guild_collection: AsyncIOMotorCollection = self.bot.db[
            Db_Constant.GUILD_CONFIG_COLLECTION
        ]
        self.user_collection: AsyncIOMotorCollection = self.bot.db[Db_Constant.USER]
        self.mission_archive_collection: AsyncIOMotorCollection = self.bot.db[
            Db_Constant.MISSION_ARCHIVE
        ]
        self.log_collection: AsyncIOMotorCollection = self.bot.db[
            Db_Constant.LOG_COLLECTION
        ]
        self.rp_settings_collection: AsyncIOMotorCollection = self.bot.db[
            Db_Constant.RP_SETTING_COLLECTION
        ]

        self.bot.scheduler.add_job(self.clear_expired_missions, "interval", hours=1, id="clear_expired_missions_job")
        self.bot.scheduler.add_job(self.post_mission_summary, "interval", hours=72, id="mission_summary_job")
        self.bot.scheduler.add_job(self.clear_queue_expired_missions, "interval", minutes=5, id="clear_queue_expired_missions_job")



    async def post_mission_summary(self):
        try:
            # filter in UTC (Mongo stores UTC datetimes)
            since_utc = datetime.now(timezone.utc) - timedelta(days=5)

            missions = await self.mission_archive_collection.find(
                {"status": MissionState.COMPLETE.value , "end_time": {"$gte": since_utc} }
            ).sort("end_time", -1).to_list(length=None)

            if not missions:
                return None

            # assume missions belong to same guild (like your original code)
            guild_id = missions[0].get("guild_id")
            if not guild_id:
                return None

            guild: discord.Guild = self.bot.get_guild(int(guild_id))
            if not guild:
                return None

            # fetch guild config & channel id for mission summaries
            guild_doc = await self.guild_collection.find_one({"guild_id": int(guild.id)})
            channel_id = guild_doc.get("mission_channel") if guild_doc else None
            if not channel_id:
                return None

            ai_summary = guild_doc.get("ai_summary", False)
            if not ai_summary:
                return "disabled"

            # get channel object (try cache then fetch)
            channel = guild.get_channel(int(channel_id))
            if channel is None:
                try:
                    channel = await self.bot.fetch_channel(int(channel_id))
                except Exception:
                    return None

            # total RP (use stored rp_points or fallback 0)
            total_rp = sum(m.get("rp_points", 0) for m in missions)

            # build per-mission lines with logs (include up to 10 logs per mission)
            mission_lines = []
            for m in missions:
                logs_docs = await self.log_collection.find({"mission_id": m["_id"]}).sort("timestamp", 1).to_list(length=None)
                logs_parts = []
                for ld in logs_docs[:10]:
                    uid = ld.get("user_id") or ld.get("user") or ld.get("_id")
                    # resolve readable name from user_collection; fallback to mention
                    name = f"<@{uid}>"
                    try:
                        user_doc = None
                        # try lookup by _id first (if you store ObjectId)
                        if uid is not None:
                            user_doc = await self.user_collection.find_one({"_id": uid})
                        # then by numeric user_id
                        if not user_doc and uid is not None:
                            try:
                                user_doc = await self.user_collection.find_one({"user_id": int(uid)})
                            except Exception:
                                # if conversion fails, skip
                                pass
                        if user_doc:
                            name = user_doc.get("citizen_name") or user_doc.get("display_name") or user_doc.get("username") or name
                    except Exception:
                        name = f"<@{uid}>"

                    ts = ld.get("timestamp")
                    if ts:
                        ts_local = to_local(ts)
                        ts_str = ts_local.strftime("%Y-%m-%d %H:%M") if ts_local else str(ts)
                    else:
                        ts_str = "unknown-time"

                    log_text = (ld.get("log") or "").replace("\n", " ").strip()
                    logs_parts.append(f"{name} [{ts_str}]: {log_text}")

                logs_text = " | ".join(logs_parts) if logs_parts else "No logs"
                mission_lines.append(
                    f"- {m.get('name', '<unnamed>')} ({m.get('mission_type', '?')}) RP:{m.get('rp_points', 10)}\n  Logs: {logs_text}"
                )

            # compact prompt where LLM is asked to censor offensive words
            prompt = (
                f"The Hopewell Continuum has completed {len(missions)} missions over the past 5 days "
                f"for a total of {total_rp} RP points.\n\n"
                "Please produce:\n"
                "1) One-line headline summarizing missions & RP.\n"
                "2) One short paragraph (max 2 sentences) of major occurrences.\n"
                "3) 3 bullet highlights (each <=140 chars).\n\n"
                "IMPORTANT: Remove or censor any inappropriate/offensive words from the logs. "
                "Do NOT invent facts; use only the data below.\n\n"
                "Missions and logs:\n" + "\n".join(mission_lines)
            )

            # use synchronous openai package here; key already set at module level
            resp = await openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=350,
                temperature=0.2,
            )
            ai_response =  resp.choices[0].message.content

            # finally, post to the channel
            await channel.send(ai_response)

        except Exception as exc:
            logging.exception("Failed to post mission summary: %s", exc)


    @commands.hybrid_command(name="toggle_ai_summary", description="Toggle AI summary on/off")
    @is_admin()
    async def toggle_ai_summary(self, ctx: commands.Context) -> None:
        """
        Toggle the ai_summary flag for the guild.
        """
        guild_id = ctx.guild.id  # guaranteed by @commands.guild_only()
        try:
            # get current value (could be None)
            guild_doc = await self.guild_collection.find_one({"guild_id": guild_id})
            old_status = bool(guild_doc.get("ai_summary", False)) if guild_doc else False
            new_status = not old_status

            # update and return the new document in one call
            new_guild_doc = await self.guild_collection.find_one_and_update(
                {"guild_id": guild_id},
                {"$set": {"ai_summary": new_status}},
                upsert=True,
                return_document=ReturnDocument.AFTER
            )

            status_text = "enabled" if new_guild_doc.get("ai_summary", False) else "disabled"
            await ctx.send(f"AI summary {status_text}.")
        except Exception as exc:
            # log exception somewhere (logger) and inform the user
            self.bot.logger.exception("Failed to toggle ai_summary for guild %s", guild_id)
            await ctx.send("⚠️ Something went wrong while updating settings. Try again later.")

    async def clear_expired_missions(self):
        logging.error("🔍 Checking for expired missions...")

        now = datetime.now(TIMEZONE)
        expiration_cutoff = now - timedelta(hours=4)

        # Step 1: Find missions within next 4 hours and matching statuses
        missions = await self.mission_collection.find(
            {
                "status": {
                    "$in": [MissionState.WAITING.value, MissionState.FINALIZED.value]
                },
                "mission_time": {"$lt": expiration_cutoff},
            }
        ).to_list(length=None)

        for mission in missions:
            mission_id = mission["_id"]
            mission_name = mission.get("name", "Unknown Mission")
            guild_id = mission.get("guild_id")
            if not guild_id:
                logging.error(f"❌ Skipping mission `{mission_name}` - no guild_id.")
                continue

            # Step 2: Collect all ship IDs safely
            ship_ids = []
            if mission.get("primary_ship"):
                ship_ids.append(mission["primary_ship"])

            for support in mission.get("supporting_ships", []):
                if isinstance(support, dict) and "_id" in support:
                    ship_ids.append(support["_id"])
                else:
                    logging.error(f"⚠️ Supporting ship missing _id in mission `{mission_name}`.")

            # Step 3: Reset ship statuses if they exist
            if ship_ids:
                ships = await self.ship_collection.find(
                    {"_id": {"$in": ship_ids}}
                ).to_list(length=None)

                for ship in ships:
                    crew_roles = ship.get("crew_roles", {})
                    updates = {
                        "is_mission": False,
                        "current_mission_id": None,
                    }

                    # Empty all `filled` lists inside crew_roles
                    for role in crew_roles:
                        updates[f"crew_roles.{role}.filled"] = []

                    await self.ship_collection.update_one(
                        {"_id": ship["_id"]}, {"$set": updates}
                    )

            # Step 4: Clear user assignments
            await self.user_collection.update_many(
                {"current_mission_assignment.mission_id": mission_id},
                {"$unset": {"current_mission_assignment": ""}},
            )

            # Step 5: Delete the mission
            await self.mission_collection.delete_one({"_id": mission_id})

            # Step 6: Notify in fleet channel
            guild_config = await self.guild_collection.find_one({"guild_id": guild_id})
            if guild_config and "fleet_channel_id" in guild_config:
                fleet_channel_id = int(guild_config["fleet_channel_id"])
                guild = self.bot.get_guild(guild_id)
                if guild:
                    channel = guild.get_channel(fleet_channel_id)
                    if channel:
                        await channel.send(
                            f"⚠️ **Mission `{mission_name}` has timed out** for failure to launch within the specified time.\n"
                            f"Please use `/newmission` later if you wish to recreate this mission."
                        )

    async def clear_queue_expired_missions(self):
        """Clear missions in WAITING status that have exceeded 30-min queue time."""
        logging.info("🔍 Checking for queue-expired missions...")
        
        now = datetime.now(timezone.utc)
        
        # Find missions that are still WAITING and have exceeded queue time
        expired_docs = await self.mission_collection.find({
            "status": MissionState.WAITING.value,
            "queue_expires_at": {"$lt": now, "$ne": None}
        }).to_list(length=None)
        
        if not expired_docs:
            logging.info("✅ No queue-expired missions found.")
            return
        
        for doc in expired_docs:
            # Use Pydantic model for type-safe access
            try:
                mission = Missions.from_mongo(doc)
            except Exception as e:
                logging.warning(f"Failed to parse mission document: {e}")
                continue
            
            logging.info(f"🗑️ Processing queue-expired mission: {mission.name}")
            
            # Release ships
            ship_ids = []
            if mission.primary_ship:
                ship_ids.append(mission.primary_ship)
            ship_ids.extend(mission.supporting_ships)
            
            if ship_ids:
                await self.ship_collection.update_many(
                    {"_id": {"$in": ship_ids}},
                    {"$set": {"is_mission": False}, "$unset": {"current_mission_id": ""}}
                )
                logging.info(f"  ↳ Released {len(ship_ids)} ship(s) from mission lock")
            
            # Delete mission
            await self.mission_collection.delete_one({"_id": mission.id})
            logging.info(f"  ↳ Deleted mission from database")
            
            # DM the creator
            if mission.created_by:
                try:
                    user = await self.bot.fetch_user(mission.created_by)
                    if user:
                        embed = discord.Embed(
                            title="⏰ Mission Queue Expired",
                            description=(
                                f"Your mission **{mission.name}** has expired from the queue.\n\n"
                                f"Missions must be finalized with `/finalize` within **30 minutes** of creation.\n"
                                f"Please use `/newmission` to create a new mission."
                            ),
                            color=discord.Color.orange()
                        )
                        embed.set_footer(text="This is an automated notification from Mission Control.")
                        await user.send(embed=embed)
                        logging.info(f"  ↳ Sent expiration DM to user {mission.created_by}")
                except Exception as e:
                    logging.warning(f"  ↳ Could not DM user {mission.created_by}: {e}")
            
            # Delete the creation thread if it exists
            if mission.thread_id and mission.thread_channel_id:
                try:
                    guild = self.bot.get_guild(mission.guild_id)
                    if guild:
                        channel = guild.get_channel(mission.thread_channel_id)
                        if channel:
                            thread = channel.get_thread(mission.thread_id)
                            if thread:
                                await thread.send("⏰ **Queue expired!** This mission was not finalized in time and has been deleted.")
                                await asyncio.sleep(5)
                                await thread.delete()
                                logging.info(f"  ↳ Deleted creation thread {mission.thread_id}")
                except Exception as e:
                    logging.warning(f"  ↳ Could not delete creation thread: {e}")
            
            logging.info(f"✅ Deleted queue-expired mission: {mission.name}")


    @commands.hybrid_command(name="mission_summary", description="Run a test mission summary.")
    @commands.has_permissions(administrator=True)
    async def mission_summary_test(self, ctx: commands.Context):
        await ctx.defer()
        try:
            post = await self.post_mission_summary()
            if post == "disabled":
                await ctx.send(f"Mission Summary is not enabled, {post}")
                return
            elif not post:
                await ctx.send(f"Failed to post mission summary, {post}")
                return
            await ctx.send(f"Mission summary posted in mission channel", ephemeral=True)
        except Exception as e:
            logging.error(f"Failed to post mission summary check the fun again. {e}",)

    @commands.hybrid_command(
        name="addmissiontype",
        description="Adds a new mission type to the guild's configuration.",
    )
    @is_admin()
    async def addmissiontype(self, ctx: commands.Context):
        modal = modals.MissionTypeModal(self.bot, ctx.guild.id, mode="add")
        await ctx.interaction.response.send_modal(modal)

    @commands.hybrid_command(
        name="editmissiontype", description="Edits an existing mission type."
    )
    @is_admin()
    async def editmissiontype(self, ctx: commands.Context):
        guild_id = ctx.guild.id
        guild_config = await self.guild_collection.find_one({"guild_id": guild_id})

        if (
            not guild_config
            or "mission_types" not in guild_config
            or not guild_config["mission_types"]
        ):
            await ctx.send("No mission types are configured to edit.")
            return

        view = mission_view.EditMissionTypeView(self.bot, guild_config["mission_types"])
        await ctx.send(
            "Please select a mission type to edit:", view=view, ephemeral=True
        )

    @commands.hybrid_command(
        name="listmissiontype",
        description="Lists all configured mission types for this guild.",
    )
    @is_admin()
    async def listmissiontype(self, ctx: commands.Context):
        guild_id = ctx.guild.id
        guild_config = await self.guild_collection.find_one({"guild_id": guild_id})

        ship_types = guild_config.get("mission_types", [])

        if not ship_types:
            await ctx.send(
                "No mission types configured for this server.", ephemeral=True
            )
            return

        fields = []
        for mt in ship_types:
            fields.append((f"{mt.get('emoji', '')} {mt['name']}", mt["description"]))

        reason_block = response_messages.general_transmission(
            transmission="CONFIGURED MISSION TYPES",
            fields=fields,
            box_text="MISSION TYPE DATABASE",
            is_space=True,
        )
        embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
        await ctx.send(embed=embed)

    @commands.hybrid_command(
        name="deletemissiontype",
        description="Deletes a mission type from the guild's configuration.",
    )
    @is_admin()
    async def deletemissiontype(self, ctx: commands.Context):
        guild_id = ctx.guild.id
        guild_config = await self.guild_collection.find_one({"guild_id": guild_id})

        if (
            not guild_config
            or "mission_types" not in guild_config
            or not guild_config["mission_types"]
        ):
            await ctx.send("No mission types are configured to delete.")
            return

        view = mission_view.DeleteMissionTypeView(
            self.bot, guild_config["mission_types"]
        )
        await ctx.send(
            "Please select a mission type to delete:", view=view, ephemeral=True
        )

    @commands.hybrid_command(
        name="newmission",
        description="Begins the private, step-by-step process of creating a mission.",
    )
    @is_admin()
    async def newmission(self, ctx: commands.Context):

        guild_id = ctx.guild.id
        guild_config = await self.guild_collection.find_one({"guild_id": guild_id})

        modal = modals.MissionCreationModal(self.bot, guild_config)
        await ctx.interaction.response.send_modal(modal)

    @commands.hybrid_command(
        name="list_my_missions",
        description="Lists all in-progress missions you have created.",
    )
    async def list_my_missions(self, ctx: commands.Context):
        await ctx.defer(ephemeral=True)

        user_missions = await self.mission_collection.find(
            {
                "created_by": ctx.author.id,
            }
        ).to_list(length=None)

        if not user_missions:
            await ctx.send("You have no in-progress missions.", ephemeral=True)
            return

        embed = discord.Embed(
            title="Your In-Progress Missions", color=discord.Color.blue()
        )
        for mission in user_missions:
            embed.add_field(
                name=mission["name"],
                value=f"Type: {mission.get("mission_type", "N/A")}\nTime: {mission["mission_time"].strftime("%Y-%m-%d %H:%M UTC")}",
                inline=False,
            )
        await ctx.send(embed=embed, ephemeral=True)

    @commands.hybrid_command(
        name="finalize",
        description="Finalizes a mission and posts it to the fleet channel for crew sign-up.",
    )
    async def finalize(self, ctx: commands.Context):
        await ctx.defer(ephemeral=True)

        is_user_admin = await is_admin().predicate(ctx)  # Check if the user is an admin

        query = {"status": MissionState.WAITING.value}
        if not is_user_admin:
            query["created_by"] = ctx.author.id

        user_missions = await self.mission_collection.find(query).to_list(length=None)

        if not user_missions:
            await ctx.send(
                "You have no in-progress missions to finalize.", ephemeral=True
            )
            return

        view = mission_view.MissionSelectionView(self.bot, user_missions, is_user_admin)



        await ctx.send(
            "Please select a mission to finalize:", view=view, ephemeral=True
        )

    async def _finalize_mission(
        self, interaction: discord.Interaction, mission_doc: dict
    ):
        mission_name = mission_doc["name"]
        guild_config = await self.guild_collection.find_one(
            {"guild_id": interaction.guild.id}
        )
        if not guild_config or "mission_channel" not in guild_config:
            await interaction.followup.send(
                "Fleet activity channel is not set up. Please use `/mission_channel` first.",
                ephemeral=True,
            )
            return

        mission_channel_id = guild_config["mission_channel"]
        mission_channel = self.bot.get_channel(mission_channel_id)
        if not mission_channel:
            await interaction.followup.send(
                "Configured fleet channel not found. Please ensure the channel exists and the bot has access.",
                ephemeral=True,
            )
            return

        primary_ship_data = await self.ship_collection.find_one(
            {"_id": mission_doc["primary_ship"]}
        )
        if not primary_ship_data:
            await interaction.followup.send(
                "Primary ship data not found for this mission.", ephemeral=True
            )
            return

        supporting_ships_data = []
        for ship_id in mission_doc["supporting_ships"]:
            s_ship = await self.ship_collection.find_one({"_id": ship_id})
            if s_ship:
                supporting_ships_data.append(s_ship)

        crew_roles_data = await self.guild_collection.find_one(
            {"guild_id": interaction.guild.id}
        )  # This already contains crew_roles
        ship_prefix = guild_config.get("ship_prefix", "")

        # Create the persistent view
        mission_finalize_view = mission_view.MissionFinalizeView(
            bot=self.bot,
            mission_data=mission_doc,
            primary_ship_data=primary_ship_data,
            supporting_ships_data=supporting_ships_data,
            crew_roles_data=crew_roles_data,
            ship_prefix=ship_prefix,
        )

        # Get the initial embed
        embed = await mission_finalize_view.get_embed()

        # Send the message to the fleet channel
        try:
            message = await mission_channel.send(
                embed=embed, view=mission_finalize_view
            )
            # Now that the message is sent, set the message object for the view
            mission_finalize_view.set_message(message)

            # Update mission status and store message info for persistence
            await self.mission_collection.update_one(
                {"_id": mission_doc["_id"]},
                {
                    "$set": {
                        "status": MissionState.FINALIZED.value,
                        "finalized_message_id": message.id,
                        "finalized_channel_id": message.channel.id,
                    }
                },
            )

            await mission_channel.send(
                f"_A mission has been created and finalized by {interaction.user.mention}. Please use the emojis to reserve a crew slot._"
            )

            try:
                ship_cog = self.bot.get_cog("ShipCommands")
                await ship_cog.update_crew_fill_percentage()
            except Exception as e:
                logging.error(f"Failed to update crew fill from mission view confirm button: {e}")

            await interaction.followup.send(
                f"Mission '{mission_name}' finalized and posted to {mission_channel.mention}!",
                ephemeral=True,
            )
            
            # Delete the creation thread since mission is now finalized
            thread_id = mission_doc.get("thread_id")
            thread_channel_id = mission_doc.get("thread_channel_id")
            if thread_id and thread_channel_id:
                try:
                    channel = interaction.guild.get_channel(thread_channel_id)
                    if channel:
                        thread = channel.get_thread(thread_id)
                        if thread:
                            await thread.send(f"✅ **Mission finalized!** Posted to {mission_channel.mention}. Closing thread...")
                            await asyncio.sleep(3)
                            await thread.delete()
                except Exception as e:
                    logging.warning(f"Could not delete creation thread: {e}")

        except Exception as e:
            logging.error(f"{e}")

    @commands.hybrid_command(
        name="missions", description="Lists all available finalized missions."
    )
    async def missions(self, ctx: commands.Context):
        await ctx.defer(ephemeral=True)

        finalized_missions = await self.mission_collection.find(
            {"status": MissionState.FINALIZED.value}
        ).to_list(length=None)

        if not finalized_missions:
            await ctx.send(
                "There are no available missions at the moment.", ephemeral=True
            )
            return

        try:
            thread = await ctx.channel.create_thread(
                name=f"Available Missions - {ctx.author.display_name}",
                type=discord.ChannelType.private_thread,
                auto_archive_duration=60,
            )
            await thread.add_user(ctx.author)
        except (discord.Forbidden, discord.HTTPException):
            await ctx.send(
                "I couldn't create a private thread for you here. Please ensure I have 'Manage Threads' permission.",
                ephemeral=True,
            )
            return

        await ctx.send(
            f"I've created a private thread for you: {thread.mention}", ephemeral=True
        )
        for mission_doc in finalized_missions:
            has_missing_ships = False
            primary_ship_data = await self.ship_collection.find_one(
                {"_id": mission_doc["primary_ship"]}
            )
            if not primary_ship_data:
                logging.error(
                    f"[MISSION ERROR] Primary Ship does not exist for the {mission_doc['name']}"
                )
                has_missing_ships = True
                primary_ship_data = {
                    "_id": "MISSING",
                    "ship_name": "Primary Ship Not Found",
                    "crew": [],
                    "crew_roles": {},
                }

            supporting_ships_data = []
            if "supporting_ships" in mission_doc:
                for ship_id in mission_doc["supporting_ships"]:
                    s_ship = await self.ship_collection.find_one({"_id": ship_id})
                    if s_ship:
                        supporting_ships_data.append(s_ship)
            else:
                logging.error(
                    f"[MISSION ERROR] Supporting Ship does not exist for the {mission_doc['name']}"
                )

            guild_config = await self.guild_collection.find_one(
                {"guild_id": ctx.guild.id}
            )
            if not guild_config:
                continue

            crew_roles_data = guild_config
            ship_prefix = guild_config.get("ship_prefix", "")

            view = mission_view.MissionFinalizeView(
                bot=self.bot,
                mission_data=mission_doc,
                primary_ship_data=primary_ship_data,
                supporting_ships_data=supporting_ships_data,
                crew_roles_data=crew_roles_data,
                ship_prefix=ship_prefix,
            )

            embed = await view.get_embed()

            final_view = view if not has_missing_ships else None
            if has_missing_ships:
                embed.color = discord.Color.orange()
                embed.set_footer(
                    text="This mission has missing ships and is not available for sign-up."
                )

            try:
                if final_view:
                    message = await thread.send(embed=embed, view=final_view)
                    view.set_message(message)
                else:
                    await thread.send(embed=embed)
            except Exception as e:
                traceback.print_exc()
                logging.error(f"Error sending mission to thread: {e}")
                continue

        self.bot.loop.create_task(self.delete_thread_after(thread, 300))

    @commands.hybrid_command(
        name="addships", description="Adds ships to an existing mission."
    )
    @is_admin()
    async def addships(self, ctx: commands.Context):
        await ctx.defer(ephemeral=True)

        missions = await self.mission_collection.find(
            {
                "status": {
                    "$in": [MissionState.WAITING.value, MissionState.FINALIZED.value]
                }
            }
        ).to_list(length=None)

        if not missions:
            await ctx.send(
                "There are no missions available to add ships to.", ephemeral=True
            )
            return

        view = mission_view.MissionSelectionView(self.bot, missions, True, "addships")
        await ctx.send(
            "Please select a mission to add ships to:", view=view, ephemeral=True
        )

    @commands.hybrid_command(name="delete_mission", description="Deletes a mission.")
    async def delete_mission(self, ctx: commands.Context):
        await ctx.defer(ephemeral=True)

        try:
            is_owner = await is_guild_owner().predicate(ctx)
        except commands.NotOwner:
            is_owner = False

        query = {}
        if not is_owner:
            query["created_by"] = ctx.author.id

        missions = await self.mission_collection.find(query).to_list(length=None)

        if not missions:
            await ctx.send(
                "There are no missions available for you to delete.", ephemeral=True
            )
            return

        view = mission_view.DeleteMissionView(self.bot, missions)
        await ctx.send("Please select a mission to delete:", view=view, ephemeral=True)

    @commands.hybrid_command(name="missionabort", description="Aborts a mission.")
    async def missionabort(self, ctx: commands.Context):
        await ctx.defer(ephemeral=True)

        try:
            is_owner = await is_guild_owner().predicate(ctx)
        except commands.NotOwner:
            is_owner = False

        query = {
            "status": {
                "$in": [
                    MissionState.WAITING.value,
                    MissionState.FINALIZED.value,
                    MissionState.INPROGRESS.value,
                ]
            }
        }
        if not is_owner:
            query["created_by"] = ctx.author.id

        missions = await self.mission_collection.find(query).to_list(length=None)

        if not missions:
            await ctx.send(
                "There are no missions available for you to abort.", ephemeral=True
            )
            return

        view = mission_view.AbortMissionView(self.bot, missions)
        await ctx.send("Please select a mission to abort:", view=view, ephemeral=True)

    @commands.hybrid_command(
        name="launch_mission", description="Launch a finalized mission"
    )
    async def launch_mission(self, ctx: commands.Context):
        await ctx.defer(ephemeral=True)

        try:
            is_owner = await is_guild_owner().predicate(ctx)
        except commands.NotOwner:
            is_owner = False

        query = {"status": MissionState.FINALIZED.value}
        if not is_owner:
            query["created_by"] = ctx.author.id

        missions = await self.mission_collection.find(query).to_list(length=None)

        if not missions:
            await ctx.send(
                "There are no finalized missions available for you to launch.",
                ephemeral=True,
            )
            return

        view = mission_view.LaunchMissionView(bot=self.bot, missions=missions)
        await ctx.send("Please select a mission to launch:", view=view, ephemeral=True)

    async def _reset_mission_associations(self, mission_doc: dict):
        mission_id = mission_doc["_id"]
        mission_name = mission_doc["name"]

        try:
            # 1. Gather Ship IDs
            ship_ids = []
            if mission_doc.get("primary_ship"):
                ship_ids.append(mission_doc["primary_ship"])
            if mission_doc.get("supporting_ships"):
                ship_ids.extend(mission_doc["supporting_ships"])

            # 2. Update Ships: Reset status and crew
            if ship_ids:
                ship_collection = self.bot.db[Db_Constant.SHIP]
                ships_to_update = await ship_collection.find(
                    {"_id": {"$in": ship_ids}}
                ).to_list(length=None)
                for ship in ships_to_update:
                    update_fields = {
                        "is_mission": False,
                    }
                    if "crew_roles" in ship and ship["crew_roles"]:
                        for role_name in ship["crew_roles"]:
                            update_fields[f"crew_roles.{role_name}.filled"] = []

                    await ship_collection.update_one(
                        {"_id": ship["_id"]},
                        {"$set": update_fields, "$unset": {"current_mission_id": ""}},
                    )

            # 3. Update Users: Clear mission assignments
            await self.bot.db[Db_Constant.USER].update_many(
                {"current_mission_assignment.mission_id": mission_id},
                {"$unset": {"current_mission_assignment": ""}},
            )

            # 4. Delete the finalized mission embed
            if mission_doc.get("finalized_channel_id") and mission_doc.get(
                "finalized_message_id"
            ):
                try:
                    channel = self.bot.get_channel(
                        int(mission_doc["finalized_channel_id"])
                    )
                    if channel:
                        message = await channel.fetch_message(
                            int(mission_doc["finalized_message_id"])
                        )
                        await message.delete()
                    try:
                        ship_cog = self.bot.get_cog("ShipCommands")
                        await ship_cog.update_crew_fill_percentage()
                    except Exception as e:
                        logging.error(f"Failed to update crew fill from mission view confirm button: {e}")

                except (
                    discord.NotFound,
                    discord.Forbidden,
                    discord.HTTPException,
                ) as e:
                    logging.error(f"Could not delete mission message for {mission_name}: {e}")

        except Exception as e:
            logging.error(f"Error resetting mission associations for {mission_name}: {e}")
            raise e

    async def delete_thread_after(self, thread: discord.Thread, delay: int):
        await asyncio.sleep(delay)
        try:
            await thread.delete()
        except (discord.NotFound, discord.Forbidden):
            pass
        except Exception as e:
            logging.error(f"Could not delete thread {thread.id}: {e}")

    async def mission_complete(self, interaction: discord.Interaction, mission_id):

        job_id = f"mission_complete_{mission_id}"
        try:
            self.bot.scheduler.remove_job(job_id)
            logging.info(f"Cancelled scheduled job: {job_id}")
        except Exception as e:
            logging.error(f"Could not cancel job {job_id}: {e}")

        mission = await self.mission_collection.find_one({"_id": ObjectId(mission_id)})
        if not mission:
            logging.error(f"Complete Mission Failed: no mission found with ID {mission_id}")
            return

        if mission["status"] != MissionState.INPROGRESS.value:
            await interaction.followup.send("⚠️ This mission is not in progress.")
            return

        # Fetch primary ship
        primary_ship = await self.ship_collection.find_one(
            {"_id": mission["primary_ship"]}
        )
        primary_ship_valid = False
        if primary_ship:
            for role in primary_ship.get("crew_roles", {}).values():
                if role.get("filled"):
                    primary_ship_valid = True
                    break

        supporting_ships_id = mission.get("supporting_ships", [])
        supporting_ship_raw = await self.ship_collection.find(
            {"_id": {"$in": supporting_ships_id}}
        ).to_list(length=None)

        valid_supporting_ships = []
        for ship in supporting_ship_raw:
            for role in ship.get("crew_roles", {}).values():
                if role.get("filled"):
                    valid_supporting_ships.append(ship)
                    break

        if not primary_ship_valid and not valid_supporting_ships:
            await interaction.followup.send(
                "❌ No valid ships with filled crew to archive."
            )
            return

        crew_ids = set()
        valid_ship_ids = set()
        crew_roles_map = {}

        def extract_crew_and_roles(ship_to_extract: dict):
            for role_name, role_info in ship_to_extract.get("crew_roles", {}).items():
                for uid in role_info.get("filled", []):
                    crew_ids.add(uid)
                    crew_roles_map[uid] = role_name

        # Process primary ship
        if primary_ship_valid:
            extract_crew_and_roles(primary_ship)
            valid_ship_ids.add(primary_ship["_id"])

        # Process supporting ships
        for ship in valid_supporting_ships:
            extract_crew_and_roles(ship)
            valid_ship_ids.add(ship["_id"])

        # Increment mission count only once per ship
        for ship_id in valid_ship_ids:
            await self.ship_collection.update_one(
                {"_id": ship_id}, {"$inc": {"missions_completed": 1}}
            )

        # Increment mission count for each crew member
        for crew_id in crew_ids:
            await self.user_collection.update_one(
                {"_id": crew_id}, {"$inc": {"missions_completed": 1}}
            )

        guild_doc = await self.guild_collection.find_one({"guild_id": interaction.guild.id})
        channel_id = guild_doc.get("launch_channel")
        channel = interaction.guild.get_channel(channel_id)


        # Archive the mission
        archive_doc = {
            "_id": mission["_id"],
            "name": mission["name"],
            "status": MissionState.COMPLETE.value,
            "mission_type": mission["mission_type"],
            "objectives": mission["objectives"],
            "created_at": mission["created_at"],
            "mission_time": mission["mission_time"],
            "mission_start_time": mission["start_time"],
            "guild_id": mission["guild_id"],
            "created_by": mission["created_by"],
            "end_time": datetime.now(TIMEZONE),
        }

        if primary_ship_valid:
            archive_doc["primary_ship"] = {
                "_id": primary_ship["_id"],
                "ship_name": primary_ship["ship_name"],
                "description": primary_ship["description"],
                "owner_id": primary_ship["owner_id"],
                "ship_type": primary_ship["type"],
                "crew_roles": primary_ship["crew_roles"],
                "crew_fill_parcentage": primary_ship.get("crew_fill_parcentage", 0)
            }

        archive_doc["supporting_ships"] = [
            {
                "_id": ship["_id"],
                "ship_name": ship["ship_name"],
                "description": ship["description"],
                "owner_id": ship["owner_id"],
                "ship_type": ship["type"],
                "crew_roles": ship["crew_roles"],
                "crew_fill_parcentage": ship.get("crew_fill_parcentage", 0)
            }
            for ship in valid_supporting_ships
        ]

        ships_all = await self.ship_collection.find(
            {"_id": {"$in": list(valid_ship_ids)}}
        ).to_list(length=None)

        total_mission_rp = 0
        messages_to_send = []
        ## Add Rp For Mission Creator
        rp_handler_cog = self.bot.get_cog("RpHandler")
        if rp_handler_cog:
            # Award points to the mission creator
            await rp_handler_cog.add_rp_for_mission_launch(
                player_id = mission["created_by"],
                mission_id= mission["_id"],
                guild_id= interaction.guild.id
            )

            for ship in ships_all:
                capacity_at_launch = 0
                filled_at_launch = 0
                for role_data in ship.get("crew_roles", {}).values():
                    capacity_at_launch += role_data.get("slots",0)
                    filled_at_launch += len(role_data.get("filled", []))

                await rp_handler_cog.award_ship_fill_bonus(
                    ship_id = ship["_id"],
                    mission_id= mission["_id"],
                    capacity_at_launch= capacity_at_launch,
                    guild_id= interaction.guild.id,
                    filled_at_launch=filled_at_launch,
                    role= "PRIMARY" if ship["_id"] == mission["primary_ship"] else "SUPPORT"
                )

                for role_name, role_info in ship.get("crew_roles", {}).items():
                    for uid in role_info.get("filled", []):
                        crew_result = await rp_handler_cog.add_rp_for_crew_slot_filled(
                            player_id= uid,
                            ship_id= ship["_id"],
                            mission_id= mission["_id"],
                            guild_id= interaction.guild.id,
                            crew_fill_percent= ship.get("crew_fill_parcentage", 0)
                        )
                        total_mission_rp += crew_result["points"]

                        user_doc = await self.user_collection.find_one({"_id":uid})
                        display_name = None
                        if user_doc:
                            display_name = user_doc.get("citizen_name")

                        # try cached member, then fallback to fetch (safe)
                        member = interaction.guild.get_member(uid)
                        if not display_name and member:
                            display_name = member.display_name

                        msg = (
                            f"_**{display_name.upper()}** earned +{crew_result.get('points', 0)} RP points "
                            f"for their **{role_name}** role aboard **{guild_doc.get('ship_prefix', 'HCS')} {ship.get('ship_name')}** "
                            f"upon completion of mission **{mission.get('name')}**_"
                        )
                        messages_to_send.append(msg)

        if messages_to_send and channel:
            try:
                self.bot.loop.create_task(delayed_send_messages(channel=channel, messages=messages_to_send))
            except Exception:
                logging.exception("Failed to schedule delayed messages task")

        await self.mission_archive_collection.insert_one(archive_doc)

        # Clean up
        await self._reset_mission_associations(mission_doc=mission)
        await self.send_submit_logs_dm(
            guild=interaction.guild,
            member_list_id=list(crew_ids),
            mission_name=mission["name"],
            crew_roles=crew_roles_map,
            mission_id=mission_id,
        )


        mission_channel_id = guild_doc["mission_channel"]
        mission_channel = interaction.guild.get_channel(mission_channel_id)

        archive_mission = await self.mission_archive_collection.find_one(
            {"_id": mission["_id"]}
        )

        embed = await build_mission_complete_embed(
            mission_doc=mission,
            ships=ships_all,
            guild=interaction.guild,
            guild_config=guild_doc,
            archive_mission=archive_mission,
            total_points= total_mission_rp
        )
        if mission_channel:
            await mission_channel.send(embed=embed)

        await interaction.followup.send(
            "✅ Mission completed and archived successfully. DMs sent to crew members for log submission."
        )
        await self.mission_collection.delete_one({"_id": mission["_id"]})

    async def send_submit_logs_dm(
        self,
        guild: discord.Guild,
        member_list_id: list[int],
        mission_id,
        mission_name: str,
        crew_roles: dict[int, str],
    ):

        for member_id in member_list_id:
            member = guild.get_member(member_id)
            if not member:
                continue

            try:
                role = crew_roles.get(member_id, "UNKNOWN ROLE")
                embed = build_post_mission_dm_embed(
                    mission_name=mission_name,
                    mission_status=MissionState.COMPLETE.value,
                    role=role,
                )

                custom_id = f"submitlog_{member_id}_{mission_id}"

                submit_log_button_modal = ButtonSchema(
                    label="SUBMIT LOG",
                    style=discord.ButtonStyle.green,
                    custom_id=custom_id,
                    emoji="📃",
                    callback=self.on_submit_log_initial_click,
                )
                view = GenericMissionView(timeout=None)
                view.add_buttons([submit_log_button_modal])
                await member.send(embed=embed, view=view)
            except discord.Forbidden:
                logging.error(
                    f"Could not send DM to {member.name} ({member.id}). They may have DMs disabled."
                )

    async def on_submit_log_initial_click(
        self, interaction: discord.Interaction, custom_id: str = None
    ):
        """
        Handles the initial click to submit a log.
        Defers the interaction, checks for existing logs, and provides a new button to open the modal.
        """
        await interaction.response.defer(ephemeral=True)

        try:
            if custom_id is None:
                parts = interaction.data["custom_id"].split("_")
            else:
                parts = custom_id.split("_")

            if len(parts) != 3:
                await interaction.followup.send(
                    "Invalid button ID Format", ephemeral=True
                )
                return

            _, member_id, mission_id = parts

            check_if_already_logged = await self.log_collection.find_one(
                {"mission_id": ObjectId(mission_id), "user_id": interaction.user.id}
            )

            if check_if_already_logged:
                await interaction.followup.send(
                    "You already submitted a log for this mission.", ephemeral=True
                )
                return

            view = GenericMissionView(timeout=None)
            new_custom_id = f"openlogmodal_{mission_id}"

            open_modal_button = ButtonSchema(
                label="Open Submission Form",
                style=discord.ButtonStyle.green,
                custom_id=new_custom_id,
                emoji="📝",
                callback=self.on_open_log_modal_click,
            )
            view.add_buttons([open_modal_button])

            await interaction.followup.send(
                "Checks complete. Please click the button below to open the submission form.",
                view=view,
                ephemeral=True,
            )

        except Exception as e:
            print(f"Error in on_submit_log_initial_click: {e}")
            await interaction.followup.send(
                "Something went wrong while processing your request.", ephemeral=True
            )

    async def on_open_log_modal_click(
        self, interaction: discord.Interaction, custom_id: str = None
    ):
        """
        This will open submit logs modal after the initial checks.
        """
        try:
            if custom_id is None:
                parts = interaction.data["custom_id"].split("_")
            else:
                parts = custom_id.split("_")

            if len(parts) != 2:
                await interaction.response.send_message(
                    "Invalid button ID Format", ephemeral=True
                )
                return

            _, mission_id = parts

            modal_fields = [
                ModalFieldSchema(
                    label="Mission Log",
                    placeholder="Describe your experience...",
                    required=True,
                    style=2,
                    max_length=1000,
                    custom_id="log_content",
                )
            ]

            modal = GenericModal(
                title="Submit Mission Log",
                fields=modal_fields,
                custom_id=f"logmodal_{mission_id}",
                on_submit_callback=self.submit_logs_to_db,
            )
            await interaction.response.send_modal(modal)

        except Exception as e:
            print(f"Error in on_open_log_modal_click: {e}")
            if not interaction.response.is_done():
                await interaction.response.send_message(
                    "Something went wrong while processing your request.",
                    ephemeral=True,
                )

    async def submit_logs_to_db(
        self, interaction: discord.Interaction, children: list[discord.ui.TextInput]
    ):
        await interaction.response.defer()
        try:
            modal_custom_id = interaction.data.get("custom_id", "")
            if not modal_custom_id.startswith("logmodal_"):
                await interaction.response.send_message(
                    "Invalid modal ID.", ephemeral=True
                )
                return

            mission_id_str = modal_custom_id.split("_", 1)[1]
            existing_log = await self.log_collection.find_one(
                {"mission_id": ObjectId(mission_id_str), "user_id": interaction.user.id}
            )


            if existing_log:
                await interaction.followup.send(
                    f"You already submitted a log for this mission"
                )
                return



            log_content = None
            for field in children:
                if field.custom_id == "log_content":
                    log_content = field.value
                    break

            if not log_content:
                await interaction.followup.send(
                    "Log content is missing.", ephemeral=True
                )
                return

            await self.log_collection.insert_one(
                {
                    "mission_id": ObjectId(mission_id_str),
                    "user_id": interaction.user.id,
                    "log": log_content,
                    "timestamp": datetime.now(TIMEZONE),
                }
            )
            ### Add Rp After Log Submitted

            mission_doc = await self.mission_archive_collection.find_one(
                {"_id": ObjectId(mission_id_str)}
            )

            rp_handler_cog = self.bot.get_cog("RpHandler")
            if rp_handler_cog:
                points, is_added = await rp_handler_cog.add_rp_for_aftermath_log(
                    player_id= interaction.user.id,
                    mission_id=ObjectId(mission_id_str),
                    guild_id= mission_doc["guild_id"]
                )

                guild_doc  = await self.guild_collection.find_one({"guild_id": mission_doc["guild_id"]})
                mission_channel_id = guild_doc.get("mission_channel")
                if mission_channel_id:
                    mission_channel = self.bot.get_channel(mission_channel_id)
                    await mission_channel.send(
                        f"_**{interaction.user.display_name.upper()}** has earned **+{points}** points for submitting an after-action log for **{mission_doc["name"]}**_."
                    )

            await interaction.followup.send(
                "✅ Your mission log has been submitted!", ephemeral=True
            )

        except Exception as e:
            print(f"Error submitting log: {e}")
            await interaction.followup.send(
                "❌ Failed to submit your log. Please try again"
            )

    @commands.hybrid_command(
        name="complete_mission",
        description="Complete a in progress mission and send dm for submit logs.",
    )
    async def complete_mission(self, ctx: commands.Context):
        await ctx.defer(ephemeral=True)

        try:
            is_owner = await is_guild_owner().predicate(ctx)
        except commands.NotOwner:
            is_owner = False

        query = {"status": MissionState.INPROGRESS.value}
        if not is_owner:
            query["created_by"] = f"{ctx.author.id}"

        missions = await self.mission_collection.find(query).to_list(length=None)

        if not missions:
            await ctx.send(
                "There are no in progress missions available for you to complete.",
                ephemeral=True,
            )
            return

        view = mission_view.GenericMissionView(timeout=None)

        options = [
            discord.SelectOption(
                label=m["name"],
                description=f"Status {m["status"]}",
                value=str(m["_id"]),
            )
            for m in missions
        ]

        async def select_callback(interaction: discord.Interaction):
            await interaction.response.defer(ephemeral=True)
            mission_id = interaction.data["values"][0]
            print(f"\n\nMssion _id {mission_id}")

            try:
                mission_doc = await self.mission_collection.find_one(
                    {"_id": ObjectId(mission_id)}
                )
            except Exception as e:
                print(f"Failed to fetch mission: {e}")
                await interaction.followup.send("Something went wrong.", ephemeral=True)
                return

            if not mission_doc:
                await interaction.followup.send(
                    f"Can not find the mission to complete", ephemeral=True
                )
                return

            await self.mission_complete(interaction=interaction, mission_id=mission_id)

        view.add_select(
            placeholder="Choose and mission to complete",
            options=options,
            callback=select_callback,
        )

        await ctx.send("Select a mission to complete:", view=view)

    async def start_mission_complete_check(
        self, interaction: discord.Interaction, mission_id
    ):
        job_id = f"mission_complete_{mission_id}"
        FOUR_HOURS = timedelta(hours=4)
        run_time = datetime.now(TIMEZONE) + FOUR_HOURS

        self.bot.scheduler.add_job(
            self.mission_complete,
            "date",
            run_date=run_time,
            args=[interaction, mission_id],
            id=job_id,
            misfire_grace_time=600,
        )

    @commands.hybrid_command(
        name="submit_logs", description="Submit your mission logs for a mission"
    )
    async def submit_logs(self, ctx: commands.Context):
        all_missions = await self.mission_archive_collection.find(
            {"guild_id": ctx.guild.id}
        ).to_list(length=None)

        if not all_missions:
            await ctx.send(
                f"There are no missions available for you to submit logs.",
                ephemeral=True,
            )
            return

        user_missions = []
        for mission in all_missions:
            if self.is_user_in_mission_crew(
                user_id=ctx.author.id, mission_data=mission
            ):
                user_missions.append(mission)

        if not user_missions:
            await ctx.send("You have no missions to submit logs for.", ephemeral=True)
            return

        options = [
            discord.SelectOption(
                label=m["name"],
                description=f"{m["objectives"][:96] + '...' if len(m["objectives"]) > 100 else m["objectives"]}",
                value=str(m["_id"]),
            )
            for m in user_missions
        ]

        async def callack(interaction: discord.Interaction):
            mission_id = interaction.data["values"][0]
            member_id = interaction.user.id
            custom_id = f"submitlog_{member_id}_{mission_id}"
            await self.on_submit_log_initial_click(
                interaction=interaction, custom_id=custom_id
            )

        view = GenericMissionView(timeout=None)
        view.add_select(
            placeholder="Choose a mission to submit log",
            options=options,
            callback=callack,
        )
        await ctx.send(
            "From the dropdown below select a mission to submit your logs.", view=view
        )

    def is_user_in_mission_crew(self, user_id: int, mission_data: dict) -> bool:
        primary_crew_roles = mission_data.get("primary_ship", {}).get("crew_roles", {})
        for role_data in primary_crew_roles.values():
            if any(str(user_id) == str(uid) for uid in role_data.get("filled", [])):
                return True

        for ship in mission_data.get("supporting_ships", []):
            support_crew_roles = ship.get("crew_roles", {})
            for role_data in support_crew_roles.values():
                if any(str(user_id) == str(uid) for uid in role_data.get("filled", [])):
                    return True

        return False



    @commands.hybrid_command(
        name="viewlogs", description="Check all the complete mission"
    )
    async def viewlogs(self, ctx: commands.Context):
        await ctx.defer(ephemeral=True)

        archive_config = await self.mission_archive_collection.find().to_list(
            length=None
        )

        guild_config = await self.guild_collection.find_one({"guild_id": ctx.guild.id})
        ship_prefix = guild_config.get("ship_prefix", "HCS")

        missions = []

        for mission in archive_config:
            logs_count = await self.log_collection.find(
                {"mission_id": mission["_id"]}
            ).to_list(length=None)

            archive_primary_ship = mission["primary_ship"]
            archive_supporting_ships = mission.get("supporting_ships", [])

            ship_ids = []
            ship_names = []
            if archive_primary_ship:
                ship_ids.append(archive_primary_ship["_id"])
                ship_names.append(archive_primary_ship["ship_name"])

            if archive_supporting_ships:
                for ship in archive_supporting_ships:
                    ship_ids.append(ship)
                    ship_names.append(ship.get("ship_name", ""))

            ship_name = [f"{ship_prefix} {name or 'Unknown'}" for name in ship_names]

            missions.append(
                {
                    "_id": mission["_id"],
                    "title": mission.get("name", "Unknown Mission"),
                    "ships": ship_name,
                    "logs": len(logs_count),
                    "description": mission.get("objectives", " "),
                }
            )

        if not missions:
            await ctx.send("No completed missions found.", ephemeral=True)
            return

        # Import and use the pagination view
        from bot.utils.views import MissionPaginationView

        # Get guild config for the pagination view
        guild_config = await self.guild_collection.find_one({"guild_id": ctx.guild.id})
        if not guild_config:
            guild_config = {}

        # Create the pagination view
        view = MissionPaginationView(
            missions=missions,
            bot=self.bot,
            guild=ctx.guild,
            guild_config=guild_config,
            mission_archive_collection=self.mission_archive_collection,
            log_collection=self.log_collection,
        )

        # Get the initial embed
        embed = view.get_main_embed()

        await ctx.send(embed=embed, view=view)
