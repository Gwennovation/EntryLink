import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';
import { badRequest } from '../lib/errors.js';

const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'application/pdf': '.pdf' };

fs.mkdirSync(config.uploadDir, { recursive: true });

// Local disk in the prototype; swap the storage engine for S3/GCS in production (spec §2.5).
const storage = multer.diskStorage({
  destination: config.uploadDir,
  // Random names: never trust (or expose) the client's filename on disk.
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED[file.mimetype]}`),
});

const uploader = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED[file.mimetype]) return cb(null, true);
    cb(badRequest('proof: upload a JPG, PNG, WEBP, HEIC image or a PDF.'));
  },
});

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** Identify a file by its first bytes ("magic numbers"). Returns an allowed MIME type or null. */
export function sniffType(head) {
  const ascii = (from, to) => head.subarray(from, to).toString('latin1');
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(8, 12))) return 'image/heic';
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

async function readHead(file) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(16), 0, 16, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Accepts an optional single `proof` file and turns multer errors into clear 400s.
 * The browser-reported type is only a first filter: the saved file's actual bytes must match an
 * allowed format, and that detected type is what gets stored and served back.
 */
export function proofUpload(req, res, next) {
  uploader.single('proof')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest(`proof: file must be ${config.maxUploadBytes / 1024 / 1024} MB or smaller.`));
      if (err instanceof multer.MulterError) return next(badRequest(`proof: ${err.message}`));
      return next(err);
    }
    if (!req.file) return next();
    try {
      const detected = sniffType(await readHead(req.file.path));
      if (!detected) {
        discardUpload(req.file);
        return next(badRequest("proof: that file isn't a valid JPG, PNG, WEBP, HEIC image or PDF."));
      }
      req.file.mimetype = detected;
      next();
    } catch (e) {
      discardUpload(req.file);
      next(e);
    }
  });
}

export const proofFilePath = (name) => path.join(config.uploadDir, path.basename(name));

/** Remove an uploaded file when the request that carried it fails validation. */
export function discardUpload(file) {
  if (file) fs.promises.unlink(file.path).catch(() => {});
}
