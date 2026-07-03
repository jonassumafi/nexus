import textwrap
from datetime import datetime

import discord
from discord import Embed, Color

from bot import TIMEZONE, UTC_TZ
from bot.utils.embeds import dos_style_embed_builder


def generate_crew_status_box(
    crew_status: list[tuple[str, str, bool, int]], width: int = 47
) -> str:
    box_lines = []

    # Top border and title
    box_lines.append("=" * (width - 2))
    box_lines.append(
        "|{:^{width}}|".format("[37mCREW ASSIGNMENT STATUS[0m", width=width - 2)
    )
    box_lines.append("=" * (width - 2))

    # Top empty padding
    box_lines.append("|{:^{width}}|".format("", width=width - 2))

    # Crew rows
    for emoji, role, is_filled, count in crew_status:
        label = f"{emoji} [36m{role.upper()}[0m"
        status = (
            f"{'🔴' if is_filled else '🟢'} {count} {'FILLED' if is_filled else 'SLOT'}"
        )
        dots = "." * (width - len(role) - len(status) - 11)
        box_lines.append(f"| {label}{dots} {status:<10} |")

    # Bottom empty padding
    box_lines.append("|{:^{width}}|".format("", width=width - 2))

    # Final border
    bottom_border = "=" * (width - 2)
    box_lines.append(bottom_border)

    return "\n".join(box_lines)


def generate_crew_box_with_count(
    crew_roles: list[tuple[str, str, int]], width: int = 47
) -> str:
    box_lines = []

    # Top border and title
    box_lines.append("=" * (width - 2))
    box_lines.append(
        "|{:^{width}}|".format("[37mCREW SLOT SETUP[0m", width=width - 2)
    )
    box_lines.append("=" * (width - 2))

    # Top padding line
    box_lines.append("|{:^{width}}|".format("", width=width - 2))

    for emoji, role, count in crew_roles:
        label = f"{emoji} [36m{role.upper()}[0m"
        count_str = f"{count}"
        dots = "." * (width - len(role) - len(count_str) - 11)
        box_lines.append(f"| {label}{dots} {count_str:<3} |")

    # Bottom padding
    box_lines.append("|{:^{width}}|".format("", width=width - 2))

    # Final border
    bottom_border = "=" * (width - 2)
    box_lines.append(bottom_border)

    return "\n".join(box_lines)


# def format_block(
#     fields: list[tuple[str, str]], align: int = 25, text_color: int = 33
# ) -> str:
#     lines = []
#     for label, value in fields:
#         padded_label = label.ljust(align)
#         lines.append(f">> [{text_color}m{padded_label}[0m{value}")
#     return "\n".join(lines)


def format_block(
    fields: list[tuple[str, str]],
    align: int = 20,
    text_color: int = 33,
    max_width: int = 50,
    is_space: bool = False,
) -> str:
    lines = []
    label_prefix_len = len(">> ") + align

    for label, value in fields:
        # Wrap before ANSI formatting
        wrapped_lines = textwrap.wrap(value, width=max_width - label_prefix_len)

        padded_label = label.ljust(align)
        ansi_label = f">> \x1b[{text_color}m{padded_label}\x1b[0m"

        if wrapped_lines:
            # First line includes the label
            lines.append(f"{ansi_label}{wrapped_lines[0]}")
            # Remaining lines align with value
            for line in wrapped_lines[1:]:
                lines.append(" " * label_prefix_len + line)
        else:
            lines.append(f"{ansi_label}")

        if is_space:
            lines.append("")

    return "\n".join(lines)


def create_box(title: str, width: int = 45) -> str:
    content_width = width - 2  # width minus borders
    wrapped_lines = textwrap.wrap(title, width=content_width)

    top_bottom_border = "=" * width
    lines = []

    for line in wrapped_lines:
        padding = content_width - len(line)
        left_padding = padding // 2
        right_padding = padding - left_padding
        colored_line = f"[37m{line}[0m"
        box_line = f"|{' ' * left_padding}{colored_line}{' ' * right_padding}|"
        lines.append(box_line)

    return f"\n{top_bottom_border}\n" + "\n".join(lines) + f"\n{top_bottom_border}\n\n"


def create_line(width: int = 49) -> str:
    return "\n\n" + "-" * width + "\n\n"


def missing_argument_error_text(command: str, argument: str) -> str:
    return (
        f"[TRANSMISSION INCOMING...] >> [31mERROR[0m\n"
        + create_box("COMMAND SYNTAX ERROR")
        + format_block(
            [
                ("[33mCOMMAND[0m:", f"/{command}"),
                ("[33mERROR[0m:", f"MISSING ARGUMENTS [34m[{argument.upper()}][0m"),
            ]
        )
        + create_line()
        + f"💡 Use [34m/{command} [{argument}[0m]\n"
    )


def database_error_message(command_name: str) -> str:
    return (
        f"[TRANSMISSION INCOMING...] >> [31mERROR[0m\n\n"
        + create_box("DATABASE ERROR")
        + format_block(
            [
                ("MODULE:", "MISSION ENGINE"),
                ("OPERATION:", f"/{command_name}"),
                ("STATUS:", "⛔ FAILED TO WRITE TO DATABASE"),
            ]
        )
        + create_line()
        + "💾 Database operation failed or same data already exists."
    )


def access_denied_text(user, action, required) -> str:
    return (
        f"[TRANSMISSION INCOMING...] >> [31mINSUFFICIENT PERMISSION LEVEL[0m\n"
        + create_box("SECURITY WARNING")
        + format_block(
            [
                ("USER:", f"@{user}"),
                ("ACTION:", f"/{action}"),
                ("REQUIRED:", required),
            ]
        )
        + create_line()
        + "🚫 You are not authorized to perform this command. Contact a command officer or use /log to contribute mission data."
    )


def access_level_text(user: str, role: str, access: str) -> str:
    return (
        f"[TRANSMISSION INCOMING...] >> [32mACCESS AUTHORIZED[0m\n"
        + create_box("MISSION CONTROL")
        + format_block(
            [
                ("AUTHORIZED BY:", f"@{user}"),
                ("ROLE PROMOTED:", role.upper()),
                ("ACCESS LEVEL:", access),
            ]
        )
        + create_line()
        + f"✅ Members with this role may now create, modify, and cancel operations.\n"
        + f"💡 Use [34m/revoke_rank[0m to remove access."
    )


def access_unauthorize_text(user: str, role: str, access: str) -> str:
    return (
        f"[TRANSMISSION INCOMING...] >> [31mACCESS UNAUTHORIZED[0m\n"
        + create_box("MISSION CONTROL")
        + format_block(
            [
                ("UNAUTHORIZED BY:", f"@{user}"),
                ("ROLE REVOKED:", role.upper()),
                ("ACCESS LEVEL", access),
            ]
        )
        + create_line()
        + f"❌ Members with this role can not create, modify, and cancel operations.\n"
        + f"💡 Use [34m/promote_rank[0m to remove access."
    )


def duplicate_role_message(role: str) -> str:
    return (
        f"[TRANSMISSION INCOMING...] >> [31mERROR[0m\n"
        + create_box("ACCESS DUPLICATION NOT ALLOWED")
        + format_block(
            [
                ("[33mROLE:[0m", role.upper()),
                ("[33mSTATUS:[0m", "ALREADY AUTHORIZED FOR MISSION CONTROL"),
            ]
        )
        + create_line()
        + f"📝 No action taken. This role already has full operational access.\n"
        + f"💡 Use /revoke_rank to remove it from the clearance list."
    )


def role_not_authorized(role: str) -> str:
    return (
        f"[TRANSMISSION INCOMING...] >> [31mNOT AUTHORIZED[0m\n"
        + create_box("HAS NO COMMAND ACCESS")
        + format_block(
            [("ROLE:", role.upper()), ("STATUS", "ROLE HAS NO COMMAND ACCESS")]
        )
        + create_line()
        + f"📝 No action taken.\n"
        + f"💡 Use [34m/promote_rank[0m to add it."
    )


def new_crew_role(user: str, role: str, emoji: str, action: str):
    return (
        f"[TRANSMISSION INCOMING...] >> [31m{action}[0m\n"
        + create_box("SHIP CREW DATABASE")
        + format_block(
            [
                ("ROLE ADDED BY:", user.upper()),
                ("NEW ROLE", role.upper()),
                ("EMOJI ASSIGNED", emoji),
            ]
        )
        + create_line()
        + f"✅ This role can now be assigned to ships during setup.\n"
        + f"💡 Use [34m/remove_crew_role `{role}`[0m to delete this role from the registry."
    )


def remove_crew_role(user: str, role: str, emoji: str):
    return (
        f"[TRANSMISSION INCOMING...] >> [31mCREW ROLE DELETED[0m\n"
        + create_box("SHIP CREW DATABASE")
        + format_block(
            [
                ("REMOVED BY:", user.upper()),
                ("ROLE REMOVED", role.upper()),
                ("EMOJI UNLINKED", emoji),
            ]
        )
        + create_line()
        + f"❌ This role is no longer available for mission crew assignments. Ships using {emoji} must be updated manually.\n"
        + f"💡 Use [34m/add_role `{role}` `{emoji}`[0m to restore it to the database."
    )


def crew_role_list(crew: list[tuple[str, str]]):
    return (
        f"[TRANSMISSION INCOMING...] >> [31mCREW ROLES DATABASE LISTED[0m\n"
        + create_box("REGISTERED CREW ROLES")
        + format_block(crew)
        + create_line()
        + f"✅ Use [34m/add_role `RoleName` :emoji:[0m to register a new crew type \n"
        + f"❌ Use [34m/remove_role `RoleName`[0m to delete an existing one "
    )


def general_transmission(
    transmission: str,
    box_text: str,
    fields: list[tuple[str, str]] = None,
    is_line: bool = True,
    footer: list[str] = None,
    is_space: bool = False,
):
    if footer is None:
        footer = []
    if fields is None:
        fields = []

    footer_section = ""
    if footer:
        footer_text = " \n".join(footer)
        if is_line:
            footer_section = create_line() + footer_text
        else:
            footer_section = footer_text

    return (
        f"[TRANSMISSION INCOMING...] >> [31m{transmission}[0m\n"
        + create_box(box_text)
        + format_block(fields, is_space=is_space)
        + footer_section
    )


def registership_response(
    transmission: str,
    fields: list[
        tuple[
            str,
            str,
        ]
    ],
    footer: list[str],
    box_text: str,
):
    footer_text = " \n".join(footer)
    return (
        f"[TRANSMISSION INCOMING...] >> [31m{transmission}[0m\n"
        + create_box(box_text)
        + format_block(fields)
        + create_line()
        + footer_text
    )


def get_discord_relative_timestamp(future_time_str: str) -> str:
    try:
        # Parse string and localize to Eastern Time
        naive_dt = datetime.strptime(future_time_str, "%Y-%m-%d %H:%M")
        eastern_dt = TIMEZONE.localize(naive_dt)

        # Convert to UTC
        utc_dt = eastern_dt.astimezone(UTC_TZ)

        # Get Unix timestamp
        unix_timestamp = int(utc_dt.timestamp())

        # Return Discord relative timestamp format
        return f"<t:{unix_timestamp}:R>"

    except ValueError:
        return "Invalid time format."


def _format_time_difference(future_time_str: str) -> str:
    try:
        # Parse the naive datetime string
        future_naive_datetime = datetime.strptime(future_time_str, "%Y-%m-%d %H:%M")
        # Localize it to Eastern US time
        future_eastern_datetime = TIMEZONE.localize(future_naive_datetime)

        # Get current time in Eastern US
        now_eastern = datetime.now(TIMEZONE)

        time_diff = future_eastern_datetime - now_eastern

        if time_diff.total_seconds() < 0:
            return "Mission time has passed."

        days = time_diff.days
        hours = time_diff.seconds // 3600
        minutes = (time_diff.seconds % 3600) // 60

        parts = []
        if days > 0:
            parts.append(f"{days} day{'s' if days != 1 else ''}")
        if hours > 0:
            parts.append(f"{hours} hour{'s' if hours != 1 else ''}")
        if minutes > 0:
            parts.append(f"{minutes} minute{'s' if minutes != 1 else ''}")

        if not parts:
            return "Less than a minute away."

        return ", ".join(parts) + " from now"

    except ValueError:
        return "Invalid time format."


def generate_mission_preview_text(
    mission_name: str,
    mission_type: str,
    mission_time: str,
    mission_state: str,
    primary_ship: dict,
    supporting_ships: list[dict],
    guild_config: dict,
    objectives: str,
    ship_prefix: str,
) -> str:
    output = "TRANSMISSION INCOMING...\n"
    output += "--------------------------------------------\n"
    output += format_block(
        [
            ("MISSION NAME:", mission_name.upper()),
            ("MISSION TYPE:", mission_type.upper()),
            ("MISSION TIME:", f"{mission_time}"),
            ("MISSION STATE:", f"{mission_state.upper()}"),
            ("OBJECTIVES:", objectives),
        ]
    )
    output += create_line(width=50)  # Adjusted width for better fit

    # Primary Ship Details
    output += f"[34mPRIMARY SHIP[0m: {ship_prefix.upper()} {primary_ship["ship_name"].upper() if primary_ship else "NOT FOUND"}\n"
    output += f"{primary_ship.get("description", "No description available.") if primary_ship else " "}\n"

    total_primary_slots = 0
    filled_primary_slots = 0
    if "crew_roles" in primary_ship and primary_ship["crew_roles"]:
        for role_name, role_data in primary_ship["crew_roles"].items():
            total_primary_slots += role_data.get("slots", 0)
            filled_primary_slots += len(role_data.get("filled", []))

    if total_primary_slots > 0:
        crew_fill_percentage = (filled_primary_slots / total_primary_slots) * 100

        if crew_fill_percentage < 50:
            circle_emoji = "🟢"
            color_code = 32
            status_text = "Available"
        elif crew_fill_percentage < 100:
            circle_emoji = "🟡"
            color_code = 33
            status_text = "Available"
        elif crew_fill_percentage == 100:
            circle_emoji = "🔴"
            color_code = 31
            status_text = "Filled"
        else:
            circle_emoji = "🔵"
            color_code = 34
            status_text = "Unknown"

        output += f"[ Crew Status:  {crew_fill_percentage:.0f}% {circle_emoji} [{color_code}m{status_text}[0m ]\n"
        if crew_fill_percentage == 100:
            output += f"  {primary_ship["ship_name"].upper()} is at full crew capacity. No additional reservations accepted.\n\n"
        else:
            output += "\n"

        for role_name, role_data in primary_ship["crew_roles"].items():
            slots = role_data.get("slots", 0)
            filled = len(role_data.get("filled", []))
            status = "Filled" if filled == slots else "Available"
            status_emoji = "🔴" if filled == slots else "🟢"
            emoji = ""
            if guild_config and "crew_roles" in guild_config:
                for crew_role_entry in guild_config["crew_roles"]:
                    if crew_role_entry["name"] == role_name:
                        emoji = crew_role_entry.get("emoji", "")
                        break
            output += f"{emoji} {role_name.ljust(10)} — {status_emoji}{status}\n"
    else:
        output += "  [ Crew Status:  No crew roles defined ]\n\n"

    # Supporting Ships Details
    for s_ship in supporting_ships:
        output += create_line(width=50)  # Adjusted width for better fit
        output += f"[35mSUPPORT SHIP[0m: {ship_prefix.upper()} {s_ship["ship_name"].upper()}\n"
        output += f"{s_ship.get("description", "No description available.")}\n"

        total_supporting_slots = 0
        filled_supporting_slots = 0
        if "crew_roles" in s_ship and s_ship["crew_roles"]:
            for role_name, role_data in s_ship["crew_roles"].items():
                total_supporting_slots += role_data.get("slots", 0)
                filled_supporting_slots += len(role_data.get("filled", []))

        if total_supporting_slots > 0:
            crew_fill_percentage = (
                filled_supporting_slots / total_supporting_slots
            ) * 100
            if crew_fill_percentage < 50:
                circle_emoji = "🟢"
                color_code = 32
                status_text = "Available"
            elif crew_fill_percentage < 100:
                circle_emoji = "🟡"
                color_code = 33
                status_text = "Available"
            elif crew_fill_percentage == 100:
                circle_emoji = "🔴"
                color_code = 31
                status_text = "Filled"
            else:
                circle_emoji = "🔵"
                color_code = 34
                status_text = "Unknown"

            output += f"[ Crew Status:  {crew_fill_percentage:.0f}% {circle_emoji} [{color_code}m{status_text}[0m ]\n"
            if crew_fill_percentage == 100:
                output += f"  {s_ship["ship_name"].upper()} is at full crew capacity. No additional reservations accepted.\n\n"
            else:
                output += "\n"

            for role_name, role_data in s_ship["crew_roles"].items():
                slots = role_data.get("slots", 0)
                filled = len(role_data.get("filled", []))
                status = "Filled" if filled == slots else "Available"
                status_emoji = "🔴" if filled == slots else "🟢"
                emoji = ""
                if guild_config and "crew_roles" in guild_config:
                    for crew_role_entry in guild_config["crew_roles"]:
                        if crew_role_entry["name"] == role_name:
                            emoji = crew_role_entry.get("emoji", "")
                            break
                output += f"{emoji} {role_name.ljust(10)} — {status_emoji}{status}\n"
        else:
            output += "  [ Crew Status:  No crew roles defined ]\n\n"

    output += create_line(width=50)  # Adjusted width for better fit
    return output


def get_filled_crew_lines(
    ship: dict, guild_config: dict, guild: discord.Guild
) -> list[str]:
    lines = []
    for role_name, role_data in ship["crew_roles"].items():
        filled_members = role_data.get("filled", [])
        if not filled_members:
            continue

        emoji = next(
            (
                r["emoji"]
                for r in guild_config["crew_roles"]
                if r["name"].lower() == role_name.lower()
            ),
            "•",
        )

        member_names = []
        for user_id in filled_members:
            member = guild.get_member(int(user_id))
            member_names.append(member.display_name if member else f"<@{user_id}>")

        lines.append(
            f"{emoji} {role_name:<8} \u001b[32m{', '.join(member_names)}\u001b[0m"
        )

    return lines


def calculate_fill_percentage(ship: dict) -> float:
    """Calculate crew fill percentage for a ship."""
    total_slots = sum(
        role_data.get("slots", 0) for role_data in ship["crew_roles"].values()
    )
    filled_slots = sum(
        len(role_data.get("filled", [])) for role_data in ship["crew_roles"].values()
    )
    return (filled_slots / total_slots) * 100 if total_slots > 0 else 0


def get_rp_points(total_percentage: float) -> int:
    """Return RP points based on mission-wide fill percentage."""
    if total_percentage >= 90:
        return 3
    elif total_percentage >= 75:
        return 2
    elif total_percentage >= 60:
        return 1
    else:
        return 0


async def build_mission_launch_embed(
    mission_doc, ships, guild: discord.Guild, guild_config, mission_status,
        total_mission_rp: int
):
    ship_prefix = guild_config["ship_prefix"]
    lines = []

    # === HEADER ===
    lines.append(create_box(f"MISSION LAUNCH: {mission_doc['name']}"))

    # === BASIC INFO ===
    lines.append(
        format_block(
            fields=[
                ("MISSION NAME", mission_doc["name"].upper()),
                ("MISSION TYPE", mission_doc["mission_type"].upper()),
                (
                    "CREATED BY",
                    guild.get_member(mission_doc["created_by"]).display_name.upper(),
                ),
                ("OBJECTIVE", mission_doc["objectives"]),
            ],
            max_width=45
        )
    )

    # --- Divider ---
    lines.append(create_line(width=45))

    # --- Assigned Ships Section ---
    lines.append("\u001b[36mAssigned Ships\u001b[0m")

    total_slots = 0
    total_filled = 0
    rp = 0

    for ship in ships:
        fill_percent = calculate_fill_percentage(ship)
        rp += get_rp_points(fill_percent)
        color_emoji = (
            "🟢" if fill_percent >= 70 else "🟡" if fill_percent >= 50 else "🔴"
        )
        lines.append(
            f"{ship_prefix} {ship['ship_name']} {color_emoji}  - {int(fill_percent)}% filled"
        )

        # Add to totals
        total_slots += sum(
            role_data.get("slots", 0) for role_data in ship["crew_roles"].values()
        )
        total_filled += sum(
            len(role_data.get("filled", []))
            for role_data in ship["crew_roles"].values()
        )

    # --- Calculate total mission RP points ---
    mission_fill_rate = (total_filled / total_slots) * 100 if total_slots > 0 else 0
    print(f"Mission Per {mission_fill_rate}")
    lines.append(f"\n\n\u001b[33mTotal Mission RP:\u001b[0m {total_mission_rp}")
    lines.append(f"\n\u001b[33mTotal Participating Crew:\u001b[0m {total_filled}")

    # --- Timer field ---
    end_time = datetime.now(TIMEZONE)
    unix_timestamp = int(end_time.timestamp())

    fields = [
        ("⏱ Mission Timer", f"<t:{unix_timestamp}:R>", True),
        ("MISSION STATUS", f"```yaml\n{mission_status.upper()}```", True),
    ]
    # === BUILD EMBED ===
    reason_block = "\n".join(lines)
    embed = dos_style_embed_builder(
        title=f"🚀 Mission {mission_doc['name']} is LIVE!",
        reason_block=reason_block,
        color=discord.Color.blue(),
        fields=fields,
        footer_text="Mission Control System",
        image="https://media.discordapp.net/attachments/1391768468814172182/1399550356589121536/mission_uplink_scroll_30s.gif?ex=68896857&is=688816d7&hm=21259f9e45dc1bd940a3821953b1d60607c8e6dd65adb989646de44d3156f0b2&=&width=1800&height=270",
    )
    return embed


async def build_mission_complete_embed(
    mission_doc, ships, guild: discord.Guild, guild_config, archive_mission, total_points: int
):
    ship_prefix = guild_config["ship_prefix"]

    # Calculate mission duration
    mission_duration = "00:00"
    if archive_mission.get("mission_start_time") and archive_mission.get("end_time"):
        start_time = archive_mission["mission_start_time"]
        end_time = archive_mission["end_time"]
        duration = end_time - start_time

        # Calculate duration components
        total_seconds = int(duration.total_seconds())
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60

        # Format as HH:MM
        mission_duration = f"{hours:02d}:{minutes:02d}"

    lines = [
        create_box(f"MISSION COMPLETED: {mission_doc['name']}"),
        format_block(
            fields=[
                ("MISSION NAME", mission_doc["name"].upper()),
                ("MISSION TYPE", mission_doc["mission_type"].upper()),
                (
                    "CREATED BY",
                    guild.get_member(mission_doc["created_by"]).display_name.upper(),
                ),
            ]
        ),
        create_line(width=45),
        "\u001b[36mASSIGNED SHIPS\u001b[0m",
    ]

    # --- Assigned Ships Section ---

    for ship in ships:
        lines.append(f"{ship_prefix} {ship['ship_name']}")

    lines.append("\n")
    lines.append(f"\u001b[36mMISSION DURATION\u001b[0m: {mission_duration}",)
    lines.append(f"\u001b[36mTOTAL POINTS\u001b[0m: {total_points}",)

    # === BUILD EMBED ===
    reason_block = "\n".join(lines)

    embed = dos_style_embed_builder(
        title=f"🚀 Mission {mission_doc['name']} is COMPLETED!",
        reason_block=reason_block,
        color=discord.Color.blue(),
        image= "https://media.discordapp.net/attachments/1391768468814172182/1403353482744041612/Mission_Complete_Animation.gif?ex=68973e47&is=6895ecc7&hm=2f2e2008b39f49230a768ac8c3747ce11ceac45304366da938fd03dca08fdd0f&="
    )
    embed.set_footer(text="Mission Control System")

    return embed


##NOt in use currently
async def build_mission_summary_embed(
    mission_doc, ships, guild: discord.Guild, guild_config
):
    ship_prefix = guild_config["ship_prefix"]
    lines = []

    # === HEADER ===
    lines.append(create_box(f"MISSION COMPLETED: {mission_doc['name']}"))

    # === BASIC INFO ===
    lines.append(
        format_block(
            fields=[
                ("MISSION NAME", mission_doc["name"].upper()),
                ("MISSION TYPE", mission_doc["mission_type"].upper()),
                ("STATUS", mission_doc.get("status", "COMPLETE").upper()),
                (
                    "CREATED BY",
                    guild.get_member(mission_doc["created_by"]).display_name.upper(),
                ),
                ("OBJECTIVE", mission_doc["objectives"]),
            ]
        )
    )

    # --- Assigned Ships Section ---
    lines.append("\u001b[36mAssigned Ships\u001b[0m")

    total_slots = 0
    total_filled = 0

    for ship in ships:
        fill_percent = calculate_fill_percentage(ship)
        color_emoji = (
            "🟢" if fill_percent >= 90 else "🟡" if fill_percent >= 60 else "🔴"
        )
        lines.append(
            f"{ship_prefix} {ship['ship_name']} {color_emoji}  - {int(fill_percent)}% filled"
        )

        # Add to totals
        total_slots += sum(
            len(r.get("filled", [])) + len(r.get("open", []))
            for r in ship["crew_roles"].values()
        )
        total_filled += sum(
            len(r.get("filled", [])) for r in ship["crew_roles"].values()
        )

    # --- Calculate total mission RP points ---
    mission_fill_rate = (total_filled / total_slots) * 100 if total_slots > 0 else 0
    rp_points = get_rp_points(mission_fill_rate)
    # lines.append(f"\n\u001b[33mTotal Mission RP Points: {rp_points}\u001b[0m")

    # --- Divider ---
    lines.append(create_line(width=45))

    # === PER SHIP CREW LIST ===
    for ship in ships:
        lines.append(f"\u001b[35m{ship_prefix} {ship['ship_name']}\u001b[0m")

        crew_lines = get_filled_crew_lines(ship, guild_config, guild)
        if crew_lines:
            lines.extend(crew_lines)
        else:
            lines.append("\u001b[31mNo available crew\u001b[0m")

        lines.append(create_line(width=45))

    # === BUILD EMBED ===
    reason_block = "\n".join(lines)
    embed = discord.Embed(
        title=f"✅ Mission {mission_doc['name']} - COMPLETED",
        description=f"```ansi\n{reason_block}\n```",
        color=discord.Color.green(),
    )

    # --- Mission Duration field ---
    mission_duration = "Unknown"
    if mission_doc.get("mission_start_time") and mission_doc.get("end_time"):
        start_time = mission_doc["mission_start_time"]
        end_time = mission_doc["end_time"]
        duration = end_time - start_time

        # Calculate duration components
        total_seconds = int(duration.total_seconds())
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        seconds = total_seconds % 60

        # Format duration string
        duration_parts = []
        if hours > 0:
            duration_parts.append(f"{hours}h")
        if minutes > 0:
            duration_parts.append(f"{minutes}m")
        if seconds > 0 or not duration_parts:  # Always show seconds if no other parts
            duration_parts.append(f"{seconds}s")

        mission_duration = " ".join(duration_parts)

    embed.add_field(name="⏱ Mission Duration", value=mission_duration, inline=False)

    embed.set_image(url="https://imgur.com/a/ApPVWkd#DCkvpvQ")
    embed.set_footer(text="Mission Control System")

    return embed


def build_post_mission_dm_embed(
    mission_name: str, mission_status: str, role: str
) -> Embed:
    fields = [
        ("MISSION NAME:", mission_name),
        ("MISSION STATUS:", f"✅ {mission_status.upper()}"),
        ("YOUR ROLE:", role.upper()),
        ("ACTION REQUIRED:", "SUBMIT LOG ENTRY"),
    ]

    mission_block = format_block(fields, align=20)
    divider = create_line()

    instructions = textwrap.dedent(
        """
        > You are required to file a post-mission log to receive reputation points (RP)
        > and contribute to organizational archives.

        > Use /log or click the button below to submit your entry.
    """
    ).strip()

    footer_note = "Solo missions with no registered crew do not earn RP."

    full_block = f"""TRANSMISSION INCOMING...{divider}{mission_block}{divider}{instructions}{divider}{footer_note}{divider}"""

    embed = dos_style_embed_builder(
        title=" ", reason_block=full_block, color=Color.dark_grey()
    )
    return embed


def build_mission_completed_embed(missions: list[dict]) -> discord.Embed:
    text = f"[TRANSMISSION INCOMING...] >> [31mCOMPLETED MISSION[0m\n" + create_box(
        "MISSION DATABASE"
    )
    for idx, mission in enumerate(missions, start=1):
        # Use display_number if available (for pagination), otherwise use idx
        mission_number = mission.get("display_number", idx)
        mission_text = f"""
    [33m>> {mission_number} {mission["title"]}[0m
        - Ships: {', '.join(mission["ships"])}
        - Logs: {mission["logs"]}
    """
        text += textwrap.dedent(mission_text)

        # Footer line
    text += """
<< Use ← → to change pages, or click 1️⃣-9️⃣ to view details >>
"""

    embed = dos_style_embed_builder(
        title="", reason_block=text, color=discord.Color.blue()
    )

    return embed
