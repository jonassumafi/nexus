from enum import Enum


class MissionState(Enum):
    WAITING = "WAITING FOR CREW"
    FINALIZED = "FINALIZED"
    INPROGRESS = "IN PROGRESS"
    LAUNCHED = "LAUNCHED"
    COMPLETE = "COMPLETE"
    ABORT = "ABORT"
