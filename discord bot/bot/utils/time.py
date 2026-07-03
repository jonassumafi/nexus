from datetime import  datetime, timezone

from bot import TIMEZONE


def to_local(dt: datetime):
    if dt is None:
        return

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo= timezone.utc)

    return dt.astimezone(TIMEZONE)