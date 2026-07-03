import discord
from typing import Callable, Awaitable , List

class PopUp(discord.ui.Modal):
    def __ini__(
            self, 
            title: str, 
            items:List[discord.ui.TextInput], 
            on_submit_callback : Callable[[discord.Interaction], Awaitable[None]]
            ):
        super().__init__(timeout=None, title=title)
        self.on_submit_callback = on_submit_callback
        for item in items:
            self.add_item(item)

    async def on_submit(self, interaction: discord.Interaction):
        await self.on_submit_callback(interaction)

