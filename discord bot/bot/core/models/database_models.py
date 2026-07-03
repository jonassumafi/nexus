from datetime import datetime
from enum import Enum
from typing import Optional, Dict, List

from bson import ObjectId
from pydantic import BaseModel, Field, ConfigDict


class MissionState(Enum):
    WAITING = "WAITING FOR CREW"
    FINALIZED = "FINALIZED"
    INPROGRESS = "IN PROGRESS"
    LAUNCHED = "LAUNCHED"
    COMPLETE = "COMPLETE"
    ABORT = "ABORT"

class CrewRole(BaseModel):
    slots: int
    filled: List[str] = []

class Ships(BaseModel):
    id: str = Field(..., alias='_id')
    guild_id: int
    ship_name: str
    description: str
    owner_id: int
    type: str
    is_mission: bool
    crew_roles: Dict[str, CrewRole]
    missions_completed: int
    crew_fill_parcentage: int

class MissionCreate(BaseModel):
    """Model for creating a new mission (input validation)."""
    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        populate_by_name=True
    )
    
    name: str
    primary_ship: ObjectId
    supporting_ships: List[ObjectId] = []
    status: str  # Use string to match MissionState.value
    created_at: datetime
    mission_type: str
    created_by: int
    mission_time: datetime
    objectives: str
    guild_id: int
    queue_expires_at: Optional[datetime] = None
    thread_id: Optional[int] = None  # Creation thread ID
    thread_channel_id: Optional[int] = None  # Channel containing thread
    
    def to_mongo_dict(self) -> dict:
        """Convert to dict for MongoDB insertion."""
        return {
            "name": self.name,
            "primary_ship": self.primary_ship,
            "supporting_ships": self.supporting_ships,
            "status": self.status,
            "created_at": self.created_at,
            "mission_type": self.mission_type,
            "created_by": self.created_by,
            "mission_time": self.mission_time,
            "objectives": self.objectives,
            "guild_id": self.guild_id,
            "queue_expires_at": self.queue_expires_at,
            "thread_id": self.thread_id,
            "thread_channel_id": self.thread_channel_id,
        }


class Missions(BaseModel):
    """Model for reading missions from MongoDB."""
    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        populate_by_name=True
    )
    
    id: ObjectId = Field(..., alias='_id')
    name: str
    primary_ship: ObjectId
    supporting_ships: List[ObjectId] = []
    status: str  # MissionState.value string
    created_at: datetime
    mission_type: str
    created_by: int
    mission_time: datetime
    objectives: str
    guild_id: int
    finalized_channel_id: Optional[int] = None
    finalized_message_id: Optional[int] = None
    start_time: Optional[datetime] = None
    queue_expires_at: Optional[datetime] = None
    thread_id: Optional[int] = None
    thread_channel_id: Optional[int] = None
    
    @classmethod
    def from_mongo(cls, doc: dict) -> "Missions":
        """Create a Missions instance from a MongoDB document."""
        if doc is None:
            return None
        return cls(**doc)

class Players(BaseModel):
    id: int = Field(..., alias='_id')
    missions_completed: int
    biography: str
    citizen_name: str
    citizenship: str
    onboarding: bool
    place_of_birth: str

class RPSettings(BaseModel):
    id: str = Field(..., alias='_id')
    points: Dict[str, int]
    ship_fill_threshold: int
    updated_by: str
    updated_at: datetime
    reason: str

class RPLedger(BaseModel):
    model_config = ConfigDict(
        arbitrary_types_allowed=True,  # <-- important for ObjectId
        populate_by_name=True
    )
    mission_id: ObjectId
    event_code: str
    points: int
    guild_id: int
    applied_ts: datetime
    player_id: Optional[int] = None
    ship_id : Optional[ObjectId] = None
    meta: Optional[Dict[str, str]] = None

class ShipRPLedger(BaseModel):
    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        populate_by_name=True
    )
    ship_id: ObjectId
    mission_id: ObjectId
    guild_id: int
    role: str
    capacity_at_launch: int
    filled_at_launch: int
    fill_rate: int
    points_awarded: int
    awarded_ts: datetime
    threshold_snapshot: int

class Ranks(BaseModel):
    id: str = Field(..., alias='_id')
    name: str
    emoji: str
    min_rp: int

class MissionShips(BaseModel):
    id: str = Field(..., alias='_id')
    mission_id: str
    ship_id: str
    role: str
    capacity_at_launch: int
    filled_at_launch: int


# Ship Model Management
class ShipModelCreate(BaseModel):
    """Model for creating a new ship model (input validation)."""
    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        populate_by_name=True
    )
    
    category: str  # Manufacturer name (e.g., "Aegis Dynamics")
    model_name: str  # Ship model name (e.g., "Gladius")
    image_url: str  # Cloudinary URL
    created_by: int  # User ID who created this
    created_at: datetime
    
    def to_mongo_dict(self) -> dict:
        """Convert to dict for MongoDB insertion."""
        return self.model_dump()


class ShipModel(BaseModel):
    """Model for reading ship models from MongoDB."""
    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        populate_by_name=True
    )
    
    id: ObjectId = Field(..., alias='_id')
    category: str
    model_name: str
    image_url: str
    created_by: int
    created_at: datetime
    
    @classmethod
    def from_mongo(cls, doc: dict) -> "ShipModel":
        """Create a ShipModel instance from a MongoDB document."""
        if doc is None:
            return None
        return cls(**doc)