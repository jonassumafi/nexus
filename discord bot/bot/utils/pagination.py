import discord
from discord.ext import commands
from bot.utils.embeds import dos_style_embed_builder
from bot.core.response_messages import format_block, create_box, create_line, general_transmission


class ShipPaginator(discord.ui.View):
    def __init__(self, ships, ctx: commands.Context, ship_prefix):
        super().__init__(timeout=60)
        self.ctx = ctx
        self.prefix = ship_prefix

        # Group ships into pages with 5 per page
        self.ship_pages = [ships[i : i + 5] for i in range(0, len(ships), 5)]
        self.current_page = 0
        self.total_pages = len(self.ship_pages)
        self.message = None

        self.prev_button.disabled = True
        self.start_button.disabled = True
        if self.total_pages <= 1:
            self.next_button.disabled = True
            self.last_button.disabled = True

    def get_embed(self):
        ships_on_page = self.ship_pages[self.current_page]
        blocks = []

        # Title
        blocks.append(create_box("< HOPEWELL SHIP REGISTRY >", width=49))

        # Ship info blocks
        for ship in ships_on_page:
            owner = self.ctx.guild.get_member(ship["owner_id"])
            owner_name = f"{owner.display_name}" if owner else "Unknown"
            blocks.append(f"\033[32m► {self.prefix} {ship['ship_name']}\033[0m")
            fields = [
                ("Type:", ship["type"]),
                ("Description:", ship["description"]),
                ("Missions Completed:", str(ship.get("missions_completed", 0))),
                ("Registered By:", owner_name),
            ]
            blocks.append(format_block(fields, align=20, text_color=35))
            blocks.append("")  # space between ships

        # Footer instructions
        blocks.append(create_line(width=49))
        blocks.append("To register a new ship, use: \033[34m/registership\033[0m")
        blocks.append("To edit a ship, use: \033[34m/editship\033[0m")
        blocks.append("To add a ship to a mission, use: \033[34m/addship\033[0m")
        blocks.append(f"\n\033[90mPage {self.current_page + 1} of {self.total_pages}\033[0m")

        full_text = "\n".join(blocks)

        return dos_style_embed_builder(
            " ", reason_block=full_text, color=discord.Color.green()
        )

    @discord.ui.button(label="⏮️ Start", style=discord.ButtonStyle.blurple)
    async def start_button(
        self,
        interaction: discord.Interaction,
        button: discord.ui.Button,
    ):
        if self.current_page > 0:
            self.current_page = 0
            self.update_buttons()
            await interaction.response.edit_message(embed=self.get_embed(), view=self)

    @discord.ui.button(label="◀️ Prev", style=discord.ButtonStyle.gray)
    async def prev_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ):
        if self.current_page > 0:
            self.current_page -= 1
            self.update_buttons()
            await interaction.response.edit_message(embed=self.get_embed(), view=self)

    @discord.ui.button(label="▶️ Next", style=discord.ButtonStyle.gray)
    async def next_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ):
        if self.current_page < self.total_pages - 1:
            self.current_page += 1
            self.update_buttons()
            await interaction.response.edit_message(embed=self.get_embed(), view=self)

    @discord.ui.button(label="⏭️ End", style=discord.ButtonStyle.blurple)
    async def last_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ):
        if self.current_page < self.total_pages - 1:
            self.current_page = self.total_pages - 1
            self.update_buttons()
            await interaction.response.edit_message(embed=self.get_embed(), view=self)

    def update_buttons(self):
        self.start_button.disabled = self.current_page == 0
        self.prev_button.disabled = self.current_page == 0
        self.next_button.disabled = self.current_page == self.total_pages - 1
        self.last_button.disabled = self.current_page == self.total_pages - 1


class FleetEfficiencyPaginator(discord.ui.View):
    def __init__(self, data, ctx: commands.Context, ship_prefix):
        super().__init__(timeout=120)
        self.ctx = ctx
        self.prefix = ship_prefix
        self.data = sorted(data, key=lambda x: x.get('avg_fill_rate', 0), reverse=True)
        self.pages = [self.data[i:i + 5] for i in range(0, len(self.data), 5)]
        self.current_page = 0
        self.total_pages = len(self.pages)
        self.message = None

        self.prev_button.disabled = True
        self.start_button.disabled = True
        if self.total_pages <= 1:
            self.next_button.disabled = True
            self.last_button.disabled = True

    def _make_bar(self, pct: float) -> str:
        pct = max(0.0, min(100.0, float(pct)))
        filled = int(pct / 100.0 * 10) # 10 segments
        return "[" + ("#" * filled) + ("." * (10 - filled)) + "]"

    def get_embed(self):
        page_data = self.pages[self.current_page]
        lines = []

        header = "FLEET EFFICIENCY INDEX"
        lines.append("[TRANSMISSION INCOMING...] >> SHIP RP EFFICIENCY")
        lines.append(create_box(header, width=50))

        for i, ship_stats in enumerate(page_data, start=self.current_page * 5 + 1):
            ship_name = ship_stats.get('ship_name', 'Unknown Ship')
            efficiency = ship_stats.get('avg_fill_rate', 0)
            ship_rp = ship_stats.get('total_points', 0)
            missions = ship_stats.get('missions_completed', 0)

            bar = self._make_bar(efficiency)
            
            # Pad ship name for alignment
            padded_name = f"\u001b[36m{self.prefix} {ship_name}\u001b[0m".ljust(10, ' ')
            
            line = f"{i:03d}) ➤ {padded_name} {bar} {efficiency:.0f}% | \u001b[36mShip RP: {ship_rp}\u001b[0m | \u001b[33mMissions: {missions}\u001b[0m\n\n"
            lines.append(line)

        full_text = "\n".join(lines)
        embed = dos_style_embed_builder(
            "",
            reason_block=full_text,
            color=discord.Color.green()
        )
        return embed

    @discord.ui.button(label="⏮️ Start", style=discord.ButtonStyle.blurple)
    async def start_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        if self.current_page > 0:
            self.current_page = 0
            self.update_buttons()
            await interaction.response.edit_message(embed=self.get_embed(), view=self)

    @discord.ui.button(label="◀️ Prev", style=discord.ButtonStyle.gray)
    async def prev_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        if self.current_page > 0:
            self.current_page -= 1
            self.update_buttons()
            await interaction.response.edit_message(embed=self.get_embed(), view=self)

    @discord.ui.button(label="▶️ Next", style=discord.ButtonStyle.gray)
    async def next_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        if self.current_page < self.total_pages - 1:
            self.current_page += 1
            self.update_buttons()
            await interaction.response.edit_message(embed=self.get_embed(), view=self)

    @discord.ui.button(label="⏭️ End", style=discord.ButtonStyle.blurple)
    async def last_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        if self.current_page < self.total_pages - 1:
            self.current_page = self.total_pages - 1
            self.update_buttons()
            await interaction.response.edit_message(embed=self.get_embed(), view=self)

    def update_buttons(self):
        self.start_button.disabled = self.current_page == 0
        self.prev_button.disabled = self.current_page == 0
        self.next_button.disabled = self.current_page == self.total_pages - 1
        self.last_button.disabled = self.current_page == self.total_pages - 1