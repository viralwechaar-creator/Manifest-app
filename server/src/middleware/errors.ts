import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { config } from '../config';
import { logger } from '../logger';

export class HttpError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}

export const asyncH = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, fields: err.fields });
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of err.issues) fields[i.path.join('.') || '_'] ??= i.message;
    return res.status(400).json({ error: 'Please check the highlighted fields.', fields });
  }
  if (err?.code === '23505') return res.status(409).json({ error: 'That value already exists.' });
  if (err?.code === '23503') return res.status(409).json({ error: 'This record is linked to other records, or refers to one that does not exist.' });
  if (err?.code === '22P02' || err?.code === '22007' || err?.code === '23514') return res.status(400).json({ error: 'Invalid value supplied.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request body.' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is too large.' });
  logger.error({ err: { message: err?.message, stack: config.isProd ? undefined : err?.stack }, path: req.path }, 'unhandled error');
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}
