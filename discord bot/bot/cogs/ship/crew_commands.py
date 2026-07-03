import discord
from discord.ext import commands

from bot.core import response_messages
from bot.core.constant import Db_Constant
from bot.utils import modals, views
from bot.utils.checks import is_admin
from bot.utils.embeds import dos_style_embed_builder


class CrewCommands(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.collection = self.bot.db[Db_Constant.GUILD_CONFIG_COLLECTION]
        self.ship_collection = self.bot.db[Db_Constant.SHIP]

    @commands.hybrid_command(
        name="add_crew_role", description="Register a new crew role"
    )
    @is_admin()
    async def add_crew_role(self, ctx: commands.Context):
        modal = modals.CrewRoleModal(self.bot)
        await ctx.interaction.response.send_modal(modal)

    @commands.hybrid_command(
        name="edit_crew_role", description="Edit an existing crew role"
    )
    @is_admin()
    async def edit_crew_role(self, ctx: commands.Context):
        guild_id = ctx.guild.id
        guild_config = await self.collection.find_one({"guild_id": guild_id})

        if not guild_config or "crew_roles" not in guild_config or not guild_config["crew_roles"]:
            await ctx.send("No crew roles are configured to edit.", ephemeral=True)
            return

        view = views.EditCrewRoleView(self.bot, guild_config["crew_roles"])
        await ctx.send("Please select a crew role to edit:", view=view, ephemeral=True)

    @commands.hybrid_command(name="remove_crew_role", description="Remove crew role")
    @is_admin()
    async def remove_crew_role(self, ctx: commands.Context):
        guild_id = ctx.guild.id
        guild_config = await self.collection.find_one({"guild_id": guild_id})

        if not guild_config or "crew_roles" not in guild_config or not guild_config["crew_roles"]:
            await ctx.send("No crew roles are configured to delete.", ephemeral=True)
            return

        view = views.DeleteCrewRoleView(self.bot, guild_config["crew_roles"])
        await ctx.send("Please select a crew role to delete:", view=view, ephemeral=True)

    @commands.hybrid_command(
        name="crew_role_list", description="Get the full crew list"
    )
    async def crew_role_list(self, ctx: commands.Context):

        result = await self.collection.find_one({"guild_id": ctx.guild.id})
        crew_roles = result.get("crew_roles", [])

        crew = [(c["name"], c["emoji"]) for c in crew_roles]

        reason_block = response_messages.crew_role_list(crew=crew)
        embed = dos_style_embed_builder(
            title=" ", reason_block=reason_block, color=discord.Color.green()
        )
        await ctx.send(embed=embed, ephemeral=True)

