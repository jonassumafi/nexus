from bot.cogs.profile.character import Character


async def setup(bot):
    await bot.add_cog(Character(bot))