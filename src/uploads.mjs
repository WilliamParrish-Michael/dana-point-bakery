/**
 * Image uploads for bread photos. Files are saved to data/uploads/ (the same
 * folder as the database), so a single persistent directory holds the whole shop
 * — easy to back up and hand over. Served read-only at /uploads/<file>.
 */
import multer from 'multer';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = join(__dirname, '..', 'data', 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ALLOWED.has(ext) ? ext : '.jpg'}`);
  },
});

export const uploadImage = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 }, // 6 MB per photo
  fileFilter: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    if (ALLOWED.has(ext) && file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Please upload a JPG, PNG, WEBP, or GIF image.'));
  },
}).single('image');
