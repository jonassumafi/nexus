import asyncio
from datetime import datetime

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient
from motor.motor_asyncio import AsyncIOMotorCollection
import pymongo
import os
from dotenv import load_dotenv

from bot import TIMEZONE
from bot.core.constant import Db_Constant
from bot.core.models.database_models import RPLedger

load_dotenv()

# Mission types to insert
mission_types_data = [
    {"name": "Combat", "description": "Engage hostile forces (PvE or PvP)", "emoji": "⚔️"},
    {"name": "Cargo", "description": "Transport goods between locations", "emoji": "📦"},
    {"name": "Salvage", "description": "Recover materials from wrecks or derelicts", "emoji": "♻️"},
    {"name": "Exploration", "description": "Discover locations, anomalies, or jump points", "emoji": "🔭"},
    {"name": "Mining", "description": "Extract ores and minerals", "emoji": "⛏️"},
    {"name": "Recon", "description": "Scout and gather intel without direct engagement", "emoji": "📡"},
    {"name": "Escort", "description": "Defend a person, ship, or convoy", "emoji": "🛡️"},
    {"name": "Rescue", "description": "Recover stranded players or crew under duress", "emoji": "🆘"},
    {"name": "Science", "description": "Perform scanning, testing, or research operations", "emoji": "🔬"},
    {"name": "Leisure", "description": "Non-combat missions focused on RP, sightseeing, racing, or social events", "emoji": "🏖️"},
    {"name": "Miscellaneous", "description": "Other — doesn’t fit defined types", "emoji": "❓"},
]


ship_types_data = [
    {"name": "Starter", "description": "Entry-level ships for solo players with minimal capacity and basic systems.", "emoji": "🧭"},
    {"name": "Snub", "description": "Tiny, single-seat auxiliary craft launched from larger vessels. No bed or quantum drive.", "emoji": "🛰️"},
    {"name": "Light Fighter", "description": "Highly agile, lightly armored ships for fast dogfighting.", "emoji": "✈️"},
    {"name": "Medium Fighter", "description": "Balanced fighters offering versatility in armor, speed, and weapons.", "emoji": "⚔️"},
    {"name": "Heavy Fighter", "description": "Durable, heavily armed ships built for direct combat endurance.", "emoji": "🛡️"},
    {"name": "Bomber", "description": "Ships equipped with large torpedoes or missiles for strategic strikes.", "emoji": "💥"},
    {"name": "Cargo", "description": "Freighters focused on carrying cargo with ramps and cargo grids.", "emoji": "📦"},
    {"name": "Exploration", "description": "Long-range ships with scanners, mapping tools, and living quarters.", "emoji": "🌌"},
    {"name": "Medical", "description": "Equipped with medbeds for healing, respawning, and triage.", "emoji": "🩺"},
    {"name": "Refuel", "description": "Ships with external tanks and equipment to refuel others mid-mission.", "emoji": "⛽"},
    {"name": "Repair", "description": "Ships for in-field repair of hulls and systems.", "emoji": "🔧"},
    {"name": "Recon", "description": "Small stealth or data-running ships with advanced scanning tech.", "emoji": "👁️"},
    {"name": "Luxury", "description": "High-end ships with refined interiors and amenities for VIP travel.", "emoji": "💎"},
    {"name": "Touring", "description": "Leisure-focused ships for sightseeing and personal travel.", "emoji": "🧳"},
    {"name": "Escort", "description": "Tactical or multi-crew ships designed to protect other vessels.", "emoji": "👣"},
    {"name": "Gunship", "description": "Turret-laden ships focused on heavy fire support.", "emoji": "🛸"},
    {"name": "Corvette", "description": "Small capital-class warships with multi-crew and torpedo capacity.", "emoji": "🛳️"},
    {"name": "Frigate", "description": "Mid-tier capital ships with independent offensive capability.", "emoji": "⚓"},
    {"name": "Capital", "description": "Massive command-class ships with full crew, decks, and leadership roles.", "emoji": "🪐"},
]


RP_RANKS = [
    {
        "min_rp": 0,
        "max_rp": 49,
        "title": "Drifter",
        "emoji": "🕶️",
        "unlocks": []
    },
    {
        "min_rp": 50,
        "max_rp": 149,
        "title": "Signal-Seeker",
        "emoji": "📡",
        "unlocks": []
    },
    {
        "min_rp": 150,
        "max_rp": 249,
        "title": "Initiate",
        "emoji": "🧬",
        "unlocks": []
    },
    {
        "min_rp": 250,
        "max_rp": 349,
        "title": "Surveyor",
        "emoji": "🧭",
        "unlocks": ["💰 1M aUEC bonus"]
    },
    {
        "min_rp": 350,
        "max_rp": 449,
        "title": "Pathbreaker",
        "emoji": "🛠️",
        "unlocks": ["🔓 Append ships to missions (via /append, must be ship owner)"]
    },
    {
        "min_rp": 450,
        "max_rp": 599,
        "title": "Flight Officer",
        "emoji": "🔫",
        "unlocks": ["🔓 FREE Gemini Canuto sniper rifle ($5 value)"]
    },
    {
        "min_rp": 600,
        "max_rp": 749,
        "title": "Senior Flight Officer",
        "emoji": "🦺",
        "unlocks": ["🔓 FREE White Canuto armor set ($12 value)"]
    },
    {
        "min_rp": 750,
        "max_rp": 899,
        "title": "Continuum Navigator",
        "emoji": "🧭",
        "unlocks": []
    },
    {
        "min_rp": 900,
        "max_rp": 1099,
        "title": "Detachment Marshal",
        "emoji": "📋",
        "unlocks": ["🔓 Create & launch missions"]
    },
    {
        "min_rp": 1100,
        "max_rp": 1299,
        "title": "Stellar Cartographer",
        "emoji": "🌌",
        "unlocks": []
    },
    {
        "min_rp": 1300,
        "max_rp": 1499,
        "title": "Signal Warden",
        "emoji": "🛰️",
        "unlocks": []
    },
    {
        "min_rp": 1500,
        "max_rp": 1799,
        "title": "Prime of Three Vessels",
        "emoji": "⚓",
        "unlocks": ["🔓 Register third ship"]
    },
    {
        "min_rp": 1800,
        "max_rp": 2099,
        "title": "Vaultkeeper",
        "emoji": "🗝️",
        "unlocks": []
    },
    {
        "min_rp": 2100,
        "max_rp": 2399,
        "title": "Echo Sentinel",
        "emoji": "🪞",
        "unlocks": []
    },
    {
        "min_rp": 2400,
        "max_rp": 2699,
        "title": "Hopewell Steward",
        "emoji": "🕊️",
        "unlocks": ["🎁 FREE game starter package for a friend"]
    },
    {
        "min_rp": 2700,
        "max_rp": 2999,
        "title": "Fleet Harmonist",
        "emoji": "🎼",
        "unlocks": []
    },
    {
        "min_rp": 3000,
        "max_rp": 3399,
        "title": "Deepvoid Tactician",
        "emoji": "🧠",
        "unlocks": []
    },
    {
        "min_rp": 3400,
        "max_rp": 3799,
        "title": "Wayfarer Ascendant",
        "emoji": "🪐",
        "unlocks": []
    },
    {
        "min_rp": 3800,
        "max_rp": 4299,
        "title": "Continuum Paragon",
        "emoji": "🛸",
        "unlocks": []
    },
    {
        "min_rp": 4300,
        "max_rp": None,  # No upper limit
        "title": "Mythwright",
        "emoji": "🧿",
        "unlocks": []
    },
]


MONGO_URI = os.getenv("MONGO_URI")


async def add_log_mission_rp():
    try:
        guild_id = int(318778151712849922)
    except ValueError:
        print("Invalid Guild ID. Please enter a numeric ID.")
        return

    client =  None
    try:
        client = AsyncIOMotorClient(MONGO_URI)
        db = client[Db_Constant.DB_NAME]
        logs_collection:AsyncIOMotorCollection = db[Db_Constant.LOG_COLLECTION]
        rp_ledger_collection:AsyncIOMotorCollection = db[Db_Constant.RP_LEDGER]

        logs_doc = await logs_collection.find({}).to_list(length=None)

        for docs in logs_doc:
            if docs.get("user_id") and docs.get("mission_id"):
                user_id = docs.get("user_id")
                mission_id = docs.get("mission_id")
                insert_rp = await rp_ledger_collection.insert_one(
                    RPLedger(
                        player_id=user_id,
                        mission_id=mission_id,
                        event_code="AFTERMATH_LOG",
                        points=3,
                        guild_id=guild_id,
                        applied_ts=datetime.now(tz=TIMEZONE)
                    ).model_dump(mode="python")
                )
                is_inserted = insert_rp.inserted_id is not None

                if is_inserted:
                    print(f"Logs Rp Added for {user_id} for {mission_id} mission id")


    except Exception as e:
        print(f"An unexpected error occurred: {e}")
    finally:
        if client:
            client.close()
            print("MongoDB connection closed.")





def insert_mission_types():
    # mongo_uri = input("Enter your MongoDB Connection URI (e.g., mongodb://localhost:27017/): ")
    # guild_id_str = input("Enter the Discord Guild ID for which to add these mission types: ")

    try:
        guild_id = int(318778151712849922)
    except ValueError:
        print("Invalid Guild ID. Please enter a numeric ID.")
        return

    client = None
    try:
        client = pymongo.MongoClient(MONGO_URI)
        db = client["MissionControl"] # Specify the database name
        guild_collection = db["ServerConfig"] # Specify the collection name

        print(f"Connecting to MongoDB and inserting mission types for Guild ID: {guild_id}...")

        for mt in RP_RANKS:
            result = guild_collection.update_one(
                {"guild_id": guild_id},
                {"$push": {"rp_details": mt}},
                upsert=True
            )
            if result.upserted_id:
                print(f"  - Inserted new guild config document and added mission type: {mt['title']}")
            elif result.modified_count > 0:
                print(f"  - Added mission type: {mt['title']}")
            else:
                print(f"  - Mission type {mt['title']} might already exist or no change was made.")

        print("All specified mission types have been processed.")

    except pymongo.errors.ConnectionFailure as e:
        print(f"Could not connect to MongoDB: {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
    finally:
        if client:
            client.close()
            print("MongoDB connection closed.")

if __name__ == "__main__":
    asyncio.run(add_log_mission_rp())
