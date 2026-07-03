import asyncio
import logging
import re

import discord
from discord.ext import commands


async def ship_prefix(guild_config) -> str:
    prefix = guild_config.get("ship_prefix", "HCS")
    return prefix


def is_emoji(s: str, guild: discord.Guild = None) -> bool:
    if not s:
        return False  # Return False for empty input

    s = s.strip()

    # Check for custom Discord emoji format: <:name:id> or <a:name:id>
    if s.startswith('<') and s.endswith('>'):
        match = re.match(r'<a?:\w+:(\d+)>', s)
        if match:
            emoji_id = int(match.group(1))
            if guild and discord.utils.get(guild.emojis, id=emoji_id):
                return True
            return False  # ID format valid but emoji not found in this guild
        return False  # Doesn't match custom emoji format

    # Check for standard Unicode emojis
    emoji_pattern = re.compile(
        r"^(?:"
        "[\U0001F600-\U0001F64F"  # Emoticons
        "\U0001F300-\U0001F5FF"  # Miscellaneous Symbols and Pictographs
        "\U0001F680-\U0001F6FF"  # Transport & Map Symbols
        "\U0001F1E0-\U0001F1FF"  # Flags
        "\U00002600-\U000026FF"  # Miscellaneous Symbols
        "\U00002700-\U000027BF"  # Dingbats
        "\U0000FE00-\U0000FE0F"  # Variation Selectors
        "\U0001F900-\U0001F9FF"  # Supplemental Symbols and Pictographs
        "\U0001FA00-\U0001FA6F"  # Chess Symbols
        "\U0001F3FB-\U0001F3FF"  # Emoji Modifier Fitzpatrick
        "\u200D"  # Zero Width Joiner
        "\u00A9\u00AE"  # Copyright, Registered
        "])+?$"
    )
    return bool(emoji_pattern.fullmatch(s))


def dots_count(
        left_text: str,
        right_text: str,
        max_width: int = 50,
) -> int:
    counts = max(2, max_width - (len(left_text) + len(right_text)))
    return counts


def extract_flat_crew_list(ships: list[dict]) -> list[dict]:
    """Extract flat list of crew members (id + role + ship) from multiple ship docs."""
    crew_list = []
    for ship in ships:
        ship_name = ship.get("ship_name")
        crew_fill_parcentage = ship.get("crew_fill_parcentage")
        for role, data in (ship.get("crew_roles") or {}).items():
            for member_id in data.get("filled", []):
                crew_list.append({
                    "id": member_id,
                    "role": role,
                    "ship_name": ship_name,
                    "crew_fill_parcentage": crew_fill_parcentage
                })
    return crew_list


async def delayed_send_messages(channel: discord.TextChannel, messages: list[str], delay: int = 2):
    """
    Send messages sequentially with `delay` seconds between each.
    Runs as a background task; exceptions are caught and logged.
    """
    try:
        for msg in messages:
            try:
                await channel.send(msg)
            except Exception as e:
                logging.exception("Error sending delayed mission message: %s", e)
            # avoid sleeping after the last message
            if msg is not messages[-1]:
                await asyncio.sleep(delay)
    except Exception:
        logging.exception("Unexpected error in delayed messages task")



async def _resolve_handle(guild: discord.Guild, player_id, user_doc: dict):
    """
    Resolve the display handle for a player id with safe fallbacks.
    Returns a string.
    """
    # prefer DB user fields
    if user_doc:
        citizen_name = user_doc.get("citizen_name")
        username = user_doc.get("username")
        if citizen_name:
            return citizen_name
        if username:
            return username

    # try cached member
    try:
        member = guild.get_member(player_id)
    except Exception:
        member = None

    if member:
        # use display_name if available, else global_name, else name
        return getattr(member, "display_name", None) or getattr(member, "global_name", None) or getattr(member, "name", None) or str(player_id)

    # try fetching member (may fail if user left guild or bot lacks perms)
    try:
        fetched = await guild.fetch_member(player_id)
        return getattr(fetched, "display_name", None) or getattr(fetched, "global_name", None) or getattr(fetched, "name", None) or str(player_id)
    except Exception:
        # last resort: string id
        return str(player_id)



