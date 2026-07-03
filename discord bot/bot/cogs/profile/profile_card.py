# save as render_profile_card.py
import os
from typing import Optional

from PIL import Image, ImageDraw, ImageFont, ImageOps

# CONFIG - paths & sizes
TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "../../../assets/profile_card.png")
FONT_PATH = os.path.join(os.path.dirname(__file__), "../../../assets/fonts/MonospaceBold.ttf")


# fallback if fonts not found (Pillow default)
def load_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


async def profile_card(
    profile_data: dict,
    output_path: str,
    portrait_path: Optional[str] = None,
    portrait_size: tuple[int, int] = (110, 120),
    portrait_position: tuple[int, int] = (300, 90),
    font_size: int = 15,
):
    """
    Create a profile card PNG at `output_path` using TEMPLATE_PATH. If portrait_path is given,
    it's placed with gentle rounded corners. Also draws an RP progress bar at the bottom
    showing total_rp relative to the current rank's min/max RP.
    """
    # Ensure output directory exists
    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    # Load template
    img = Image.open(TEMPLATE_PATH).convert("RGBA")
    draw = ImageDraw.Draw(img)
    font = load_font(FONT_PATH, font_size)

    # Safe-get values from profile_data
    citizen_name = profile_data.get("citizen_name", "Unknown")
    place_of_birth = profile_data.get("place_of_birth", "Unknown")
    citizenship = profile_data.get("citizenship", "Unknown")

    # rp fields
    rp_obj_raw = profile_data.get("rp_rank", {}) or {}

    try:
        rp_obj = dict(rp_obj_raw)
    except Exception:
        rp_obj = rp_obj_raw  # fallback, use as-is

    rp_title = rp_obj.get("title", None)
    rp_min = rp_obj.get("min_rp", 0)
    rp_max = rp_obj.get("max_rp", 0)
    total_rp = int(profile_data.get("total_rp", 0))

    # Draw text (adjust coordinates to match your template)
    draw.text((160, 94), citizen_name.title(), font=font, fill="white")
    draw.text((160, 115), place_of_birth.title(), font=font, fill="white")
    draw.text((160, 135), citizenship.title(), font=font, fill="white")
    if rp_title:
        draw.text((160, 155), rp_title.title(), font=font, fill="white")

    # If portrait provided, place it as a portrait-fill (crop-to-fit) with rounded corners
    if portrait_path and os.path.exists(portrait_path):
        portrait = Image.open(portrait_path).convert("RGBA")

        # Resampling filter: Pillow >=9 uses Image.Resampling
        try:
            resample_filter = Image.Resampling.LANCZOS
        except Exception:
            resample_filter = Image.LANCZOS

        # Use ImageOps.fit to 'cover' the box: preserves aspect ratio, crops to fill.
        # centering=(0.5,0.35) can be changed to reposition the crop (e.g., favor upper part for faces)
        portrait_filled = ImageOps.fit(portrait, portrait_size, method=resample_filter, centering=(0.5, 0.5))

        # Create rounded mask (L mode) and apply as alpha
        radius = max(2, int(min(portrait_size) * 0.15))  # e.g. 15% radius; tweak as needed
        mask = Image.new("L", portrait_size, 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.rounded_rectangle([0, 0, portrait_size[0], portrait_size[1]], radius=radius, fill=255)

        # Put alpha and (optionally) a subtle inner border by compositing onto transparent background
        portrait_with_alpha = Image.new("RGBA", portrait_size, (0, 0, 0, 0))
        portrait_with_alpha.paste(portrait_filled, (0, 0))
        portrait_with_alpha.putalpha(mask)

        # Draw a professional border around the portrait
        border = Image.new("RGBA", portrait_size, (0, 0, 0, 0))
        bd = ImageDraw.Draw(border)
        # Outer golden/amber border (matches the card theme)
        bd.rounded_rectangle(
            [1, 1, portrait_size[0]-2, portrait_size[1]-2], 
            radius=radius,
            outline=(236, 185, 28, 255),  # Gold/amber color
            width=2
        )
        # Inner subtle white highlight
        bd.rounded_rectangle(
            [3, 3, portrait_size[0]-4, portrait_size[1]-4], 
            radius=radius-2,
            outline=(255, 255, 255, 80),  # Subtle white
            width=1
        )
        portrait_with_alpha = Image.alpha_composite(portrait_with_alpha, border)

        # Paste portrait onto card (uses portrait alpha as mask)
        img.paste(portrait_with_alpha, portrait_position, portrait_with_alpha)

    # -------------------------
    # Draw RP progress bar at bottom
    # -------------------------
    # Bar layout (tweak these to match your template visually)
    margin_x = 38
    bar_y_from_bottom = 45        # moved UP to create gap from dashed line below
    bar_height = 22               # slightly taller for better visibility
    bar_radius = 11               # rounded corners for the bar
    bar_x1 = margin_x
    bar_x2 = img.width / 1.55     # wider bar (was 1.8, now matches text width better)
    bar_y1 = img.height - bar_y_from_bottom - bar_height
    bar_y2 = img.height - bar_y_from_bottom

    # Compute progress fraction between min and max
    if rp_max > rp_min:
        progress = (total_rp - rp_min) / (rp_max - rp_min)
    else:
        # If no valid range, treat as full or 0 depending on total_rp
        progress = 1.0 if total_rp >= rp_max else 0.0

    # Clamp 0..1
    progress = max(0.0, min(1.0, progress))

    # Colors
    bar_bg_color = (40, 40, 40, 220)         # dark translucent background
    bar_fill_color = (236, 185, 28, 255)     # yellow-ish fill
    bar_border_color = (255, 255, 255, 80)   # subtle white border
    text_color = (0, 0, 0, 255)              # BLACK text for contrast on yellow bar

    # Draw background rounded rectangle (bar track)
    draw.rounded_rectangle([bar_x1, bar_y1, bar_x2, bar_y2], radius=bar_radius, fill=bar_bg_color)

    # Filled width based on progress
    fill_x2 = int(bar_x1 + (bar_x2 - bar_x1) * progress)
    # Avoid tiny rounded-rectangle rendering issues when very small; if fill width < radius, draw rectangle
    if fill_x2 - bar_x1 > 2:
        # Draw filled portion with same radius but clip to current fill width
        # To preserve rounded left corner and a proper right edge for partial fills, draw rounded rect to full width
        # and then overlay a rectangle if needed. Simpler: use rounded rectangle where width >= bar_height.
        draw.rounded_rectangle([bar_x1, bar_y1, fill_x2, bar_y2], radius=bar_radius, fill=bar_fill_color)
    # small fills will simply draw a rectangle slice (covered by the rounded_rectangle case above if wide enough)
    else:
        draw.rectangle([bar_x1, bar_y1, fill_x2, bar_y2], fill=bar_fill_color)

    # Optional: subtle border
    draw.rounded_rectangle([bar_x1, bar_y1, bar_x2, bar_y2], radius=bar_radius, outline=bar_border_color, width=2)

    # RP text overlay: "75 / 149" and optionally current RP title/emoji
    rp_text = f"{total_rp} / {rp_max if rp_max else '—'}"

    # Use a slightly larger font for the progress bar
    bar_font = load_font(FONT_PATH, font_size + 2)
    
    # Draw the numeric RP text centered on the bar
    # compute text size to center it
    try:
        # Pillow >=8: use textbbox for accurate bounding box
        bbox = draw.textbbox((0, 0), rp_text, font=bar_font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
    except Exception:
        text_w, text_h = draw.textsize(rp_text, font=bar_font)

    text_x = bar_x1 + ((bar_x2 - bar_x1) - text_w) // 2
    text_y = bar_y1 + ((bar_y2 - bar_y1) - text_h) // 2 - 1  # slight adjustment for vertical centering

    # Draw black text directly (no shadow needed with black on yellow)
    draw.text((text_x, text_y), rp_text, font=bar_font, fill=text_color)

    # Save final PNG
    img.save(output_path)
