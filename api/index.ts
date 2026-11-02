// Vercel entry point: the same Express app, run as a serverless function (used for the online trial).
// For the real server, Docker runs server/src/index.ts instead (see docs/DEPLOYMENT.md).
import { createApp } from '../server/src/app';
import { migrate } from '../server/src/migrate';

// Log (never crash on) stray errors, so one bad request cannot take down requests that are still being served.
process.on('unhandledRejection', (e) => console.error('unhandled rejection', e instanceof Error ? e.message : e));
process.on('uncaughtException', (e) => console.error('uncaught exception', e.message));

const app = createApp();
let ready: Promise<void> | null = null;

export default async function handler(req: any, res: any) {
  try {
    // Create/update the database structure once per warm instance, before the first request is served.
    ready ??= migrate().catch((e) => { ready = null; throw e; });
    await ready;
  } catch (e) {
    console.error('database not ready', (e as Error).message);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: 'The service is starting up. Please try again in a moment.' }));
  }
  return app(req, res);
}
