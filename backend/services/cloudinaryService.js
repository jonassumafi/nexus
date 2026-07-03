const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadPortrait(userId, filePath) {
  const result = await cloudinary.uploader.upload(filePath, {
    public_id: `profiles/user_${userId}`,
    overwrite: true,
    invalidate: true,
  });
  return result.secure_url;
}

async function uploadShipModel(category, modelName, filePath) {
  const sanitized = modelName.replace(/\s+/g, '_').toLowerCase();
  const result = await cloudinary.uploader.upload(filePath, {
    public_id: `ship_models/${category}/${sanitized}`,
    quality: 'auto:good',
    fetch_format: 'auto',
    transformation: [{ width: 512, height: 512, crop: 'limit' }],
    invalidate: true,
  });
  return result.secure_url;
}

async function uploadPortraitFromBase64(discordId, base64Data, mimeType = 'image/jpeg') {
  const dataUri = `data:${mimeType};base64,${base64Data}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    public_id: `nexus/portraits/portrait_${discordId}`,
    overwrite: true,
    invalidate: true,
  });
  return result.secure_url;
}

async function deleteResource(publicId) {
  return cloudinary.uploader.destroy(publicId);
}

async function getResourceInfo(publicId) {
  try {
    return await cloudinary.api.resource(publicId);
  } catch {
    return null;
  }
}

module.exports = { uploadPortrait, uploadPortraitFromBase64, uploadShipModel, deleteResource, getResourceInfo };
