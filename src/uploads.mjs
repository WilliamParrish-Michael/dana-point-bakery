/**
 * Image uploads. Two backends, chosen automatically:
 *  - If Cloudinary is configured (CLOUDINARY_URL, or the three CLOUDINARY_* vars),
 *    uploads go to Cloudinary and are served from its CDN — persistent, survives
 *    restarts, works on Render's free tier.
 *  - Otherwise they save to data/uploads/ and are served locally (fine for dev, but
 *    ephemeral on a free host).
 * Either way, the returned URL is what gets stored in the database.
 */
import multer from 'multer';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { v2 as cloudinary } from 'cloudinary';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = join(__dirname, '..', 'data', 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const API_KEY = process.env.CLOUDINARY_API_KEY || '';
const API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
export const cloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_URL || (CLOUD_NAME && API_KEY && API_SECRET)
);
if (cloudinaryConfigured) {
  // The SDK reads CLOUDINARY_URL automatically; otherwise use the explicit vars.
  if (process.env.CLOUDINARY_URL) cloudinary.config({ secure: true });
  else cloudinary.config({ cloud_name: CLOUD_NAME, api_key: API_KEY, api_secret: API_SECRET, secure: true });
}

// Buffer the file in memory so we can either stream it to Cloudinary or write to disk.
export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 }, // 6 MB per photo
  fileFilter: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    if (ALLOWED.has(ext) && file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Please upload a JPG, PNG, WEBP, or GIF image.'));
  },
}).single('image');

/**
 * Persist an uploaded file and return its public URL.
 * @param {{ buffer:Buffer, originalname:string }} file  a multer memory file
 * @returns {Promise<string>}
 */
export async function storeImage(file) {
  if (cloudinaryConfigured) {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'dana-point-bakery', resource_type: 'image' },
        (err, res) => (err ? reject(err) : resolve(res))
      );
      stream.end(file.buffer);
    });
    return result.secure_url;
  }
  const ext = extname(file.originalname).toLowerCase();
  const name = `${crypto.randomUUID()}${ALLOWED.has(ext) ? ext : '.jpg'}`;
  writeFileSync(join(UPLOAD_DIR, name), file.buffer);
  return `/uploads/${name}`;
}
