import { NextFunction, Request, Response, Router } from 'express';
import { config } from '../config';
import { query } from '../db';
import { audit } from '../lib/audit';
import { HttpError, asyncH } from '../middleware/errors';
import { requireAuth } from '../middleware/auth';
import { seedDemo } from '../scripts/seed-demo';

/**
 * "Load demo school" for trial sites. Triple-guarded: the host must set ALLOW_DEMO_DATA=true,
 * the user must be a Super Admin, and the school must have no students yet.
 * It is never available on a real deployment, where the flag is simply not set.
 */
export const demoRouter = Router();
demoRouter.use(requireAuth, (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth!.roles.includes('super_admin')) return next(new HttpError(403, 'Only a Super Admin can do this.'));
  next();
});

const available = async () => config.ALLOW_DEMO_DATA === 'true' && (await query('select 1 from students limit 1')).rowCount === 0;
let running = false;

demoRouter.get('/status', asyncH(async (_req, res) => { res.json({ available: !running && (await available()) }); }));

demoRouter.post('/load', asyncH(async (req, res) => {
  if (!(await available())) throw new HttpError(409, 'Demo data is not available here (it needs a trial site with no students yet).');
  if (running) throw new HttpError(409, 'Demo data is already being loaded. Please wait.');
  running = true;
  try { await seedDemo(); } catch (e) { throw new HttpError(500, 'Loading the demo data failed: ' + (e as Error).message); } finally { running = false; }
  await audit(req, 'demo.loaded', 'system', 'demo');
  res.json({ ok: true });
}));
