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
import { query } from './db';
import { demoRouter } from './modules/demo';
import { safetyRouter, familySafety } from './modules/school/wellbeing';
import { meetingsRouter, familyMeetings } from './modules/school/meetings';
import { classworkRouter, familyClasswork } from './modules/school/classwork';
import { growthRouter, familyGrowth } from './modules/school/growth';
import { reportsRouter } from './modules/school/reports';
import { outboxRouter, prefsRouter, privacyRouter } from './modules/school/platform';
import { seoRouter } from './modules/seo';
import { refreshGrading } from './lib/grading';

import { asyncH, errorHandler, notFound } from './middleware/errors';
import { authRouter } from './modules/auth';
import { cmsRouter } from './modules/cms/admin';
import { publicRouter } from './modules/cms/public';
import { inboxRouter } from './modules/inbox';
import { staffRouter } from './modules/staff';
import { PUBLIC_DIR, uploadsRouter } from './modules/uploads';
import { usersRouter } from './modules/users';
import { academicsRouter } from './modules/school/academics';
import { staffRouter2 } from './modules/school/staff';
import { studentsRouter } from './modules/school/students';
import { opsRouter } from './modules/school/ops';
import { examsRouter } from './modules/school/exams';
import { familyRouter } from './modules/school/family';
import { admissionsRouter, applyRouter } from './modules/school/admissions';
import { feesRouter } from './modules/school/fees';
import { familyExtra, staffComplaints, staffMessages } from './modules/school/communication';
import { hrRouter, jobsPublicRouter } from './modules/school/hr';
import { libraryRouter } from './modules/school/library';
import { transportRouter } from './modules/school/transport';
import { familyAdminRouter } from './modules/school/family-admin';

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
  api.use(rateLimit({ windowMs: 60_000, limit: config.API_RATE_LIMIT, standardHeaders: true, legacyHeaders: false }));
  api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use(loadSession);
  api.use((_req, _res, next) => { refreshGrading().then(() => next(), () => next()); }); // picks up a changed grading scale within a minute
  api.use(csrfProtection);
  api.get('/health', (_req, res) => res.json({ ok: true }));
  // Readiness: also proves the database answers. Point uptime monitors and container health checks here.
  api.get('/ready', asyncH(async (_req, res) => { await query('select 1'); res.json({ ok: true }); }));
  api.use('/auth', authRouter);
  api.use('/public', publicRouter);
  api.use('/admin/cms', cmsRouter);
  api.use('/admin/uploads', uploadsRouter);
  api.use('/admin/inbox', inboxRouter);
  api.use('/admin/users', usersRouter);
  api.use('/admin/school', academicsRouter);
  api.use('/admin/school', opsRouter);
  api.use('/admin/school', examsRouter);
  api.use('/admin/school', familyAdminRouter);
  api.use('/admin/school/admissions', admissionsRouter);
  api.use('/admin/school/fees', feesRouter);
  api.use('/admin/school/messages', staffMessages);
  api.use('/admin/school/complaints', staffComplaints);
  api.use('/admin/school/transport', transportRouter);
  api.use('/admin/school/library', libraryRouter);
  api.use('/admin/school/hr', hrRouter);
  api.use('/apply/jobs', jobsPublicRouter);
  api.use('/apply', applyRouter);
  api.use('/family', familyRouter);
  api.use('/family', familyExtra);
  api.use('/family', familySafety);
  api.use('/family', familyMeetings);
  api.use('/family', familyClasswork);
  api.use('/family', familyGrowth);
  api.use('/admin/school/staff', staffRouter2);
  api.use('/admin/school/students', studentsRouter);
  api.use('/admin/school/safety', safetyRouter);
  api.use('/admin/school/meetings', meetingsRouter);
  api.use('/admin/school/classwork', classworkRouter);
  api.use('/admin/school/growth', growthRouter);
  api.use('/admin/school/reports', reportsRouter);
  api.use('/admin/school/privacy', privacyRouter);
  api.use('/admin/outbox', outboxRouter);
  api.use('/prefs', prefsRouter);
  api.use('/admin/demo', demoRouter);
  api.use('/admin', staffRouter);
  api.use(notFound);
  app.use('/api', api);
  app.use(seoRouter);

  // In production the built web app is served by the same process.
  const dist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    // Only real page routes fall back to the web app; missing files and API paths stay 404.
    app.get('*', (req, res, next) => (req.path.startsWith('/uploads/') || req.path.startsWith('/api/') ? next() : res.sendFile(path.join(dist, 'index.html'))));
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

/** Every route the app answers, as "METHOD /path". Used by tests to prove each protected route is guarded. */
export function listRoutes(app: any): { method: string; path: string }[] {
  const out: { method: string; path: string }[] = [];
  const mount = (layer: any) => layer.regexp.source.replace('^', '').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/');
  const walk = (stack: any[], prefix: string) => {
    for (const l of stack) {
      if (l.route) for (const m of Object.keys(l.route.methods)) out.push({ method: m.toUpperCase(), path: prefix + l.route.path });
      else if (l.name === 'router' && l.handle?.stack) walk(l.handle.stack, prefix + mount(l));
    }
  };
  walk(app._router.stack, '');
  return out;
}
