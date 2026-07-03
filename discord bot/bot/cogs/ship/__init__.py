from bot.cogs.ship.crew_commands import CrewCommands
from bot.cogs.ship.ship_commands import ShipCommands


async def setup(bot):
    await bot.add_cog(ShipCommands(bot=bot))
    await bot.add_cog(CrewCommands(bot=bot))