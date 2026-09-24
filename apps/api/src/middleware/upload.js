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

/** Accepts an optional single `proof` file and turns multer errors into clear 400s. */
export function proofUpload(req, res, next) {
  uploader.single('proof')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest(`proof: file must be ${config.maxUploadBytes / 1024 / 1024} MB or smaller.`));
    if (err instanceof multer.MulterError) return next(badRequest(`proof: ${err.message}`));
    next(err);
  });
}

export const proofFilePath = (name) => path.join(config.uploadDir, path.basename(name));

/** Remove an uploaded file when the request that carried it fails validation. */
export function discardUpload(file) {
  if (file) fs.promises.unlink(file.path).catch(() => {});
}
