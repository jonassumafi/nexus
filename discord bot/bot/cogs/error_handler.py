import discord
from discord import app_commands
from discord.ext import commands

from bot.core import response_messages
from bot.utils.embeds import dos_style_embed_builder


class ErrorHandler(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @commands.Cog.listener()
    async def on_command_error(self, ctx: commands.Context, error):
        if hasattr(ctx.command, "on_error"):
            return

        cog = ctx.cog
        if cog:
            if cog._get_overridden_method(cog.cog_command_error) is not None:
                return

        error = getattr(error, "original", error)

        if isinstance(error, commands.CommandNotFound):
            await ctx.send("Command not found.")
        elif isinstance(error, commands.DisabledCommand):
            await ctx.send(f"{ctx.command} has been disabled.")
        elif isinstance(error, commands.NoPrivateMessage):
            try:
                await ctx.author.send(
                    f"{ctx.command} can not be used in Private Messages."
                )
            except discord.HTTPException:
                pass
        elif isinstance(error, commands.PrivateMessageOnly):
            await ctx.send(f"{ctx.command} can only be used in Private Messages.")
        elif isinstance(error, commands.NotOwner):
            reason_block = response_messages.access_denied_text(
                user=ctx.author.name,
                action=ctx.command.name,
                required="OWNER",
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
            await ctx.send(embed=embed, ephemeral=True)
        elif isinstance(error, commands.MissingPermissions):
            reason_block = response_messages.access_denied_text(
                user=ctx.author.name,
                action=ctx.command.name,
                required="PREMIER or STAR CAPTAIN",
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
            await ctx.send(embed=embed, ephemeral=True)
        elif isinstance(error, commands.BotMissingPermissions):
            await ctx.send("I don't have the required permissions to run this command.")
        elif isinstance(error, commands.CommandOnCooldown):
            await ctx.send(
                f"This command is on cooldown. Please try again in {error.retry_after:.2f}s."
            )
        elif isinstance(error, commands.CheckFailure):
            reason_block = response_messages.access_denied_text(
                user=ctx.author.name,
                action=ctx.command.name,
                required="PREMIER or STAR CAPTAIN",
            )
            embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
            # await ctx.send(embed=embed, ephemeral=True)
            pass
        elif isinstance(error, app_commands.AppCommandError):
            if isinstance(error, app_commands.CommandNotFound):
                await ctx.send("Application command not found.")
            elif isinstance(error, app_commands.CheckFailure):
                reason_block = response_messages.access_denied_text(
                    user=ctx.author.name,
                    action=ctx.command.name,
                    required="PREMIER or STAR CAPTAIN",
                )
                embed = dos_style_embed_builder(title=" ", reason_block=reason_block)
                await ctx.send(embed=embed, ephemeral=True)

            elif isinstance(error, app_commands.MissingPermissions):
                await ctx.send(
                    "You don't have the required permissions to run this application command."
                )
            elif isinstance(error, app_commands.BotMissingPermissions):
                await ctx.send(
                    "I don't have the required permissions to run this application command."
                )
            else:
                await ctx.send("An unexpected application command error occurred.")
                print(error)
        else:
            await ctx.send("An unexpected error occurred.")
            print(error)


async def setup(bot: commands.Bot):
    await bot.add_cog(ErrorHandler(bot))
