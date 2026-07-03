import os

import pytz
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from openai import AsyncClient

load_dotenv()

token = os.getenv("DISCORD_BOT_TOKEN")
mongo_uri = os.getenv("MONGO_URI")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

mongo_client = AsyncIOMotorClient(mongo_uri)
TIMEZONE = pytz.timezone('America/New_York')
UTC_TZ = pytz.utc
openai_client = AsyncClient(api_key=OPENAI_API_KEY)

__all__ = [
    "token",
    "mongo_client",
    "TIMEZONE",
    "UTC_TZ",
    openai_client
]
