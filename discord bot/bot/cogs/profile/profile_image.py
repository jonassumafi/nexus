
import cloudinary
from cloudinary import CloudinaryImage
import cloudinary.uploader
import cloudinary.api


config  = cloudinary.config(secure = True)

async def profile_public_id(user_id: int):
    return f"profiles/user_{user_id}"


async def get_resource_info(public_id):
    try:
        return cloudinary.api.resource(public_id)
    except:
        return None


async def delete_resource(public_id):
    try:
        return cloudinary.uploader.destroy(public_id)
    except Exception as e:
        return {"error": str(e)}


async def upload_profile_image(public_id, file_path):
    resp = cloudinary.uploader.upload(
        file=file_path,
        public_id=public_id,
        override=True,
        unique_filename=True
    )
    # versioned URL
    new_url = CloudinaryImage(resp["public_id"]).build_url(version=resp["version"])
    return new_url