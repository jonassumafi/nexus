from dotenv import load_dotenv
load_dotenv()

import cloudinary
from cloudinary import CloudinaryImage
import cloudinary.uploader
import cloudinary.api

import json

config  = cloudinary.config(secure = True)
print("****1. Set up and configure the SDK:****\nCredentials: ", config.cloud_name, config.api_key, "\n")


def upload_image():
    cloudinary.uploader.upload("https://cloudinary-devs.github.io/cld-docs-assets/assets/images/butterfly.jpeg",public_id="quickstart_butterfly", unique_filename=False, overwrite=True)
    srcURL = CloudinaryImage("quickstart_butterfly.jpeg").build_url()

    # Log the image URL to the console.
    # Copy this URL in a browser tab to generate the image on the fly.
    print("****2. Upload an image****\nDelivery URL: ", srcURL, "\n")

def getAssetInfo(resource_info):

  # Get and use details of the image
  # ==============================

  # Get image details and save it in the variable 'image_info'.
  image_info=cloudinary.api.resource(resource_info)
  print("****3. Get and use details of the image****\nUpload response:\n", json.dumps(image_info,indent=2), "\n")

  # Assign tags to the uploaded image based on its width. Save the response to the update in the variable 'update_resp'.
  if image_info["width"]>900:
    update_resp=cloudinary.api.update("quickstart_butterfly", tags = "large")
  elif image_info["width"]>500:
    update_resp=cloudinary.api.update("quickstart_butterfly", tags = "medium")
  else:
    update_resp=cloudinary.api.update("quickstart_butterfly", tags = "small")

  # Log the new tag to the console.
  print("New tag: ", update_resp["tags"], "\n")

def delete_image(public_id):
    # Delete the resource from your Cloudinary account
    result = cloudinary.uploader.destroy(public_id)
    print("****4. Delete the image****\nDelete response:\n", result, "\n")


def upload_profile():

    existing_info = getAssetInfo("quickstart_butterfly")

delete_image("quickstart_butterfly")

