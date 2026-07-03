from discord.ext import commands

from bot.core.constant import Db_Constant
from bot.utils import views


class ServerCommand(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.collection = self.bot.db[Db_Constant.GUILD_CONFIG_COLLECTION]

    @commands.hybrid_command(name="help", description="Displays a list of all available commands, categorized.")
    async def help(self, ctx: commands.Context):
        categorized_commands = {}
        for cog_name, cog in self.bot.cogs.items():
            if cog_name.startswith("_"):  # Skip internal cogs
                continue
            
            commands_in_cog = []
            for command in cog.get_commands():
                if not command.hidden:
                    commands_in_cog.append({"name": command.name, "description": command.description or "No description provided."})
            
            if commands_in_cog:
                categorized_commands[cog_name] = commands_in_cog

        if not categorized_commands:
            await ctx.send("No commands available.", ephemeral=True)
            return

        view = views.HelpView(categorized_commands)
        await ctx.send(embed=view.get_current_page_embed(), view=view)



    
        
    
    


async def setup(bot: commands.Bot):
    await bot.add_cog(ServerCommand(bot=bot))
