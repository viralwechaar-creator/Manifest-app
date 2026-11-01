import { createApp } from './app';
import { config } from './config';
import { pool } from './db';
import { startJobs } from './jobs';
import { logger } from './logger';
import { migrate } from './migrate';

async function main() {
  await migrate();
  startJobs();
  const server = createApp().listen(config.PORT, () => logger.info(`API listening on :${config.PORT}`));

  // Stop cleanly when the host restarts or redeploys: finish in-flight requests, then close the database.
  let closing = false;
  const stop = (signal: string) => {
    if (closing) return; closing = true;
    logger.info({ signal }, 'shutting down');
    server.close(() => { pool.end().finally(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 15000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

// Anything that slips through is written to the log (which the host's log service or alerting watches) before the process restarts.
process.on('unhandledRejection', (reason) => { logger.fatal({ err: reason instanceof Error ? { message: reason.message, stack: reason.stack } : String(reason) }, 'unhandled promise rejection'); });
process.on('uncaughtException', (err) => { logger.fatal({ err: { message: err.message, stack: err.stack } }, 'uncaught exception'); process.exit(1); });
main().catch((e) => { logger.fatal({ err: { message: e?.message, stack: e?.stack } }, 'failed to start'); process.exit(1); });
