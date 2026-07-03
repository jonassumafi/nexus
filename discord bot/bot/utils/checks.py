from discord.ext import commands

from bot.core.constant import Db_Constant


def is_admin():
    async def predicate(ctx: commands.Context):
        # Owner or admin bypass
        if ctx.author.guild_permissions.administrator or ctx.author.id == ctx.guild.owner_id:
            return True

        guild_config_collection = ctx.bot.db[Db_Constant.GUILD_CONFIG_COLLECTION]
        guild_config = await guild_config_collection.find_one(
            {"guild_id": ctx.guild.id}
        )

        if guild_config and guild_config.get("allowed_roles"):
            allowed_role_ids = [r["id"] for r in guild_config["allowed_roles"]]
            user_role_ids = [r.id for r in ctx.author.roles]

            if any(role_id in allowed_role_ids for role_id in user_role_ids):
                return True

        return False  # Return False instead of None for clarity

    return commands.check(predicate)



def is_guild_owner():
    async def predicate(ctx: commands.Context):
        allowed_user = {ctx.guild.owner_id, 475357995367137282}
        if ctx.author.id not in allowed_user:
            raise commands.NotOwner
        return True

    return commands.check(predicate)
