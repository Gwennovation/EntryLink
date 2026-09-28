// Proof-of-payment file storage.
//   - Vercel Blob (private store) when the API runs on Vercel with a connected Blob store
//   - local disk (UPLOAD_DIR) in development and tests
// Private blobs are never publicly reachable: the API reads them with its own credentials and
// streams them only to users allowed to see the registration.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { config } from '../config.js';

const EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'application/pdf': '.pdf' };

const local = {
  name: 'local disk',
  async save(buffer, mimetype) {
    fs.mkdirSync(config.uploadDir, { recursive: true });
    const key = `${crypto.randomUUID()}${EXTENSIONS[mimetype] ?? ''}`;
    await fs.promises.writeFile(path.join(config.uploadDir, key), buffer);
    return key;
  },
  async open(key) {
    const file = path.join(config.uploadDir, path.basename(key));
    return fs.existsSync(file) ? fs.createReadStream(file) : null;
  },
  async remove(key) {
    await fs.promises.unlink(path.join(config.uploadDir, path.basename(key))).catch(() => {});
  },
};

const blob = {
  name: 'Vercel Blob (private)',
  async save(buffer, mimetype) {
    const { put } = await import('@vercel/blob');
    const { pathname } = await put(`proofs/${crypto.randomUUID()}${EXTENSIONS[mimetype] ?? ''}`, buffer, {
      access: 'private',
      contentType: mimetype,
    });
    return pathname;
  },
  async open(key) {
    const { get } = await import('@vercel/blob');
    const result = await get(key, { access: 'private' });
    return result?.stream ? Readable.fromWeb(result.stream) : null;
  },
  async remove(key) {
    const { del } = await import('@vercel/blob');
    await del(key).catch(() => {});
  },
};

export const storage = config.blobStorage ? blob : local;
