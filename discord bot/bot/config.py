import discord
from discord.ext import commands
from bot import mongo_client
from bot.core.constant import Db_Constant
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from motor.motor_asyncio import AsyncIOMotorCollection, AsyncIOMotorDatabase
from bot.utils.views import OnBoardingView, onboarding_screen

extensions = [
    "bot.cogs.ship",
    "bot.cogs.server_commands",
    "bot.cogs.mission",
    "bot.cogs.error_handler",
    "bot.cogs.owner_commands",
    "bot.cogs.rp_handler",
    "bot.cogs.profile",
]


class Bot(commands.Bot):
    def __init__(self, command_prefix: str, intent: discord.Intents, **kwargs):
        super().__init__(command_prefix=command_prefix, intents=intent, **kwargs)
        self.mongo_client = mongo_client
        self.db: AsyncIOMotorDatabase = self.mongo_client[Db_Constant.DB_NAME_TEST]
        self.user_collection: AsyncIOMotorCollection = self.db.user
        self.guild_collection: AsyncIOMotorCollection = self.db.ServerConfig
        self.scheduler = AsyncIOScheduler()

        self.check(self.onboarding_check)

    async def onboarding_check(self, ctx: commands.Context):
        """✅ Global check that rus before every command"""

        if ctx.author.bot:
            return True

        user_data = await self.user_collection.find_one({"_id": ctx.author.id})

        if not user_data or not user_data.get("onboarding", False):
            view = OnBoardingView(
                user_id=ctx.author.id, user_collection=self.user_collection, bot=self
            )
            embed = onboarding_screen(index=0, user_data=view.user_data)
            await ctx.send(embed=embed, view=view, ephemeral=True)
            return False
        return True

    async def on_ready(self):

        for extension in extensions:
            try:
                await self.load_extension(extension)
                # print(f"{extension} Loaded ")
            except Exception as e:
                print(f"Error loading extension : {e}")

        synced = await self.tree.sync()
        print(f"Synced {len(synced)} commands.")

        print(f"Bot is ready")
        self.scheduler.start()
