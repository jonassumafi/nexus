"""
Ship Model Image Upload Helper

Handles uploading ship model images to Cloudinary with optimization.
"""

import cloudinary
import cloudinary.uploader
import cloudinary.api
from cloudinary import CloudinaryImage


config = cloudinary.config(secure=True)


async def ship_model_public_id(category: str, model_name: str) -> str:
    """Generate a unique public ID for ship model images."""
    # Clean up category and model name for use in public_id
    clean_category = category.lower().replace(" ", "_").replace("(", "").replace(")", "")
    clean_model = model_name.lower().replace(" ", "_")
    return f"ship_models/{clean_category}/{clean_model}"


async def get_ship_model_resource(public_id: str):
    """Get resource info from Cloudinary."""
    try:
        return cloudinary.api.resource(public_id)
    except:
        return None


async def delete_ship_model_resource(public_id: str):
    """Delete a ship model image from Cloudinary."""
    try:
        return cloudinary.uploader.destroy(public_id)
    except Exception as e:
        return {"error": str(e)}


async def upload_ship_model_image(public_id: str, file_path: str) -> str:
    """
    Upload a ship model image to Cloudinary with optimization.
    
    - Auto quality optimization
    - Auto format selection (WebP, etc.)
    - Resize if larger than 512x512
    """
    resp = cloudinary.uploader.upload(
        file=file_path,
        public_id=public_id,
        overwrite=True,
        unique_filename=False,
        # Optimization settings
        quality="auto:good",  # Automatic quality optimization
        fetch_format="auto",  # Automatic format selection
        transformation=[
            {
                "width": 512,
                "height": 512,
                "crop": "limit"  # Only resize if larger, maintain aspect ratio
            }
        ]
    )
    
    # Build versioned URL
    new_url = CloudinaryImage(resp["public_id"]).build_url(version=resp["version"])
    return new_url
