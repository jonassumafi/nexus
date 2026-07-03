
import discord



def dos_style_embed_builder(
        title:str,
        reason_block:str,
        color: discord.Color = discord.Color.red(),
        footer_text: str = None,
        fields : list[tuple[str, str, bool]] = None,
        image: str | None = None
        ):
    embed = discord.Embed(
        title= f"{title}",
        description=f"""
        ```ansi
        
{reason_block}


```""", color= color
    )
    if footer_text:
        embed.set_footer(text=footer_text)

    if fields:
        for name, value, inline in fields:
            embed.add_field(name=name, value= value, inline= inline)

    if image:
        embed.set_image(url=image)

    return embed