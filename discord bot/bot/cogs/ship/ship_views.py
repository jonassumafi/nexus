import asyncio
import os
import shutil

import aiohttp
import discord
from bson import ObjectId

from bot.cogs.ship.ship_modals import ShipTypeModal
from bot.cogs.ship.ship_model_image import (
    ship_model_public_id,
    upload_ship_model_image,
    delete_ship_model_resource
)
from bot.core.constant import Db_Constant
from bot.utils.views import SlotSetupModal


class EditShipTypeView(discord.ui.View):
    def __init__(self, bot, ship_types):
        super().__init__()
        self.bot = bot
        self.ship_types = ship_types
        self.add_item(self.ShipTypeSelect(self.bot, self.ship_types))

    class ShipTypeSelect(discord.ui.Select):
        def __init__(self, bot, ship_types):
            self.bot = bot
            options = []
            for st in ship_types:
                desc = st.get("description", "")
                if len(desc) > 100:
                    desc = desc[:97] + "..."
                options.append(
                    discord.SelectOption(
                        label=st["name"],
                        description=desc,
                        emoji=st.get("emoji") or None,
                    )
                )
            super().__init__(
                placeholder="Select a ship type to edit...",
                min_values=1,
                max_values=1,
                options=options,
            )

        async def callback(self, interaction: discord.Interaction):
            selected_ship_type_name = self.values[0]
            selected_ship_type = next(
                (
                    st
                    for st in self.view.ship_types
                    if st["name"] == selected_ship_type_name
                ),
                None,
            )

            if selected_ship_type:
                modal = ShipTypeModal(
                    self.bot,
                    interaction.guild.id,
                    mode="edit",
                    ship_type=selected_ship_type,
                )
                await interaction.response.send_modal(modal)
            else:
                await interaction.response.send_message(
                    "Could not find the selected ship type.", ephemeral=True
                )


class DeleteShipTypeView(discord.ui.View):
    def __init__(self, bot, ship_types):
        super().__init__()
        self.bot = bot
        self.ship_types = ship_types
        self.add_item(self.ShipTypeSelect(self.bot, self.ship_types))

    class ShipTypeSelect(discord.ui.Select):
        def __init__(self, bot, ship_types):
            self.bot = bot
            options = [
                discord.SelectOption(
                    label=st["name"],
                    description=(st.get("description", "")[:98]),
                    emoji=st.get("emoji") or None,
                )
                for st in ship_types
            ]
            super().__init__(
                placeholder="Select a ship type to delete...",
                min_values=1,
                max_values=1,
                options=options,
            )

        async def callback(self, interaction: discord.Interaction):
            selected_ship_type_name = self.values[0]
            self.view.clear_items()
            self.view.add_item(
                self.view.ConfirmDeleteButton(self.bot, selected_ship_type_name)
            )
            self.view.add_item(self.view.CancelDeleteButton())
            await interaction.response.edit_message(
                content=f"Are you sure you want to delete the ship type **{selected_ship_type_name}**?",
                view=self.view,
            )

    class ConfirmDeleteButton(discord.ui.Button):
        def __init__(self, bot, ship_type_name):
            super().__init__(label="Confirm", style=discord.ButtonStyle.danger)
            self.bot = bot
            self.ship_type_name = ship_type_name

        async def callback(self, interaction: discord.Interaction):
            guild_id = interaction.guild.id
            guild_collection = self.bot.db[Db_Constant.GUILD_CONFIG_COLLECTION]
            guild_config = await guild_collection.find_one({"guild_id": guild_id})

            if not guild_config or "ship_types" not in guild_config:
                await interaction.response.edit_message(
                    content="No ship types are configured to delete.", view=None
                )
                return

            initial_count = len(guild_config["ship_types"])
            updated_ship_types = [
                st
                for st in guild_config["ship_types"]
                if st["name"].lower() != self.ship_type_name.lower()
            ]

            if len(updated_ship_types) == initial_count:
                await interaction.response.edit_message(
                    content=f"Ship type '{self.ship_type_name}' not found.", view=None
                )
                return

            await guild_collection.update_one(
                {"guild_id": guild_id}, {"$set": {"ship_types": updated_ship_types}}
            )
            await interaction.response.edit_message(
                content=f"Ship type '{self.ship_type_name}' deleted successfully!",
                view=None,
            )

    class CancelDeleteButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="Cancel", style=discord.ButtonStyle.secondary)

        async def callback(self, interaction: discord.Interaction):
            await interaction.response.edit_message(
                content="Deletion cancelled.", view=None
            )


class ShipTypeSelect(discord.ui.Select):
    def __init__(self, ship_types: list):
        options = []
        if ship_types:
            for ship_type in ship_types:
                options.append(
                    discord.SelectOption(
                        label=ship_type["name"],
                        description=(ship_type.get("description", "")[:98]),
                        emoji=ship_type.get("emoji", None),
                    )
                )
        else:
            options.append(
                discord.SelectOption(
                    label="No Ship Types Configured",
                    description="Please configure ship types in the guild settings.",
                    emoji="⚠️",
                    default=True,
                )
            )
            self.disabled = True

        super().__init__(placeholder="Select Ship Type", options=options, row=0)
        self.selected_type = None

    async def callback(self, interaction: discord.Interaction):
        if self.disabled:
            await interaction.response.send_message(
                "No ship types are configured for this guild.", ephemeral=True
            )
            return
        self.selected_type = self.values[0]
        await interaction.response.defer()


class ShipTypeSelectView(discord.ui.View):
    def __init__(
        self,
        author: discord.User,
        ship_types: list,
        ship_name: str,
        ship_description: str,
    ):
        super().__init__(timeout=300.0)
        self.author = author
        self.ship_types = ship_types
        self.ship_name = ship_name
        self.ship_description = ship_description
        self.selected_ship_type = None
        self.interaction_complete = asyncio.Future()

        self.ship_type_select = ShipTypeSelect(self.ship_types)
        self.add_item(self.ship_type_select)
        self.add_item(self.ConfirmButton())
        self.add_item(self.CancelButton())

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.author.id:
            await interaction.response.send_message(
                "You are not authorized to use this.", ephemeral=True
            )
            return False
        return True

    async def on_timeout(self):
        self.interaction_complete.set_result(None)
        self.stop()

    class ConfirmButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="Confirm", style=discord.ButtonStyle.success, row=1)

        async def callback(self, interaction: discord.Interaction):
            view = self.view
            if view.ship_type_select.selected_type:
                view.selected_ship_type = view.ship_type_select.selected_type
                view.interaction_complete.set_result(view.selected_ship_type)
                await interaction.response.defer()
                view.stop()
            else:
                await interaction.response.send_message(
                    "Please select a ship type.", ephemeral=True
                )

    class CancelButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="Cancel", style=discord.ButtonStyle.danger, row=1)

        async def callback(self, interaction: discord.Interaction):
            view = self.view
            view.interaction_complete.set_result(None)
            await interaction.response.defer()
            view.stop()


class InteractiveRoleSetupView(discord.ui.View):
    def __init__(self, author: discord.User, roles: list, existing_slots: dict = None):
        super().__init__(timeout=600.0)
        self.author = author
        self.roles = roles
        self.slots = {}
        self.interaction_complete = asyncio.Future()

        for role in roles:
            name = role["name"]
            self.slots[name] = existing_slots.get(name, 0) if existing_slots else 0

        # Dynamically create a button for each role
        for role in self.roles:
            self.add_item(RoleButton(role))

        # Add the Done button
        self.add_item(self.DoneButton())

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.author.id:
            await interaction.response.send_message(
                "You are not authorized to use this.", ephemeral=True
            )
            return False
        return True

    async def on_timeout(self):
        self.interaction_complete.set_result(None)  # Signal timeout
        self.stop()

    async def update_embed(self, interaction: discord.Interaction):
        # This method is a placeholder and is meant to be overridden
        # by the command using this view, as the embed structure is specific
        # to the command.
        await interaction.response.defer()

    # --- The Done Button ---
    class DoneButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="Done", style=discord.ButtonStyle.success, row=4)

        async def callback(self, interaction: discord.Interaction):
            view = self.view
            view.interaction_complete.set_result(view.slots)
            await interaction.response.defer()
            view.stop()


# --- The Button that triggers the Modal ---
class RoleButton(discord.ui.Button):
    def __init__(self, role: dict):
        super().__init__(
            label=role["name"], emoji=role["emoji"], style=discord.ButtonStyle.secondary
        )
        self.role = role

    async def callback(self, interaction: discord.Interaction):
        # self.view is automatically provided by discord.py
        modal = SlotSetupModal(role_name=self.role["name"], parent_view=self.view)
        await interaction.response.send_modal(modal)


# Ship Model Categories (Star Citizen Manufacturers)
SHIP_MANUFACTURERS = [
    "Aegis Dynamics",
    "Anvil Aerospace",
    "Aopoa",
    "ARGO Astronautics",
    "Banu",
    "Crusader Industries",
    "Drake Interplanetary",
    "Esperia",
    "Gatac Manufacture",
    "Kruger Intergalactic",
    "MISC",
    "Origin Jumpworks",
    "RSI (Roberts Space Industries)"
]


class ShipCategorySelectView(discord.ui.View):
    """View for selecting a ship manufacturer category."""
    
    def __init__(self, author: discord.User, timeout: float = 300.0):
        super().__init__(timeout=timeout)
        self.author = author
        self.selected_category = None
        self.interaction_complete = asyncio.Future()
        
        # Add the select menu
        self.add_item(self.CategorySelect())
        self.add_item(self.ConfirmButton())
        self.add_item(self.CancelButton())
    
    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.author.id:
            await interaction.response.send_message(
                "You are not authorized to use this.", ephemeral=True
            )
            return False
        return True
    
    async def on_timeout(self):
        self.interaction_complete.set_result(None)
        self.stop()
    
    class CategorySelect(discord.ui.Select):
        def __init__(self):
            options = [
                discord.SelectOption(label=cat, value=cat)
                for cat in SHIP_MANUFACTURERS
            ]
            super().__init__(
                placeholder="Select a manufacturer...",
                min_values=1,
                max_values=1,
                options=options,
                row=0
            )
            self._selected = None
        
        async def callback(self, interaction: discord.Interaction):
            self._selected = self.values[0]
            await interaction.response.defer()
    
    class ConfirmButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="Confirm", style=discord.ButtonStyle.success, row=1)
        
        async def callback(self, interaction: discord.Interaction):
            view = self.view
            # Find the select menu
            for item in view.children:
                if isinstance(item, ShipCategorySelectView.CategorySelect):
                    if item._selected:
                        view.selected_category = item._selected
                        view.interaction_complete.set_result(item._selected)
                        await interaction.response.defer()
                        view.stop()
                        return
            await interaction.response.send_message(
                "Please select a category first.", ephemeral=True
            )
    
    class CancelButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="Cancel", style=discord.ButtonStyle.danger, row=1)
        
        async def callback(self, interaction: discord.Interaction):
            view = self.view
            view.interaction_complete.set_result(None)
            await interaction.response.defer()
            view.stop()


# ==================== SHIP MODEL LIST/DETAILS VIEWS ====================

class ShipModelListView(discord.ui.View):
    """Paginated list view for ship models with category filter."""
    
    def __init__(self, bot, author: discord.User, models: list, total_count: int, 
                 page: int = 1, per_page: int = 10, category_filter: str = "All"):
        super().__init__(timeout=300.0)
        self.bot = bot
        self.author = author
        self.models = models
        self.total_count = total_count
        self.page = page
        self.per_page = per_page
        self.category_filter = category_filter
        self.total_pages = max(1, (total_count + per_page - 1) // per_page)
        self.selected_model = None
        
        self._setup_items()
    
    def _setup_items(self):
        self.clear_items()
        
        # Row 0: Category filter
        category_options = [discord.SelectOption(label="All Categories", value="All", default=(self.category_filter == "All"))]
        for cat in SHIP_MANUFACTURERS:
            category_options.append(discord.SelectOption(
                label=cat, 
                value=cat,
                default=(self.category_filter == cat)
            ))
        
        category_select = discord.ui.Select(
            placeholder="Filter by manufacturer...",
            options=category_options,
            row=0,
            custom_id="category_filter"
        )
        category_select.callback = self._on_category_change
        self.add_item(category_select)
        
        # Row 1: Model select (if models exist)
        if self.models:
            model_options = []
            for model in self.models[:25]:  # Discord limit is 25 options
                label = f"{model['model_name']}"
                desc = f"{model['category']}"[:100]
                model_options.append(discord.SelectOption(
                    label=label,
                    value=str(model['_id']),
                    description=desc
                ))
            
            model_select = discord.ui.Select(
                placeholder="Select a model to view details...",
                options=model_options,
                row=1,
                custom_id="model_select"
            )
            model_select.callback = self._on_model_select
            self.add_item(model_select)
        
        # Row 2: Pagination buttons
        prev_btn = discord.ui.Button(label="⬅️ Prev", style=discord.ButtonStyle.secondary, row=2, disabled=(self.page <= 1))
        prev_btn.callback = self._on_prev
        self.add_item(prev_btn)
        
        page_indicator = discord.ui.Button(label=f"Page {self.page}/{self.total_pages}", style=discord.ButtonStyle.secondary, row=2, disabled=True)
        self.add_item(page_indicator)
        
        next_btn = discord.ui.Button(label="➡️ Next", style=discord.ButtonStyle.secondary, row=2, disabled=(self.page >= self.total_pages))
        next_btn.callback = self._on_next
        self.add_item(next_btn)
    
    async def _on_category_change(self, interaction: discord.Interaction):
        select = interaction.data.get("values", [])[0] if interaction.data.get("values") else "All"
        self.category_filter = select
        self.page = 1
        await self._refresh_list(interaction)
    
    async def _on_prev(self, interaction: discord.Interaction):
        if self.page > 1:
            self.page -= 1
            await self._refresh_list(interaction)
        else:
            await interaction.response.defer()
    
    async def _on_next(self, interaction: discord.Interaction):
        if self.page < self.total_pages:
            self.page += 1
            await self._refresh_list(interaction)
        else:
            await interaction.response.defer()
    
    async def _on_model_select(self, interaction: discord.Interaction):
        model_id = interaction.data.get("values", [])[0] if interaction.data.get("values") else None
        if model_id:
            from bson import ObjectId
            model = await self.bot.db[Db_Constant.SHIP_MODEL].find_one({"_id": ObjectId(model_id)})
            if model:
                # Show details view
                details_view = ShipModelDetailsView(self.bot, self.author, model, parent_view=self)
                embed = details_view.get_embed()
                await interaction.response.edit_message(embed=embed, view=details_view)
            else:
                await interaction.response.send_message("Model not found.", ephemeral=True)
        else:
            await interaction.response.defer()
    
    async def _refresh_list(self, interaction: discord.Interaction):
        from bot.core.constant import Db_Constant
        
        # Build query
        query = {}
        if self.category_filter != "All":
            query["category"] = self.category_filter
        
        # Get models
        skip = (self.page - 1) * self.per_page
        cursor = self.bot.db[Db_Constant.SHIP_MODEL].find(query).skip(skip).limit(self.per_page)
        self.models = await cursor.to_list(length=self.per_page)
        self.total_count = await self.bot.db[Db_Constant.SHIP_MODEL].count_documents(query)
        self.total_pages = max(1, (self.total_count + self.per_page - 1) // self.per_page)
        
        self._setup_items()
        embed = self.get_embed()
        await interaction.response.edit_message(embed=embed, view=self)
    
    def get_embed(self) -> discord.Embed:
        """Generate the list embed."""
        title = "🚀 SHIP MODEL DATABASE"
        if self.category_filter != "All":
            title += f" — {self.category_filter}"
        
        embed = discord.Embed(title=title, color=discord.Color.blue())
        
        if not self.models:
            embed.description = "No ship models found."
        else:
            lines = []
            for i, model in enumerate(self.models):
                idx = (self.page - 1) * self.per_page + i + 1
                lines.append(f"`{idx:03}` **{model['model_name']}** — {model['category']}")
            embed.description = "\n".join(lines)
        
        embed.set_footer(text=f"Total: {self.total_count} models | Page {self.page}/{self.total_pages}")
        return embed
    
    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.author.id:
            await interaction.response.send_message("You are not authorized to use this.", ephemeral=True)
            return False
        return True


class ShipModelDetailsView(discord.ui.View):
    """Details view for a single ship model with edit/delete buttons."""
    
    def __init__(self, bot, author: discord.User, model: dict, parent_view: ShipModelListView):
        super().__init__(timeout=300.0)
        self.bot = bot
        self.author = author
        self.model = model
        self.parent_view = parent_view
        
        # Add buttons
        self.add_item(self.EditButton())
        self.add_item(self.DeleteButton())
        self.add_item(self.BackButton())
    
    def get_embed(self) -> discord.Embed:
        """Generate the details embed."""
        embed = discord.Embed(
            title=f"🚀 {self.model['model_name']}",
            color=discord.Color.green()
        )
        embed.add_field(name="Manufacturer", value=self.model['category'], inline=True)
        embed.add_field(name="Model Name", value=self.model['model_name'], inline=True)
        embed.add_field(name="Created By", value=f"<@{self.model['created_by']}>", inline=True)
        
        if self.model.get('image_url'):
            embed.set_image(url=self.model['image_url'])
        
        return embed
    
    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.author.id:
            await interaction.response.send_message("You are not authorized to use this.", ephemeral=True)
            return False
        return True
    
    class EditButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="✏️ Edit", style=discord.ButtonStyle.primary, row=0)
        
        async def callback(self, interaction: discord.Interaction):
            view = self.view
            # Show edit view - pass the message reference
            edit_view = ShipModelEditView(view.bot, view.author, view.model, view.parent_view, interaction.message)
            embed = edit_view.get_embed()
            await interaction.response.edit_message(embed=embed, view=edit_view)
    
    class DeleteButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="🗑️ Delete", style=discord.ButtonStyle.danger, row=0)
        
        async def callback(self, interaction: discord.Interaction):
            view = self.view
            # Show delete confirmation
            confirm_view = ShipModelDeleteConfirmView(view.bot, view.author, view.model, view.parent_view)
            embed = discord.Embed(
                title="⚠️ Confirm Deletion",
                description=f"Are you sure you want to delete **{view.model['model_name']}**?\n\nThis action cannot be undone.",
                color=discord.Color.red()
            )
            await interaction.response.edit_message(embed=embed, view=confirm_view)
    
    class BackButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="⬅️ Back", style=discord.ButtonStyle.secondary, row=0)
        
        async def callback(self, interaction: discord.Interaction):
            view = self.view
            # Return to list
            await view.parent_view._refresh_list(interaction)


class ShipModelEditView(discord.ui.View):
    """View for editing a ship model (name and/or image)."""
    
    def __init__(self, bot, author: discord.User, model: dict, parent_view: ShipModelListView, message: discord.Message = None):
        super().__init__(timeout=300.0)
        self.bot = bot
        self.author = author
        self.model = model
        self.parent_view = parent_view
        self.new_name = None
        self.waiting_for_image = False
        self.message = message  # Store message reference passed from parent
        self.original_interaction = None  # Store for ephemeral editing
        
        self.add_item(self.EditNameButton())
        self.add_item(self.EditImageButton())
        self.add_item(self.SaveButton())
        self.add_item(self.CancelButton())
    
    def get_embed(self) -> discord.Embed:
        embed = discord.Embed(
            title=f"✏️ Edit: {self.model['model_name']}",
            description="Click a button to edit that field. Changes are optional.",
            color=discord.Color.yellow()
        )
        embed.add_field(name="Current Name", value=self.new_name or self.model['model_name'], inline=True)
        embed.add_field(name="Manufacturer", value=self.model['category'], inline=True)
        
        if self.model.get('image_url'):
            embed.set_thumbnail(url=self.model['image_url'])
        
        if self.new_name:
            embed.add_field(name="📝 Pending Changes", value=f"New name: **{self.new_name}**", inline=False)
        
        return embed
    
    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.author.id:
            await interaction.response.send_message("You are not authorized to use this.", ephemeral=True)
            return False
        # Store interaction for later use with ephemeral messages
        self.original_interaction = interaction
        return True
    
    class EditNameButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="📝 Edit Name", style=discord.ButtonStyle.secondary, row=0)
        
        async def callback(self, interaction: discord.Interaction):
            view = self.view
            # Defer first to acknowledge the interaction
            await interaction.response.defer()
            
            # Send a followup asking for the name
            await interaction.followup.send(
                "Type the new model name (or 'cancel' to cancel):",
                ephemeral=True
            )
            
            def check(m):
                return m.author.id == view.author.id and m.channel.id == interaction.channel.id
            
            try:
                msg = await view.bot.wait_for("message", timeout=60.0, check=check)
                if msg.content.lower() != "cancel":
                    view.new_name = msg.content.strip()
                try:
                    await msg.delete()
                except:
                    pass
                # Refresh the embed using edit_original_response for ephemeral
                embed = view.get_embed()
                await interaction.edit_original_response(embed=embed, view=view)
            except asyncio.TimeoutError:
                await interaction.followup.send("❌ Timed out.", ephemeral=True)
    
    class EditImageButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="🖼️ Edit Image", style=discord.ButtonStyle.secondary, row=0)
        
        async def callback(self, interaction: discord.Interaction):
            view = self.view
            # Defer first
            await interaction.response.defer()
            
            await interaction.followup.send(
                "Upload a new image for this model (within 60 seconds):",
                ephemeral=True
            )
            view.waiting_for_image = True
            
            def check(m):
                return (
                    m.author.id == view.author.id and 
                    m.channel.id == interaction.channel.id and
                    len(m.attachments) > 0 and
                    m.attachments[0].content_type and
                    m.attachments[0].content_type.startswith("image/")
                )
            
            try:
                msg = await view.bot.wait_for("message", timeout=60.0, check=check)
                attachment = msg.attachments[0]
                
                # Upload to Cloudinary
                temp_dir = f"temp/ship_models_edit/{interaction.guild.id}/{view.author.id}"
                os.makedirs(temp_dir, exist_ok=True)
                temp_path = f"{temp_dir}/{attachment.filename}"
                
                async with aiohttp.ClientSession() as session:
                    async with session.get(attachment.url) as resp:
                        if resp.status == 200:
                            with open(temp_path, "wb") as f:
                                f.write(await resp.read())
                
                public_id = await ship_model_public_id(view.model['category'], view.model['model_name'])
                await delete_ship_model_resource(public_id)
                new_url = await upload_ship_model_image(public_id, temp_path)
                
                # Update in database
                from bson import ObjectId
                await view.bot.db[Db_Constant.SHIP_MODEL].update_one(
                    {"_id": view.model['_id']},
                    {"$set": {"image_url": new_url}}
                )
                view.model['image_url'] = new_url
                
                # Cleanup
                try:
                    shutil.rmtree(temp_dir)
                    await msg.delete()
                except:
                    pass
                
                await interaction.followup.send("✅ Image updated!", ephemeral=True)
                # Refresh using edit_original_response
                embed = view.get_embed()
                await interaction.edit_original_response(embed=embed, view=view)
                
            except asyncio.TimeoutError:
                await interaction.followup.send("❌ Timed out waiting for image.", ephemeral=True)
            finally:
                view.waiting_for_image = False
    
    class SaveButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="💾 Save", style=discord.ButtonStyle.success, row=1)
        
        async def callback(self, interaction: discord.Interaction):
            view = self.view
            
            if view.new_name:
                from bson import ObjectId
                await view.bot.db[Db_Constant.SHIP_MODEL].update_one(
                    {"_id": view.model['_id']},
                    {"$set": {"model_name": view.new_name}}
                )
                view.model['model_name'] = view.new_name
            
            # Return to details view with edit confirmation
            details_view = ShipModelDetailsView(view.bot, view.author, view.model, view.parent_view)
            embed = details_view.get_embed()
            embed.set_footer(text="✅ Changes saved!")
            await interaction.response.edit_message(embed=embed, view=details_view)
    
    class CancelButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="❌ Cancel", style=discord.ButtonStyle.secondary, row=1)
        
        async def callback(self, interaction: discord.Interaction):
            view = self.view
            # Return to details without saving
            details_view = ShipModelDetailsView(view.bot, view.author, view.model, view.parent_view)
            embed = details_view.get_embed()
            await interaction.response.edit_message(embed=embed, view=details_view)


class ShipModelDeleteConfirmView(discord.ui.View):
    """Confirmation view for deleting a ship model."""
    
    def __init__(self, bot, author: discord.User, model: dict, parent_view: ShipModelListView):
        super().__init__(timeout=60.0)
        self.bot = bot
        self.author = author
        self.model = model
        self.parent_view = parent_view
        
        self.add_item(self.ConfirmButton())
        self.add_item(self.CancelButton())
    
    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.author.id:
            await interaction.response.send_message("You are not authorized to use this.", ephemeral=True)
            return False
        return True
    
    class ConfirmButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="🗑️ Yes, Delete", style=discord.ButtonStyle.danger, row=0)
        
        async def callback(self, interaction: discord.Interaction):
            view = self.view
            
            # Delete from Cloudinary
            public_id = await ship_model_public_id(view.model['category'], view.model['model_name'])
            await delete_ship_model_resource(public_id)
            
            # Delete from database
            await view.bot.db[Db_Constant.SHIP_MODEL].delete_one({"_id": view.model['_id']})
            
            # Defer first, then refresh list
            await interaction.response.defer()
            await interaction.followup.send(
                f"✅ **{view.model['model_name']}** has been deleted.",
                ephemeral=True
            )
            
            # Refresh parent list using edit_original_response
            query = {}
            if view.parent_view.category_filter != "All":
                query["category"] = view.parent_view.category_filter
            
            skip = (view.parent_view.page - 1) * view.parent_view.per_page
            cursor = view.bot.db[Db_Constant.SHIP_MODEL].find(query).skip(skip).limit(view.parent_view.per_page)
            view.parent_view.models = await cursor.to_list(length=view.parent_view.per_page)
            view.parent_view.total_count = await view.bot.db[Db_Constant.SHIP_MODEL].count_documents(query)
            view.parent_view.total_pages = max(1, (view.parent_view.total_count + view.parent_view.per_page - 1) // view.parent_view.per_page)
            
            view.parent_view._setup_items()
            embed = view.parent_view.get_embed()
            await interaction.edit_original_response(embed=embed, view=view.parent_view)
    
    class CancelButton(discord.ui.Button):
        def __init__(self):
            super().__init__(label="❌ Cancel", style=discord.ButtonStyle.secondary, row=0)
        
        async def callback(self, interaction: discord.Interaction):
            view = self.view
            # Return to details view
            details_view = ShipModelDetailsView(view.bot, view.author, view.model, view.parent_view)
            embed = details_view.get_embed()
            await interaction.response.edit_message(embed=embed, view=details_view)
