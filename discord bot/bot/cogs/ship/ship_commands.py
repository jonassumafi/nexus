import asyncio

import discord
from apscheduler.triggers.interval import IntervalTrigger
from discord.ext import commands
from motor.motor_asyncio import AsyncIOMotorCollection

from bot.cogs.ship import ship_views, ship_modals as modals
from bot.core import response_messages
from bot.core.constant import Db_Constant
from bot.core.response_messages import general_transmission
from bot.utils.checks import is_admin, is_guild_owner
from bot.utils.embeds import dos_style_embed_builder
from bot.utils.helepr import ship_prefix
from bot.utils.pagination import ShipPaginator, FleetEfficiencyPaginator

import os
import shutil
import aiohttp
from datetime import datetime
from bot.cogs.ship.ship_views import ShipCategorySelectView
from bot.cogs.ship.ship_modals import ShipModelNameModal
from bot.cogs.ship.ship_model_image import (
    ship_model_public_id,
    upload_ship_model_image,
    get_ship_model_resource,
    delete_ship_model_resource
)
from bot.core.models.database_models import ShipModelCreate


class ShipCommands(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.collection: AsyncIOMotorCollection = self.bot.db[Db_Constant.SHIP]
        self.mission_collection: AsyncIOMotorCollection = self.bot.db[
            Db_Constant.MISSION
        ]
        self.server_collection: AsyncIOMotorCollection = self.bot.db[
            Db_Constant.GUILD_CONFIG_COLLECTION
        ]
        self.bot.scheduler.add_job(
            self.update_crew_fill_percentage,
            trigger=IntervalTrigger(minutes=2),
            id="update_ship_fill",
            replace_existing=True,
        )

    async def update_crew_fill_percentage(self):
        ship_config = self.collection.find()
        async for ship in ship_config:
            crew_roles = ship.get("crew_roles", {})
            total_slot = 0
            total_filled = 0

            for role_data in crew_roles.values():

                total_slot += role_data.get("slots", 0)
                total_filled += len(role_data.get("filled", []))

                if total_slot == 0:
                    fill_parcentage = 0
                else:
                    fill_parcentage = round((total_filled / total_slot) * 100)

                await self.collection.update_one(
                    {"_id": ship["_id"]},
                    {"$set": {"crew_fill_parcentage": fill_parcentage}},
                )

    @commands.hybrid_command(name="ships", description="Manage Ship Commmands")
    async def ships(self, ctx: commands.Context):

        if ctx.invoked_subcommand is None:
            fields = [
                ("/registership", "Register a new ship with default crew layout."),
                ("/editship", "Update a ship"),
                ("/removeship", "Remove a ship from your personal registry"),
                ("/listship", "View all registed ships"),
                ("/addshiptype", "Add a new ship type."),
                ("/editshiptype", "Edit an existing ship type."),
                ("/listshiptypes", "List all configured ship types."),
                ("/deleteshiptype", "Delete an existing ship type."),
            ]
            footer = [
                "✅ You may only edit ships you have registered",
                "🔐 Mission officers can assign any ship to missions",
            ]

            reason_block = response_messages.general_transmission(
                transmission="SHIP OPERATIONS MODULE LOADED",
                fields=fields,
                footer=footer,
                box_text="SHIP MANAGEMENT COMMANDS",
            )

            embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
            await ctx.send(embed=embed)

    @commands.hybrid_command(
        name="addshiptype",
        description="Adds a new ship type to the guild configuration.",
    )
    @is_admin()
    async def addshiptype(self, ctx: commands.Context):
        modal = modals.ShipTypeModal(self.bot, ctx.guild.id, mode="add")
        await ctx.interaction.response.send_modal(modal)

    @commands.hybrid_command(
        name="editshiptype", description="Edits an existing ship type."
    )
    @is_admin()
    async def editshiptype(self, ctx: commands.Context):
        guild_config = await self.server_collection.find_one({"guild_id": ctx.guild.id})
        ship_types = guild_config.get("ship_types", [])

        if not ship_types:
            await ctx.send("No ship types configured for this server.", ephemeral=True)
            return

        view = ship_views.EditShipTypeView(self.bot, ship_types)
        await ctx.send("Select a ship type to edit:", view=view, ephemeral=True)

    @commands.hybrid_command(
        name="listshiptypes", description="Lists all configured ship types."
    )
    async def listshiptypes(self, ctx: commands.Context):
        guild_config = await self.server_collection.find_one({"guild_id": ctx.guild.id})
        ship_types = guild_config.get("ship_types", [])

        if not ship_types:
            await ctx.send("No ship types configured for this server.", ephemeral=True)
            return

        fields = []
        for st in ship_types:
            fields.append((f"{st.get('emoji', '')} {st['name']}", st["description"]))

        reason_block = response_messages.general_transmission(
            transmission="CONFIGURED SHIP TYPES",
            fields=fields,
            box_text="SHIP TYPE DATABASE",
            is_space=True,
        )
        embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
        await ctx.send(embed=embed)

    @commands.hybrid_command(
        name="deleteshiptype",
        description="Deletes a ship type from the guild configuration.",
    )
    @is_admin()
    async def deleteshiptype(self, ctx: commands.Context):
        guild_config = await self.server_collection.find_one({"guild_id": ctx.guild.id})
        ship_types = guild_config.get("ship_types", [])

        if not ship_types:
            await ctx.send("No ship types configured for this server.", ephemeral=True)
            return

        view = ship_views.DeleteShipTypeView(self.bot, ship_types)
        await ctx.send("Select a ship type to delete:", view=view, ephemeral=True)

    @commands.hybrid_command(
        name="registership", description="Register a new ship with default crew layout "
    )
    async def registership(self, ctx: commands.Context):
        # Step 1: Get ship name and description via modal
        ship_modal = modals.ShipRegistrationModal()
        await ctx.interaction.response.send_modal(ship_modal)
        await ship_modal.wait()

        if ship_modal.name is None or ship_modal.description is None:
            await ctx.interaction.followup.send(
                "Ship registration cancelled or timed out.", ephemeral=True
            )
            return

        name = ship_modal.name
        description = ship_modal.description

        # Step 2: Get ship type via selection menu
        guild_config = await self.server_collection.find_one({"guild_id": ctx.guild.id})
        ship_types = guild_config.get("ship_types", [])

        if not ship_types:
            await ctx.interaction.followup.send(
                "No ship types configured for this server. Please add some first.",
                ephemeral=True,
            )
            return

        ship_type_view = ship_views.ShipTypeSelectView(
            ctx.author, ship_types, name, description
        )

        # Send the initial message with the select menu
        initial_message = await ctx.interaction.followup.send(
            "Please select a ship type:", view=ship_type_view, ephemeral=True
        )

        await ship_type_view.wait()

        if ship_type_view.selected_ship_type is None:
            await initial_message.edit(
                content="Ship type selection cancelled or timed out.", view=None
            )
            return

        ship_type = ship_type_view.selected_ship_type

        # Edit the initial message to remove the view
        await initial_message.edit(
            content="Ship type selected. Proceeding with registration...", view=None
        )

        existing_ship = await self.collection.find_one(
            {"owner_id": ctx.author.id, "ship_name": name.upper()}
        )

        # The rest of the original registership logic continues here, using 'name', 'description', and 'ship_type'
        # obtained from the modal and select menu.

        guild_config = await self.server_collection.find_one({"guild_id": ctx.guild.id})
        prefix = await ship_prefix(guild_config=guild_config)
        max_ship = guild_config.get("maxships", 2)
        print(f"Max ship {max_ship}")

        user_all_ships = await self.collection.find(
            {"owner_id": ctx.author.id}
        ).to_list(length=None)

        if len(user_all_ships) >= max_ship:
            await ctx.send(f"You can not register ships more than two.", ephemeral=True)
            return

        print(f"All ships {len(user_all_ships)}")

        if existing_ship:
            owner_id = existing_ship.get("owner_id")
            owner = ctx.guild.get_member(owner_id)
            reason_block = response_messages.general_transmission(
                transmission="REGISTRATION FAILED",
                box_text="ERROR: DUPLICATE ENTRY",
                footer=[
                    f"A ship with the name '{prefix} {name.upper()}' is already in the fleet registry.",
                    "Please choose a different name.",
                ],
                fields=[
                    ("REGISTERED BY", f"{owner.name.upper()}"),
                    ("SHIP NAME", f"{prefix} {name.upper()}"),
                    ("DESCRIPTION", f"{description}"),
                    ("TYPE", ship_type.upper()),
                ],
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
            await ctx.send(embed=embed)
            return

        boxt_text = "FLEET DATABASE UPDATE"

        # Fetch crew configuration for the interactive part role name and emojis

        crew_config_doc = await self.server_collection.find_one(
            {"guild_id": ctx.guild.id}
        )
        if not crew_config_doc or not crew_config_doc.get("crew_roles"):
            await ctx.send(
                "No crew roles configured for this server. Please add some first.",
                ephemeral=True,
            )
            return

        crew_config = crew_config_doc.get("crew_roles", [])

        # --- Create and use the interactive view ---
        view = ship_views.InteractiveRoleSetupView(author=ctx.author, roles=crew_config)

        # This function builds the embed content string
        fields = [
            ("REGISTERED BY", f"{ctx.author.name.upper()}"),
            ("SHIP NAME", f"{prefix} {name.upper()}"),
            ("DESCRIPTION", f"{description}"),
            ("TYPE", ship_type.upper()),
        ]

        def make_reason_block(slots):
            base_block = response_messages.registership_response(
                transmission="SHIP REGISTRATION IN PROGRESS",
                fields=fields,
                box_text=boxt_text,
                footer=[],  # Footer will be handled separately
            )
            setup_title = "\n\n[ CREW SLOT SETUP ]\n"
            setup_desc = (
                "> Click a role button to set slots. Click Done when finished.\n"
            )
            crew_roles = [
                (role["emoji"], role["name"], slots.get(role["name"], 0))
                for role in crew_config
            ]
            crew_list_box = response_messages.generate_crew_box_with_count(
                crew_roles=crew_roles
            )

            return base_block + setup_title + setup_desc + crew_list_box

        # Override the view's update method to use our embed builder
        async def update_embed(interaction: discord.Interaction):
            new_block = make_reason_block(view.slots)
            new_embed = dos_style_embed_builder(
                title=" ", reason_block=new_block, color=discord.Color.yellow()
            )
            await interaction.response.edit_message(embed=new_embed)

        view.update_embed = update_embed
        # Send the initial message with the view
        initial_block = make_reason_block(view.slots)
        initial_embed = dos_style_embed_builder(title=" ", reason_block=initial_block)
        interactive_message = await ctx.send(embed=initial_embed, view=view)

        # Wait for the view to complete (Done button clicked or timeout)
        final_slots = await view.interaction_complete

        if final_slots is None:  # Timeout
            await interactive_message.edit(
                content="Ship registration timed out.", view=None, embed=None
            )
            return

        # --- Save to DB and Finalize ---
        final_crew_roles = {
            role: {"slots": slots, "filled": []}
            for role, slots in final_slots.items()
            if slots > 0
        }

        # If not, create the new ship
        await self.collection.insert_one(
            {
                "guild_id": ctx.guild.id,
                "ship_name": name.upper(),
                "description": description,
                "owner_id": ctx.author.id,
                "type": ship_type.upper(),
                "is_mission": False,
                "crew_roles": {},
                "missions_completed": 0,
                "crew_fill_parcentage": 0,
                "current_mission_id": None,
            }
        )

        await asyncio.sleep(1)

        update = await self.collection.update_one(
            {"owner_id": ctx.author.id, "ship_name": name.upper()},
            {"$set": {"crew_roles": final_crew_roles}},
        )

        if update.modified_count == 0:
            await ctx.send(f"Failed to update database", ephemeral=True)

        await asyncio.sleep(3)

        print("passed the db insert")
        ship_config = await self.collection.find_one(
            {"owner_id": ctx.author.id, "ship_name": name.upper()}
        )
        crew_details = await self.get_crew_list(
            ship_config=ship_config, crew_config=crew_config_doc
        )

        crew_box = response_messages.generate_crew_status_box(crew_status=crew_details)

        print(f"\n\nCrew DEtails {crew_details} \n\n crew_box {crew_box}")

        new_block = response_messages.general_transmission(
            transmission="SHIP REGISTRATION SUCCESSFUL",
            box_text="FLEET DATABASE UPDATE",
            fields=fields,
            footer=[
                crew_box,
                "\n"
                f"✅ Use [34m/addship `{prefix} {name.upper()}`[0m during mission setup to assign this  SHIP",
                f"❌ Use [34m/removeship `{prefix} {name.upper()}`[0m to decommission this ship",
            ],
        )
        new_embed = dos_style_embed_builder(
            title=" ", reason_block=new_block, color=discord.Color.green()
        )
        await interactive_message.edit(embed=new_embed, view=None)

    ### ------------------------------------------------------------------------ ###

    async def get_crew_list(self, ship_config, crew_config):

        ship_crew_list = ship_config.get("crew_roles")
        # print(f"Ship Crew Config {ship_crew_list}")
        crew_list = crew_config.get("crew_roles", [])
        # print(f"\nCrew List {crew_list}")
        crew_details = []
        for crew in crew_list:
            crew_name = crew["name"]
            emoji = crew["emoji"]
            if crew_name in ship_crew_list:
                role_data = ship_crew_list[crew_name]
                slots = role_data.get("slots", 0)
                filled = role_data.get("filled", [])
                available = slots - len(filled)
                # print(f"available {available}")
                crew_details.append((emoji, crew_name, available == 0, slots))
        return crew_details

    ### ------------------------------------------------------------------------ ###

    @commands.hybrid_command(name="view_ship", description="View Ship Details")
    async def view_ship(self, ctx: commands.Context, ship_name: str):
        guild_config = await self.server_collection.find_one({"guild_id": ctx.guild.id})
        prefix = await ship_prefix(guild_config=guild_config)
        ship_config = await self.collection.find_one({"ship_name": ship_name.upper()})

        # print(ship_config)

        if not ship_config:
            reason_block = response_messages.general_transmission(
                transmission="NOT FOUND", box_text="FLEET DATABASE ERROR"
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
            await ctx.send(embed=embed)
            return

        ship_owner_id = ship_config.get("owner_id")
        ship_owner = ctx.guild.get_member(ship_owner_id)
        ship_name = ship_config.get("ship_name")
        ship_description = ship_config.get("description")
        ship_type = ship_config.get("type")
        completed = ship_config.get("missions_completed")

        crew_config = await self.server_collection.find_one({"guild_id": ctx.guild.id})
        crew_details = await self.get_crew_list(
            crew_config=crew_config, ship_config=ship_config
        )
        crew_box = response_messages.generate_crew_status_box(crew_status=crew_details)

        mission_id = ship_config.get("current_mission_id", None)
        mission_config = await self.mission_collection.find_one({"_id": mission_id})
        mission_name = None
        if mission_config is not None:
            mission_name = mission_config.get("name", None)

        print("this is section passed")

        print(f"{ship_owner_id} {ship_name}")

        fields = [
            ("SHIP NAME", f"{prefix} {ship_name.upper()}"),
            ("REGISTERED BY", ship_owner.name.upper() if ship_owner else "UNKNOWN"),
            ("DESCRIPTION", ship_description),
            ("TYPE", ship_type),
            ("ASSIGNED TO", f"{mission_name}"),
            ("MISSION COMPLETED", f"{completed}"),
        ]
        new_block = response_messages.general_transmission(
            transmission="SHIP PROFILE ACCESSED",
            box_text="SHIP DATABASE",
            fields=fields,
            footer=[
                crew_box,
                "\n"
                f"✅ Use [34m/addship `{ship_name.upper()}`[0m during mission setup to assign this SHIP",
                f"❌ Use [34m/removeship `{ship_name.upper()}`[0m to decommission this ship",
            ],
        )

        new_embed = dos_style_embed_builder(
            title=" ", reason_block=new_block, color=discord.Color.green()
        )

        await ctx.send(embed=new_embed)

    @commands.hybrid_command(
        name="listships", description="Displays a list of all registered ships"
    )
    async def listships(self, ctx: commands.Context):
        await ctx.defer()

        ships = await self.collection.find({}).to_list(length=None)
        guild_config = await self.server_collection.find_one({"guild_id": ctx.guild.id})
        prefix = await ship_prefix(guild_config=guild_config)
        if not ships:
            return await ctx.send("No ships found.")

        view = ShipPaginator(ships, ctx, prefix)
        embed = view.get_embed()

        msg = await ctx.send(embed=embed, view=view)
        view.message = msg

    @commands.hybrid_command(
        name="removeship",
        description="Permanently removes a ship you own from the registry.",
    )
    @is_admin()
    async def removeship(self, ctx: commands.Context, ship_name: str):
        guild_config = await self.server_collection.find_one({"guild_id": ctx.guild.id})
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

        ship_config = await self.collection.find_one({"ship_name": ship_name.upper()})
        if not ship_config:
            reason_block = response_messages.general_transmission(
                transmission="NOT FOUND", box_text="FLEET DATABASE ERROR"
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
            await ctx.send(embed=embed)
            return
        print(ship_config)
        owner_id = ship_config.get("owner_id")

        if owner_id != ctx.author.id and is_admin():
            reason_block = response_messages.general_transmission(
                transmission="INSUFFICIENT PERMISSION LEVEL",
                box_text="SECURITY WARNING",
                fields=[
                    ("USER", f"@{ctx.author.name.upper()}"),
                    ("COMMAND BLOCKED", f"/{ctx.command.name.upper()}"),
                    ("REQUIRED ROLE", "SHIP OWNER OR PREMIER | STAR CAPTAIN"),
                ],
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
            await ctx.send(embed=embed)
            return

        delete = await self.collection.delete_one({"ship_name": ship_name.upper()})

        if delete.deleted_count > 0:
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

    @commands.hybrid_command(name="editship", description="Edit a ship")
    async def editship(self, ctx: commands.Context, ship_name: str):

        ship_config = await self.collection.find_one({"ship_name": ship_name.upper()})

        if not ship_config:
            reason_block = response_messages.general_transmission(
                transmission="NOT FOUND", box_text="FLEET DATABASE ERROR"
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
            await ctx.send(embed=embed, ephemeral=True)
            return

        is_mission = ship_config.get("is_mission", False)
        if is_mission:
            reason_block = response_messages.general_transmission(
                transmission="CAN NOT EDIT", box_text="SHIP IS IN A MISSION"
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
            await ctx.send(embed=embed, ephemeral=True)
            return

        # Owner check
        is_ship_owner = ship_config.get("owner_id") == ctx.author.id
        guild_owner = await is_guild_owner().predicate(ctx)
        if not (is_ship_owner or guild_owner):
            raise commands.NotOwner

        # Step 1: Get new ship name and description via modal
        edit_modal = modals.EditShipModal(
            current_name=ship_config.get("ship_name", ""),
            current_description=ship_config.get("description", ""),
        )
        await ctx.interaction.response.send_modal(edit_modal)
        await edit_modal.wait()

        if edit_modal.name_value is None or edit_modal.description_value is None:
            await ctx.send("Ship edit cancelled or timed out.", ephemeral=True)
            return

        new_ship_name = edit_modal.name_value
        new_ship_description = edit_modal.description_value

        # Step 2: Get new ship type via selection menu
        guild_config = await self.server_collection.find_one({"guild_id": ctx.guild.id})
        ship_types = guild_config.get("ship_types", [])

        if not ship_types:
            await ctx.send(
                "No ship types configured for this server. Please add some first.",
                ephemeral=True,
            )
            return

        ship_type_view = ship_views.ShipTypeSelectView(
            ctx.author, ship_types, new_ship_name, new_ship_description
        )

        # Send the initial message with the select menu
        initial_message = await ctx.send(
            "Please select a new ship type:", view=ship_type_view, ephemeral=True
        )

        await ship_type_view.wait()

        if ship_type_view.selected_ship_type is None:
            await initial_message.edit(
                content="Ship type selection cancelled or timed out.", view=None
            )
            return

        new_ship_type = ship_type_view.selected_ship_type

        # Edit the initial message to remove the view
        await initial_message.edit(
            content="Ship type selected. Proceeding with update...", view=None
        )

        # Rest of your existing editship logic starts here
        # The variables 'new_ship_name', 'new_ship_description', and 'new_ship_type' are now available.
        # No need for ctx.defer() here as it was already deferred at the beginning of the command.
        # The ship_config and prefix are already fetched above.
        prefix = await ship_prefix(
            guild_config=guild_config
        )  # Re-fetch prefix as it might be used later

        # Now proceed with the update logic

        update = await self.collection.update_one(
            {"ship_name": ship_name.upper()},
            {
                "$set": {
                    "ship_name": new_ship_name.upper(),
                    "description": new_ship_description,
                    "type": new_ship_type.upper(),
                }
            },
        )
        if update.modified_count > 0 or update.modified_count is not None:
            reason_block = response_messages.general_transmission(
                transmission="SHIP UPDATED",
                box_text="SHIP DATABASE",
                fields=[
                    ("UPDATED BY", f"@{ctx.author.name.upper()}"),
                    ("SHIP NAME", f"{prefix} {ship_name.upper()}"),
                    ("NEW NAME", f"{prefix} {new_ship_name.upper()}"),
                    ("NEW DESCRIPTION", new_ship_description),
                    ("NEW TYPE", new_ship_type.upper()),
                ],
                footer=[
                    f"✅ Use \033[34m/addship `{prefix} {new_ship_name.upper()}`\033[0m during mission setup to assign this SHIP",
                    f"❌ Use \033[34m/removeship `{prefix} {new_ship_name.upper()}`\033[0m to decommission this ship",
                ],
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
            await ctx.send(embed=embed)
        else:
            reason_block = response_messages.general_transmission(
                transmission="SHIP UPDATE FAILED",
                box_text="NO CHANGES MADE",
                fields=[
                    ("UPDATED BY", f"@{ctx.author.name.upper()}"),
                    ("SHIP NAME", f"{prefix} {ship_name.upper()}"),
                    ("NEW SHIP NAME", f"{prefix} {new_ship_name.upper()}"),
                    ("NEW SHIP DESCRIPTION", new_ship_description),
                    ("NEW SHIP TYPE", new_ship_type.upper()),
                ],
                footer=[
                    f"❌ The ship update failed. Please try again.",
                ],
            )
            embed = dos_style_embed_builder(" ", reason_block)
            await ctx.send(embed=embed, ephemeral=True)
            return

    @commands.hybrid_command(
        name="editshipcrew", description="Edit the crew roles for a ship"
    )
    async def editshipcrew(self, ctx: commands.Context, ship_name: str):
        await ctx.defer()
        guild_config = await self.server_collection.find_one({"guild_id": ctx.guild.id})

        prefix = await ship_prefix(guild_config=guild_config)

        ship_config = await self.collection.find_one({"ship_name": ship_name.upper()})

        if not ship_config:
            reason_block = response_messages.general_transmission(
                transmission="NOT FOUND", box_text="FLEET DATABASE ERROR"
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
            await ctx.send(embed=embed)
            return

        # Owner check
        is_ship_owner = ship_config.get("owner_id") == ctx.author.id
        guild_owner = await is_guild_owner().predicate(ctx)
        if not (is_ship_owner or guild_owner):
            raise commands.NotOwner

        is_mission = ship_config.get("is_mission", False)
        if is_mission:
            reason_block = response_messages.general_transmission(
                transmission="CAN NOT EDIT", box_text="SHIP IS IN A MISSION"
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
            await ctx.send(embed=embed, ephemeral=True)
            return

        crew_config = await self.server_collection.find_one({"guild_id": ctx.guild.id})
        if not crew_config:
            reason_block = response_messages.general_transmission(
                transmission="NOT FOUND", box_text="FLEET DATABASE ERROR"
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
            await ctx.send(embed=embed)
            return

        current_crew_list = await self.get_crew_list(
            ship_config=ship_config, crew_config=crew_config
        )
        crew_new_box = response_messages.generate_crew_status_box(
            crew_status=current_crew_list
        )

        crew_list = crew_config.get("crew_roles", [])
        print(f"Crew List {crew_list}")
        existing_slots = {
            role_name: config.get("slots", 0)
            for role_name, config in ship_config.get("crew_roles", {}).items()
        }
        view = ship_views.InteractiveRoleSetupView(
            author=ctx.author, roles=crew_list, existing_slots=existing_slots
        )

        ship_owner_id = ship_config.get("owner_id")
        ship_owner = ctx.guild.get_member(ship_owner_id)
        ship_name = ship_config.get("ship_name")
        ship_description = ship_config.get("description")
        ship_type = ship_config.get("type")

        fields = [
            ("SHIP NAME", f"{prefix} {ship_name.upper()}"),
            ("REGISTERED BY", ship_owner.name.upper()),
            ("DESCRIPTION", ship_description),
            ("TYPE", ship_type),
        ]

        boxt_text = "SHIP CREW EDIT"

        def make_reason_block(slots):
            base_block = response_messages.registership_response(
                transmission="SHIP CREW EDITING IN PROGRESS",
                fields=fields,
                box_text=boxt_text,
                footer=[
                    crew_new_box,
                ],  # Footer will be handled separately
            )
            setup_title = "\n\n[ NEW CREW SLOT SETUP ]\n"
            setup_desc = (
                "> Click a role button to set slots. Click Done when finished.\n"
            )
            crew_roles = [
                (role["emoji"], role["name"], slots.get(role["name"], 0))
                for role in crew_list
            ]
            crew_list_box = response_messages.generate_crew_box_with_count(
                crew_roles=crew_roles
            )
            return base_block + setup_title + setup_desc + crew_list_box

        async def update_embed(interaction: discord.Interaction):
            new_block = make_reason_block(view.slots)
            new_embed = dos_style_embed_builder(
                title=" ", reason_block=new_block, color=discord.Color.yellow()
            )
            await interaction.response.edit_message(embed=new_embed)

        view.update_embed = update_embed

        print("Workds fine")

        ##problem block is below

        initial_block = make_reason_block(view.slots)

        initial_embed = dos_style_embed_builder(title=" ", reason_block=initial_block)
        interactive_message = await ctx.send(embed=initial_embed, view=view)
        print("passed the initial_embed")
        final_slots = await view.interaction_complete
        print("passed the final_slots")
        if final_slots is None:
            await interactive_message.edit(
                content="Ship crew edit timed out.", view=None, embed=None
            )
            return

        # Prepare update and unset dicts
        update_fields = {}
        unset_fields = {}

        for role, slots in final_slots.items():
            if slots > 0:
                existing = ship_config.get("crew_roles", {}).get(role, {})
                update_fields[f"crew_roles.{role}"] = {
                    "slots": slots,
                    "filled": existing.get("filled", []),
                }
            else:
                unset_fields[f"crew_roles.{role}"] = ""

        # Perform update
        if update_fields:
            update = await self.collection.update_one(
                {"ship_name": ship_name.upper()},
                {"$set": update_fields},
            )

        if unset_fields:
            await self.collection.update_one(
                {"ship_name": ship_name.upper()},
                {"$unset": unset_fields},
                upsert=True,
            )

        if update.modified_count > 0 or update.modified_count is not None:

            ship_new_config = await self.collection.find_one(
                {"ship_name": ship_name.upper()}
            )

            crew_new_list = await self.get_crew_list(
                ship_config=ship_new_config, crew_config=crew_config
            )
            crew_new_box = response_messages.generate_crew_status_box(
                crew_status=crew_new_list
            )
            reason_block = response_messages.general_transmission(
                transmission="SHIP CREW UPDATED",
                box_text="SHIP DATABASE",
                fields=[
                    ("UPDATED BY", f"@{ctx.author.name.upper()}"),
                    ("SHIP NAME", f"{prefix} {ship_name.upper()}"),
                ],
                footer=[
                    crew_new_box,
                    "\n"
                    f"✅ Use [34m/addship `{prefix} {ship_name.upper()}`[0m during mission setup to assign this SHIP",
                    f"❌ Use [34m/removeship `{prefix} {ship_name.upper()}`[0m to decommission this ship",
                ],
            )
            embed = dos_style_embed_builder(
                title=" ", reason_block=reason_block, color=discord.Color.green()
            )
            await ctx.send(embed=embed)

            await interactive_message.edit(
                content="Ship crew edit complete.", view=None, embed=embed
            )
        else:
            reason_block = response_messages.general_transmission(
                transmission="SHIP CREW UPDATE FAILED",
                box_text="NO CHANGES MADE",
                fields=[
                    ("UPDATED BY", f"@{ctx.author.name.upper()}"),
                    ("SHIP NAME", f"{prefix} {ship_name.upper()}"),
                ],
                footer=[
                    f"❌ The ship crew update failed. Please try again.",
                ],
            )
            embed = dos_style_embed_builder(" ", reason_block)
            await ctx.send(embed=embed, ephemeral=True)

    def _bar10(self, pct: float) -> str:
        """
        Render a 10-segment bar. pct in 0..100
        Example: [######....] for 60%
        """
        pct = max(0.0, min(100.0, float(pct)))
        filled = int(round((pct / 100.0) * 10))  # 10 segments
        filled = min(10, max(0, filled))
        return "[" + ("#" * filled) + ("." * (10 - filled)) + "]"

    @commands.hybrid_command(name="ship_rp", description="Show ship RP detail or fleet efficiency.")
    async def ship_rp(self, ctx: commands.Context, ship_name: str = None):
        """
        Usage: /ship_rp [ship_name]
        If a ship name is provided, it shows detailed RP stats for that ship.
        If no ship name is provided, it shows a paginated list of all ships ranked by efficiency.
        """
        rp_handler = self.bot.get_cog("RpHandler")
        if not rp_handler:
            await ctx.send("RP module not available.", ephemeral=True)
            return

        guild_config = await self.server_collection.find_one({"guild_id": ctx.guild.id})
        prefix = await ship_prefix(guild_config=guild_config)

        if ship_name:
            # Logic for single ship details
            ship_doc = await self.collection.find_one({"ship_name": ship_name.upper()})
            if not ship_doc:
                await ctx.send(f"Ship '{ship_name}' not found.", ephemeral=True)
                return

            ship_total_stats: dict = await rp_handler.get_ship_rp_stats(ship_id=ship_doc["_id"], guild_id=ctx.guild.id)
            if ship_total_stats is None:
                await ctx.send(f"No RP stats found for this ship.", ephemeral=True)
                return

            ship_total_rp = ship_total_stats.get("total_points", 0)
            avg_fill_rate = ship_total_stats.get("avg_fill_rate", 0)
            max_fill_rate = ship_total_stats.get("max_fill_rate", 0)

            fields = [
                ("LIFETIME SHIP RP", f"{ship_total_rp}"),
                ("HIGH-FILL RATE", f"{self._bar10(pct=max_fill_rate)} {max_fill_rate}%"),
                ("MISSIONS ANALYZED", f'{ship_doc["missions_completed"]} (primary + support)'),
                ("AVG FILL AT LAUNCH", f"{avg_fill_rate}%"),
            ]

            dos_embed = general_transmission(
                transmission="SHIP RP — DETAIL",
                box_text=f'{prefix} {ship_doc["ship_name"]} ({ship_doc["type"]})',
                fields=fields,
                footer=["> Ships earn RP when launch fill ≥ threshold"]
            )

            embed = dos_style_embed_builder(title="", reason_block=dos_embed)
            await ctx.send(embed=embed)

        else:
            # Logic for fleet efficiency leaderboard
            await ctx.defer()
            all_ship_stats = await rp_handler.get_all_ship_rp_stats(guild_id=ctx.guild.id)

            if not all_ship_stats:
                await ctx.send("No ship RP data available to generate a report.", ephemeral=True)
                return



            view = FleetEfficiencyPaginator(all_ship_stats, ctx, prefix)
            embed = view.get_embed()
            msg = await ctx.send(embed=embed, view=view)
            view.message = msg

    # ==================== SHIP MODEL MANAGEMENT ====================
    
    @commands.hybrid_command(
        name="make_ship_model",
        description="Create a new ship model with image (Admin only)"
    )
    @is_admin()
    async def make_ship_model(self, ctx: commands.Context):
        """Admin command to create a new ship model."""
        
        # Step 1: Show category selection
        category_view = ShipCategorySelectView(author=ctx.author)
        category_message = await ctx.send(
            "**Step 1/3:** Select a ship manufacturer:",
            view=category_view,
            ephemeral=True
        )
        
        selected_category = await category_view.interaction_complete
        
        if selected_category is None:
            await category_message.edit(
                content="❌ Ship model creation cancelled or timed out.",
                view=None
            )
            return
        
        await category_message.edit(
            content=f"✅ Selected: **{selected_category}**",
            view=None
        )
        
        # Step 2: Ask for model name via message (not modal since interaction is consumed)
        name_prompt = await ctx.send(
            f"**Step 2/3:** Enter the ship model name for **{selected_category}**.\n"
            f"Reply with the model name (e.g., Gladius, Hammerhead) within 60 seconds.",
            ephemeral=True
        )
        
        def name_check(m):
            return m.author.id == ctx.author.id and m.channel.id == ctx.channel.id
        
        try:
            name_msg = await self.bot.wait_for("message", timeout=60.0, check=name_check)
        except asyncio.TimeoutError:
            await ctx.send("❌ Timed out waiting for model name. Please try again.", ephemeral=True)
            return
        
        model_name = name_msg.content.strip()
        
        # Delete the user's name message
        try:
            await name_msg.delete()
        except:
            pass
        
        if not model_name:
            await ctx.send("❌ Invalid model name. Please try again.", ephemeral=True)
            return
        
        # Check for duplicates
        ship_model_collection = self.bot.db[Db_Constant.SHIP_MODEL]
        existing = await ship_model_collection.find_one({
            "category": selected_category,
            "model_name": {"$regex": f"^{model_name}$", "$options": "i"}
        })
        
        if existing:
            await ctx.send(
                f"❌ A ship model named **{model_name}** already exists under **{selected_category}**.",
                ephemeral=True
            )
            return
        
        # Step 3: Ask for image upload
        await ctx.send(
            f"**Step 3/3:** Please upload an image for **{selected_category} {model_name}**.\n"
            f"Upload an image as a reply to this message within 60 seconds.",
            ephemeral=True
        )
        
        def check(m):
            return (
                m.author.id == ctx.author.id and
                m.channel.id == ctx.channel.id and
                len(m.attachments) > 0 and
                m.attachments[0].content_type and
                m.attachments[0].content_type.startswith("image/")
            )
        
        try:
            msg = await self.bot.wait_for("message", timeout=60.0, check=check)
        except asyncio.TimeoutError:
            await ctx.send("❌ Timed out waiting for image upload. Please try again.", ephemeral=True)
            return
        
        attachment = msg.attachments[0]
        
        # Download and upload to Cloudinary
        temp_dir = f"temp/ship_models/{ctx.guild.id}/{ctx.author.id}"
        os.makedirs(temp_dir, exist_ok=True)
        temp_path = f"{temp_dir}/{attachment.filename}"
        
        try:
            # Download image
            async with aiohttp.ClientSession() as session:
                async with session.get(attachment.url) as resp:
                    if resp.status == 200:
                        with open(temp_path, "wb") as f:
                            f.write(await resp.read())
                    else:
                        await ctx.send(f"❌ Failed to download image (status {resp.status}).", ephemeral=True)
                        return
            
            # Upload to Cloudinary with optimization
            public_id = await ship_model_public_id(selected_category, model_name)
            
            # Delete existing if any
            existing_resource = await get_ship_model_resource(public_id)
            if existing_resource:
                await delete_ship_model_resource(public_id)
            
            image_url = await upload_ship_model_image(public_id, temp_path)
            
            # Save to database using Pydantic model
            ship_model = ShipModelCreate(
                category=selected_category,
                model_name=model_name,
                image_url=image_url,
                created_by=ctx.author.id,
                created_at=datetime.now()
            )
            
            await ship_model_collection.insert_one(ship_model.to_mongo_dict())
            
            # Success message
            reason_block = general_transmission(
                transmission="SHIP MODEL CREATED",
                box_text="FLEET DATABASE UPDATE",
                fields=[
                    ("MANUFACTURER", selected_category.upper()),
                    ("MODEL NAME", model_name.upper()),
                    ("CREATED BY", f"@{ctx.author.name.upper()}"),
                ],
                footer=[
                    f"🚀 Ship model is now available for use",
                ]
            )
            embed = dos_style_embed_builder(title="", reason_block=reason_block, color=discord.Color.green())
            embed.set_image(url=image_url)
            
            await ctx.send(embed=embed)
            
            # Try to delete the user's image message
            try:
                await msg.delete()
            except:
                pass
                
        except Exception as e:
            await ctx.send(f"❌ Error creating ship model: {str(e)}", ephemeral=True)
        finally:
            # Cleanup temp files
            try:
                if os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir)
            except:
                pass

    @commands.hybrid_command(
        name="list_ship_models",
        description="View and manage ship models (Admin only)"
    )
    @is_admin()
    async def list_ship_models(self, ctx: commands.Context):
        """Admin command to view, edit, and delete ship models."""
        from bot.cogs.ship.ship_views import ShipModelListView
        
        # Fetch initial models
        ship_model_collection = self.bot.db[Db_Constant.SHIP_MODEL]
        
        per_page = 10
        models = await ship_model_collection.find({}).limit(per_page).to_list(length=per_page)
        total_count = await ship_model_collection.count_documents({})
        
        if total_count == 0:
            await ctx.send("📭 No ship models found. Use `/make_ship_model` to create one.", ephemeral=True)
            return
        
        # Create the list view
        view = ShipModelListView(
            bot=self.bot,
            author=ctx.author,
            models=models,
            total_count=total_count,
            page=1,
            per_page=per_page,
            category_filter="All"
        )
        
        embed = view.get_embed()
        await ctx.send(embed=embed, view=view, ephemeral=True)