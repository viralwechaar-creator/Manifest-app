import fs from 'fs';
import path from 'path';
import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config';
import { logger } from './logger';
import { csrfProtection, loadSession } from './middleware/auth';
import { errorHandler, notFound } from './middleware/errors';
import { authRouter } from './modules/auth';
import { cmsRouter } from './modules/cms/admin';
import { publicRouter } from './modules/cms/public';
import { inboxRouter } from './modules/inbox';
import { staffRouter } from './modules/staff';
import { PUBLIC_DIR, uploadsRouter } from './modules/uploads';
import { usersRouter } from './modules/users';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        frameSrc: ["'self'", 'https://www.google.com', 'https://maps.google.com'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(pinoHttp({ logger, serializers: { req: (r) => ({ method: r.method, url: r.url.split('?')[0] }), res: (r) => ({ status: r.statusCode }) } }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  app.use('/uploads', express.static(PUBLIC_DIR, { index: false, dotfiles: 'deny', maxAge: '7d', setHeaders: (r) => r.setHeader('X-Content-Type-Options', 'nosniff') }));

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use(loadSession);
  api.use(csrfProtection);
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use('/auth', authRouter);
  api.use('/public', publicRouter);
  api.use('/admin/cms', cmsRouter);
  api.use('/admin/uploads', uploadsRouter);
  api.use('/admin/inbox', inboxRouter);
  api.use('/admin/users', usersRouter);
  api.use('/admin', staffRouter);
  api.use(notFound);
  app.use('/api', api);

  // In production the built web app is served by the same process.
  const dist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
