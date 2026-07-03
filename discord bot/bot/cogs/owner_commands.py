import discord
from discord.ext import commands
from motor.motor_asyncio import AsyncIOMotorCollection

from bot.cogs.mission.mission_view import GenericMissionView
from bot.core import response_messages
from bot.core.constant import Db_Constant
from bot.core.models.buttonSchema import ButtonSchema
from bot.utils.checks import is_guild_owner
from bot.utils.embeds import dos_style_embed_builder
from bot.utils.helepr import ship_prefix


class OwnerCommands(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.collection : AsyncIOMotorCollection = self.bot.db[Db_Constant.GUILD_CONFIG_COLLECTION]
        self.ship_collection : AsyncIOMotorCollection = self.bot.db[Db_Constant.SHIP]
        self.user_collection : AsyncIOMotorCollection = self.bot.db[Db_Constant.USER]
        self.mission_collection : AsyncIOMotorCollection = self.bot.db[Db_Constant.MISSION]

    @commands.hybrid_command(
        name="setmaxship",
        description="Ability to change the maximum ships per user setting dynamically",
    )
    @is_guild_owner()
    async def setmaxship(self, ctx: commands.Context, number: int):
        if not number and not number.is_integer():
            await ctx.send(f"Set a valid number", ephemeral=True)
            return

        update = await self.collection.update_one(
            {"guild_id": ctx.guild.id}, {"$set": {"maxships": number}}, upsert=True
        )

        if update.modified_count == 0 and update.modified_count is None:
            await ctx.send(f"Update failed")
            return

        await ctx.send(f"Ship limit has been set to {number}")

    @commands.hybrid_command(
        name="max_mission_ship",
        description="Sets the maximum number of ships allowed per mission (primary + supporting).",
    )
    @is_guild_owner()
    async def max_mission_ship(self, ctx: commands.Context, number: int):
        if not isinstance(number, int) or number < 1:
            await ctx.send("Please provide a valid positive integer for the maximum number of mission ships.",
                           ephemeral=True)
            return

        update_result = await self.collection.update_one(
            {"guild_id": ctx.guild.id},
            {"$set": {"max_mission_ships": number}},
            upsert=True,
        )

        if update_result.modified_count > 0 or update_result.upserted_id:
            await ctx.send(f"Maximum mission ships set to **{number}**.")
        else:
            await ctx.send("Failed to update maximum mission ships. Please try again.", ephemeral=True)

    @commands.hybrid_command(
        name="setprefix", description="Sets the default prefix for all ship names."
    )
    @is_guild_owner()
    async def setprefix(self, ctx: commands.Context, prefix: str):
        if not prefix:
            reason_block = response_messages.missing_argument_error_text(
                command=ctx.command.name, argument="shipname"
            )
            embed = dos_style_embed_builder(
                "COMMAND SYNTAX ERROR",
                reason_block,
            )
            await ctx.send(embed=embed, ephemeral=True)
            return

        update = await self.collection.update_one(
            {"guild_id": ctx.guild.id}, {"$set": {"ship_prefix": prefix.upper()}}
        )

        if update.modified_count == 0 and update.upserted_id is None:
            reason_block = response_messages.database_error_message(
                command_name=ctx.command.name
            )
            embed = dos_style_embed_builder("", reason_block)
            await ctx.send(embed=embed, ephemeral=True)
            return

        reason_block = response_messages.general_transmission(
            transmission="SHIP NAME PREFIX SET",
            box_text="SHIP NAME PREFIX",
            fields=[("SET BY", f"@{ctx.author.name}"), ("NEW PREFIX", prefix.upper())],
        )

        embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
        await ctx.send(embed=embed)

    @commands.hybrid_command(
        name="deleteship",
        description="Permanently removes a specific ship from the ship registry. This action is irreversible.",
    )
    @is_guild_owner()
    async def deleteship(self, ctx: commands.Context, ship_name: str):
        guild_config = await self.collection.find_one({"guild_id": ctx.guild.id})
        prefix = await ship_prefix(guild_config=guild_config)
        if not ship_name:
            reason_block = response_messages.missing_argument_error_text(
                command=ctx.command.name, argument="shipname"
            )
            embed = dos_style_embed_builder(
                "COMMAND SYNTAX ERROR",
                reason_block,
            )
            await ctx.send(embed=embed, ephemeral=True)
            return

        delete_one = await self.ship_collection.delete_one(
            {"ship_name": ship_name.upper()}
        )

        if delete_one.deleted_count > 0:
            reason_block = response_messages.general_transmission(
                transmission="SHIP DECOMMISSIONED",
                box_text="SHIP REMOVAL COMPLETE",
                fields=[
                    ("DELETED BY", f"@{ctx.author.name.upper()}"),
                    ("SHIP NAME", f"{prefix} {ship_name.upper()}"),
                    ("REQUIRED ROLE", "SHIP OWNER OR PREMIER | STAR CAPTAIN"),
                ],
                footer=[
                    f"❌ This ship has been removed from the fleet database",
                    f"🔒 All crew presets and mission links were revoked",
                    "\n",
                    f"🧠 You may re-register this ship using [34m/registership[0m at any time",
                ],
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
            await ctx.send(embed=embed)
        else:
            reason_block = response_messages.database_error_message(
                command_name=ctx.command.name
            )
            embed = dos_style_embed_builder(" ", reason_block)
            await ctx.send(embed=embed, ephemeral=True)

    @commands.hybrid_command(
        name="promote_rank", description="Set authorized role for mission control"
    )
    @is_guild_owner()
    async def promote_rank(self, ctx: commands.Context, role: discord.Role):
        await ctx.defer()

        if not role:
            reason_block = response_messages.missing_argument_error_text(
                command=ctx.command.name, argument="role"
            )
            embed = dos_style_embed_builder(
                "COMMAND SYNTAX ERROR",
                reason_block,
            )
            await ctx.send(embed=embed, ephemeral=True)
            return

        existing_role = await self.collection.find_one(
            {"guild_id": ctx.guild.id, "allowed_roles.id": role.id}
        )
        print(existing_role)
        if existing_role:
            reason_block = response_messages.duplicate_role_message(role=role.name)
            embed = dos_style_embed_builder(
                title="RANK DUPLICATION BLOCKED", reason_block=reason_block
            )
            await ctx.send(embed=embed)
            return

        update = await self.collection.update_one(
            {"guild_id": ctx.guild.id},
            {"$addToSet": {"allowed_roles": {"id": role.id, "role_name": role.name}}},
            upsert=True,
        )

        if update.modified_count == 0:
            reason_block = response_messages.database_error_message(
                command_name=ctx.command.name
            )
            embed = dos_style_embed_builder("`DATABASE ERROR`", reason_block)
            await ctx.send(embed=embed, ephemeral=True)
            return

        reason_block = response_messages.access_level_text(
            user=ctx.author.name, role=role.name, access="MISSION CONTROL"
        )
        await ctx.send(
            embed=dos_style_embed_builder(
                title="ACCESS AUTHORIZATION UPDATE",
                reason_block=reason_block,
                color=discord.Color.green(),
            ),
            ephemeral=True,
        )

    @commands.hybrid_command(
        name="revoke_rank", description="Remove role from accessing mission control"
    )
    @is_guild_owner()
    async def revoke_rank(self, ctx: commands.Context, role: discord.Role):
        await ctx.defer()
        if not role:
            reason_block = response_messages.missing_argument_error_text(
                command=ctx.command.name, argument="role"
            )
            embed = dos_style_embed_builder("COMMAND SYNTAX ERROR", reason_block)
            await ctx.send(embed=embed, ephemeral=True)
            return

        existing_role = await self.collection.find_one(
            {"guild_id": ctx.guild.id, "allowed_roles.id": role.id}
        )

        if not existing_role:
            reason_block = response_messages.role_not_authorized(role=role.name)
            embed = dos_style_embed_builder(
                title="ROLE NOT AUTHORIZED", reason_block=reason_block
            )
            await ctx.send(embed=embed)
            return

        update = await self.collection.update_one(
            {"guild_id": ctx.guild.id}, {"$pull": {"allowed_roles": {"id": role.id}}}
        )

        if update.modified_count == 0:
            reason_block = response_messages.database_error_message(
                command_name=ctx.command.name
            )
            embed = dos_style_embed_builder("`DATABASE ERROR`", reason_block)
            await ctx.send(embed=embed, ephemeral=True)
            return

        reason_block = response_messages.access_unauthorize_text(
            user=ctx.author.name, role=role.name, access="MISSION CONTROL"
        )
        await ctx.send(
            embed=dos_style_embed_builder(
                title="ACCESS UNAUTHORIZATION UPDATE",
                reason_block=reason_block,
                color=discord.Color.green(),
            ),
            ephemeral=True,
        )

    @commands.hybrid_command(
        name="fleet_activity_channel", description="Set fleet activity channel."
    )
    @is_guild_owner()
    async def set_fleet_channel(
            self, ctx: commands.Context, channel: discord.TextChannel = None
    ):
        if channel is None:
            channel = ctx.channel

        update = await self.collection.update_one(
            {"guild_id": ctx.guild.id},
            {"$set": {"fleet_channel": channel.id}},
            upsert=True,
        )

        new_block = response_messages.general_transmission(
            transmission="FLEET CHANNEL LINKED",
            box_text="FLEET COMMUNICATIONS",
            fields=[
                ("SET BY", f"@{ctx.author.name}"),
                ("DESIGNATED CHANNEL", f"#{channel.name}"),
                ("SCOPE", "Mission Announcements & Crew Signups"),
            ],
            footer=[
                f"✅ All future mission announcements will be posted in [34m#{channel.name}[0m",
                f"This channel is now linked to [36mFLEET OPS SYSTEM[0m",
                f"\n",
                f"To unlink or change, use [34m/{ctx.command.name} #new-channel[0m",
            ],
        )

        embed = dos_style_embed_builder(title=" ", reason_block=new_block)

        await ctx.send(embed=embed, ephemeral= True)


    @commands.hybrid_command(name="mission_channel", description ="Set the channel for mission posting")
    @is_guild_owner()
    async def mission_channel(self, ctx: commands.Context, channel: discord.TextChannel):
        if not channel:
            channel = ctx.channel

        await self.collection.update_one(
            {"guild_id": ctx.guild.id},
            {
                "$set":{"mission_channel": channel.id}
            },
            upsert= True
        )

        new_block = response_messages.general_transmission(
            transmission="MISSION CHANNEL LINKED",
            box_text="MISSION ARCHIVE",
            fields=[
                ("SET BY", f"@{ctx.author.name}"),
                ("DESIGNATED CHANNEL", f"#{channel.name}"),
                ("SCOPE", "Mission Announcements "),
            ],
            footer=[
                f"✅ All future mission announcements will be posted in [34m#{channel.name}[0m",
                f"This channel is now linked to [36mFLEET OPS SYSTEM[0m",
                f"\n",
                f"To unlink or change, use [34m/{ctx.command.name} #new-channel[0m",
            ],
        )

        embed = dos_style_embed_builder(title=" ", reason_block=new_block)

        await ctx.send(embed=embed, ephemeral=True)

    @commands.hybrid_command(name="launch_channel", description ="Set Launch Channel")
    @is_guild_owner()
    async def set_launch_channel(self, ctx: commands.Context, channel: discord.TextChannel = None):
        if channel is None:
            channel = ctx.channel

        update_result = await  self.collection.update_one(
            {"guild_id": ctx.guild.id},
            {
                "$set":{
                    "launch_channel" : channel.id
                }
            },
            upsert= True
        )

        if update_result.modified_count > 0 or update_result.upserted_id is not None:
            await ctx.send(f"{channel.mention} is set for Mission Launch Activity.", ephemeral=True)
        else:
            # Means it was already set to this value
            await ctx.send(f"{channel.mention} was already set for Mission Launch Activity.", ephemeral=True)


    @commands.hybrid_command(name="delete_character", description = "Delete a user's character")
    @is_guild_owner()
    async def delete_character(self, ctx: commands.Context, member: discord.Member):

        if not member:
            raise commands.BadArgument(message="Mention a member to delete character")

        user_data = await self.user_collection.find_one({"_id": member.id})

        # Build character information fields
        missions_completed = user_data.get("missions_completed", 0)

        fields = [
            ("CITIZEN NAME", user_data.get("citizen_name", "Unknown")),
            ("CITIZENSHIP", user_data.get("citizenship", "Unknown")),
            ("PLACE OF BIRTH", user_data.get("place_of_birth", "Unknown")),
            ("MISSIONS COMPLETED", str(missions_completed)),
        ]

        # Add biography if it exists
        biography = user_data.get("biography", "")
        if biography:
            fields.append(("BIOGRAPHY", biography))

        reason_block = response_messages.general_transmission(
            transmission="CHARACTER PROFILE",
            fields=fields,
            box_text="CITIZEN DATABASE",
            is_space=True,
        )

        embed = dos_style_embed_builder(title=" ", reason_block=reason_block)

        view = GenericMissionView()

        async def delete_callback(interaction: discord.Interaction):
            await self.delete_character_button_click(interaction, view)

        async def cancel_callback(interaction: discord.Interaction):
            await self.cancel_callback_buton(interaction, view)

        buttons = [
            ButtonSchema(
                label="Delete",
                style= discord.ButtonStyle.danger,
                emoji="🗑️",
                custom_id=f"{member.id}",
                callback = delete_callback
            ),
            ButtonSchema(
                label="Cancel",
                style=discord.ButtonStyle.gray,
                emoji="❌",
                custom_id=f"cancel_{member.id}",
                callback= cancel_callback
            ),
        ]
        view.add_buttons(buttons=buttons)

        await ctx.send(embed=embed, view= view)

    async def cancel_callback_buton(self, interaction: discord.Interaction, view: discord.ui.View):
        await interaction.response.defer()
        view.stop()
        for item in view.children:
            item.disabled = True
        await interaction.edit_original_response(content="Character deletion process canceled.", view=view)

    async def delete_character_button_click(self, interaction: discord.Interaction, view: discord.ui.View):
        await interaction.response.defer()
        custom_id = interaction.data.get("custom_id")
        user_id = int(custom_id)
        delete_user = await self.user_collection.delete_one({"_id": user_id})

        user = interaction.guild.get_member(user_id)

        view.stop()
        for item in view.children:
            item.disabled = True

        if delete_user.deleted_count > 0:
            await interaction.edit_original_response(content=f"{user.name}\'s data deleted from registry", view=view)

        else:
            await interaction.edit_original_response(content=f"Failed to delete {user.name}\'s data from registry", view=view)


    @commands.hybrid_command(name="delete_all_mission", description="Delete all mission from database")
    @is_guild_owner()
    async def delete_all_mission(self, ctx: commands.Context):
        all_missions = await self.mission_collection.find().to_list(length=None)

        if len(all_missions) <= 0:
            await ctx.send(f"No mission exist.", ephemeral= True)
            return

        view = GenericMissionView()

        async def yes_delete(interaction: discord.Interaction):
            await self.mission_collection.drop()
            await interaction.response.edit_message(content="✅ All missions are deleted.", view=None)

        async def no_delete(interaction: discord.Interaction):
            await interaction.response.edit_message(content="Canceled", view=None)

        buttons = [
            ButtonSchema(
                label="YES",
                style= discord.ButtonStyle.danger,
                emoji="🗑️",
                custom_id="delete_mission",
                callback= yes_delete
            ),
            ButtonSchema(
                label="NO",
                style=discord.ButtonStyle.gray,
                emoji="🗑️",
                custom_id="cancel_delete",
                callback=no_delete
            )
        ]
        view.add_buttons(buttons= buttons)
        await ctx.send(f"Are you sure! You want to delete {len(all_missions)} missions", view= view)

    @commands.hybrid_command(name="delete_all_ships", description="Delete all mission from database")
    @is_guild_owner()
    async def delete_all_ships(self, ctx: commands.Context):
        all_ships = await self.ship_collection.find().to_list(length=None)

        if len(all_ships) <= 0:
            await ctx.send(f"No ships exist.", ephemeral=True)
            return

        view = GenericMissionView()

        async def yes_delete(interaction: discord.Interaction):
            await self.ship_collection.drop()
            await interaction.response.edit_message(content="✅ All ships are deleted.", view=None)

        async def no_delete(interaction: discord.Interaction):
            await interaction.response.edit_message(content="Canceled", view=None)

        buttons = [
            ButtonSchema(
                label="YES",
                style=discord.ButtonStyle.danger,
                emoji="🗑️",
                custom_id="delete_ships",
                callback=yes_delete
            ),
            ButtonSchema(
                label="NO",
                style=discord.ButtonStyle.gray,
                emoji="🗑️",
                custom_id="cancel_delete",
                callback=no_delete
            )
        ]
        view.add_buttons(buttons=buttons)
        await ctx.send(f"Are you sure! You want to delete {len(all_ships)} ships", view=view)

    @commands.hybrid_command(
        name="reset_onboarding",
        description="Reset a user's onboarding state so they must complete onboarding again."
    )
    @is_guild_owner()
    async def reset_onboarding(self, ctx: commands.Context, member: discord.Member):
        """Reset a user's onboarding status, requiring them to complete the onboarding flow again."""
        await ctx.defer(ephemeral=True)

        if not member:
            raise commands.BadArgument(message="Mention a member to reset their onboarding.")

        # Check if user exists in database
        user_data = await self.user_collection.find_one({"_id": member.id})

        if not user_data:
            reason_block = response_messages.general_transmission(
                transmission="USER NOT FOUND",
                box_text="ONBOARDING RESET FAILED",
                fields=[
                    ("TARGET USER", f"@{member.name}"),
                    ("STATUS", "No record found in citizen database"),
                ],
                footer=[
                    "❌ This user has no existing registration data.",
                    "They will be prompted to onboard on their next command.",
                ],
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block, color=discord.Color.orange())
            await ctx.send(embed=embed, ephemeral=True)
            return

        # Check if user is already not onboarded
        if not user_data.get("onboarding", False):
            reason_block = response_messages.general_transmission(
                transmission="ALREADY PENDING",
                box_text="ONBOARDING STATUS",
                fields=[
                    ("TARGET USER", f"@{member.name}"),
                    ("CURRENT STATUS", "Onboarding not completed"),
                ],
                footer=[
                    "⚠️ This user has not completed onboarding.",
                    "No reset required.",
                ],
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block, color=discord.Color.yellow())
            await ctx.send(embed=embed, ephemeral=True)
            return

        # Reset onboarding flag
        update_result = await self.user_collection.update_one(
            {"_id": member.id},
            {"$set": {"onboarding": False}}
        )

        if update_result.modified_count > 0:
            reason_block = response_messages.general_transmission(
                transmission="ONBOARDING RESET",
                box_text="CITIZEN RE-REGISTRATION REQUIRED",
                fields=[
                    ("RESET BY", f"@{ctx.author.name}"),
                    ("TARGET USER", f"@{member.name}"),
                    ("PREVIOUS STATUS", "✅ Onboarding Complete"),
                    ("NEW STATUS", "⏳ Onboarding Required"),
                ],
                footer=[
                    f"✅ {member.name}'s onboarding state has been reset.",
                    "They will be prompted to complete onboarding on their next command.",
                    "\n",
                    "📋 User data (RP, missions, etc.) has been preserved.",
                ],
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block, color=discord.Color.green())
            await ctx.send(embed=embed, ephemeral=True)
        else:
            reason_block = response_messages.database_error_message(command_name=ctx.command.name)
            embed = dos_style_embed_builder("`DATABASE ERROR`", reason_block)
            await ctx.send(embed=embed, ephemeral=True)

    @commands.hybrid_command(
        name="reset_all_onboarding",
        description="Reset ALL users' onboarding state. Use with caution!"
    )
    @is_guild_owner()
    async def reset_all_onboarding(self, ctx: commands.Context):
        """Reset onboarding status for all users in the database."""
        
        # Count users with onboarding = true
        onboarded_count = await self.user_collection.count_documents({"onboarding": True})
        total_users = await self.user_collection.count_documents({})

        if onboarded_count == 0:
            reason_block = response_messages.general_transmission(
                transmission="NO ACTION REQUIRED",
                box_text="ONBOARDING STATUS",
                fields=[
                    ("TOTAL USERS", str(total_users)),
                    ("ONBOARDED USERS", "0"),
                ],
                footer=[
                    "⚠️ No users have completed onboarding.",
                    "Nothing to reset.",
                ],
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block, color=discord.Color.yellow())
            await ctx.send(embed=embed, ephemeral=True)
            return

        # Create confirmation view
        view = GenericMissionView()

        async def confirm_reset(interaction: discord.Interaction):
            # Reset all users' onboarding
            result = await self.user_collection.update_many(
                {"onboarding": True},
                {"$set": {"onboarding": False}}
            )

            reason_block = response_messages.general_transmission(
                transmission="MASS ONBOARDING RESET",
                box_text="ALL CITIZENS REQUIRE RE-REGISTRATION",
                fields=[
                    ("RESET BY", f"@{interaction.user.name}"),
                    ("USERS AFFECTED", str(result.modified_count)),
                    ("NEW STATUS", "⏳ Onboarding Required"),
                ],
                footer=[
                    f"✅ {result.modified_count} user(s) will need to complete onboarding again.",
                    "All user data (RP, missions, etc.) has been preserved.",
                    "\n",
                    "⚠️ This action has been logged.",
                ],
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block, color=discord.Color.green())
            await interaction.response.edit_message(embed=embed, view=None)

        async def cancel_reset(interaction: discord.Interaction):
            reason_block = response_messages.general_transmission(
                transmission="OPERATION CANCELLED",
                box_text="ONBOARDING RESET ABORTED",
                fields=[
                    ("CANCELLED BY", f"@{interaction.user.name}"),
                    ("USERS UNAFFECTED", str(onboarded_count)),
                ],
                footer=[
                    "❌ Mass onboarding reset was cancelled.",
                    "No changes were made.",
                ],
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block, color=discord.Color.red())
            await interaction.response.edit_message(embed=embed, view=None)

        buttons = [
            ButtonSchema(
                label="CONFIRM RESET",
                style=discord.ButtonStyle.danger,
                emoji="⚠️",
                custom_id="confirm_reset_all",
                callback=confirm_reset
            ),
            ButtonSchema(
                label="CANCEL",
                style=discord.ButtonStyle.secondary,
                emoji="❌",
                custom_id="cancel_reset_all",
                callback=cancel_reset
            )
        ]
        view.add_buttons(buttons=buttons)

        # Warning embed
        reason_block = response_messages.general_transmission(
            transmission="⚠️ DANGEROUS OPERATION ⚠️",
            box_text="MASS ONBOARDING RESET",
            fields=[
                ("TOTAL USERS", str(total_users)),
                ("USERS TO RESET", str(onboarded_count)),
                ("ACTION", "Set onboarding = false for ALL users"),
            ],
            footer=[
                "⚠️ WARNING: This will require ALL users to complete onboarding again!",
                "User data (RP, missions, profile) will be preserved.",
                "\n",
                "Are you absolutely sure you want to proceed?",
            ],
        )
        embed = dos_style_embed_builder(title=" ", reason_block=reason_block, color=discord.Color.red())
        await ctx.send(embed=embed, view=view, ephemeral=True)


async def setup(bot: commands.Bot):
    await bot.add_cog(OwnerCommands(bot=bot))
