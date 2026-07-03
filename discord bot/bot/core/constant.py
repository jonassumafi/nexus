class _DbConstant:
    DB_NAME = "MissionControl"
    DB_NAME_TEST = "MissionControlTest"

    # Collection
    GUILD_CONFIG_COLLECTION = "ServerConfig"
    MISSION = "missions"
    SHIP = "ships"
    USER = "user"
    MISSION_ARCHIVE = "mission_archive"
    LOG_COLLECTION = "mission_logs"
    RP_SETTING_COLLECTION = "rp_collection"
    RP_LEDGER = "rp_ledger"
    SHIP_RP_LEDGER = "ship_rp_ledger"
    SHIP_MODEL = "ship_models"


Db_Constant = _DbConstant()


class _Roles:
    OWNER = 227210513556176896


Role = _Roles()

VALID_POINT_KEYS = {
        "MISSION_LAUNCHED",
        "AFTERMATH_LOG",
        "SHIP_FILL_BONUS",
    }
