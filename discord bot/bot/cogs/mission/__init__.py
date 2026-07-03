from bot.cogs.mission.mission_commands import MissionCommands
from bot.cogs.mission.mission_view import MissionFinalizeView
from bot.core.constant import Db_Constant
from bot.core.mission_state import MissionState


async def setup(bot):
    await bot.add_cog(MissionCommands(bot=bot))

    # Persistence logic for MissionFinalizeView
    mission_collection = bot.db[Db_Constant.MISSION]
    guild_collection = bot.db[Db_Constant.GUILD_CONFIG_COLLECTION]
    ship_collection = bot.db[Db_Constant.SHIP]

    async for mission_doc in mission_collection.find(
            {"status": MissionState.FINALIZED.value}
    ):
        try:
            finalized_message_id = mission_doc.get("finalized_message_id")
            finalized_channel_id = mission_doc.get("finalized_channel_id")

            if finalized_message_id and finalized_channel_id:
                fleet_channel = bot.get_channel(finalized_channel_id)
                if not fleet_channel:
                    print(
                        f"Warning: Finalized mission channel {finalized_channel_id} not found for mission {mission_doc.get('name', 'Unknown')}."
                    )
                    continue

                message = await fleet_channel.fetch_message(finalized_message_id)
                if not message:
                    print(
                        f"Warning: Finalized mission message {finalized_message_id} not found in channel {finalized_channel_id} for mission {mission_doc.get('name', 'Unknown')}."
                    )
                    continue

                primary_ship_data = await ship_collection.find_one(
                    {"_id": mission_doc["primary_ship"]}
                )
                supporting_ships_data = []
                for ship_id in mission_doc["supporting_ships"]:
                    s_ship = await ship_collection.find_one({"_id": ship_id})
                    if s_ship:
                        supporting_ships_data.append(s_ship)

                crew_roles_data = await guild_collection.find_one(
                    {"guild_id": message.guild.id}
                )
                ship_prefix = crew_roles_data.get("ship_prefix", "")

                persistent_view = MissionFinalizeView(
                    bot=bot,
                    mission_data=mission_doc,
                    primary_ship_data=primary_ship_data,
                    supporting_ships_data=supporting_ships_data,
                    crew_roles_data=crew_roles_data,
                    ship_prefix=ship_prefix,
                )
                persistent_view.set_message(message)
                bot.add_view(persistent_view)
                print(f"Re-attached persistent view for mission: {mission_doc['name']}")

        except Exception as e:
            print(
                f"Error re-attaching persistent view for mission {mission_doc.get('name', 'Unknown')}: {e}"
            )