import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config';
import { audit } from '../lib/audit';
import { requirePermission } from '../middleware/auth';
import { asyncH, HttpError } from '../middleware/errors';

export const PUBLIC_DIR = path.resolve(config.STORAGE_DIR, 'public');
// Reserved for sensitive documents in later phases; never served statically.
export const PRIVATE_DIR = path.resolve(config.STORAGE_DIR, 'private');
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(PRIVATE_DIR, { recursive: true });

// File type is decided from the file's own bytes, never from its name or declared type.
export function sniff(b: Buffer): { ext: string; kind: 'image' | 'document' } | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', kind: 'image' };
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', kind: 'image' };
  if (b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return { ext: 'webp', kind: 'image' };
  if (b.length > 12 && b.subarray(0, 5).toString() === '%PDF-') return { ext: 'pdf', kind: 'document' };
  return null;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
export const uploadsRouter = Router();

uploadsRouter.post('/', requirePermission('cms.manage'), upload.single('file'), asyncH(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
  const t = sniff(req.file.buffer);
  if (!t) throw new HttpError(400, 'Only JPG, PNG, WebP images and PDF files are allowed.');
  if (t.kind === 'image' && req.file.size > 5 * 1024 * 1024) throw new HttpError(400, 'Images must be 5 MB or smaller.');
  const name = `${crypto.randomBytes(16).toString('hex')}.${t.ext}`;
  await fs.promises.writeFile(path.join(PUBLIC_DIR, name), req.file.buffer, { flag: 'wx' });
  await audit(req, 'file.uploaded', 'upload', name, { kind: t.kind, size: req.file.size });
  res.status(201).json({ url: `/uploads/${name}`, kind: t.kind });
}));
