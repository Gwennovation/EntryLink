import multer from 'multer';
import { config } from '../config.js';
import { badRequest } from '../lib/errors.js';
import { storage } from '../lib/storage.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);

// Held in memory (max 4 MB) so the contents can be checked before anything is stored.
const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
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

/**
 * Accepts an optional single `proof` file and turns multer errors into clear 400s.
 * The browser-reported type is only a first filter: the file's actual bytes must match an allowed
 * format, and that detected type is what gets stored and served back. The stored key is exposed
 * as req.file.filename.
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
      const detected = sniffType(req.file.buffer.subarray(0, 16));
      if (!detected) return next(badRequest("proof: that file isn't a valid JPG, PNG, WEBP, HEIC image or PDF."));
      req.file.mimetype = detected;
      req.file.filename = await storage.save(req.file.buffer, detected);
      req.file.buffer = null; // done with it; don't keep 4 MB alive for the rest of the request
      next();
    } catch (e) {
      next(e);
    }
  });
}

/** Remove a stored upload when the request that carried it fails validation. */
export function discardUpload(file) {
  if (file?.filename) storage.remove(file.filename);
}
