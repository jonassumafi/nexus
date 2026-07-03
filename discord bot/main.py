import discord
from bot import token
from bot.config import Bot
import asyncio
import logging


logging.basicConfig(
    level=logging.INFO,
    force='%(asctime)s %(levelname)s:%(name)s: %(message)s'
)

bot = Bot(command_prefix="m!", intent=discord.Intents.all(), help_command=None)


async def main():
    async with bot:
        await bot.start(token)


if __name__ == "__main__":
    asyncio.run(main())
    