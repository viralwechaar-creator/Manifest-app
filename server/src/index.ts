import { createApp } from './app';
import { config } from './config';
import { startJobs } from './jobs';
import { logger } from './logger';
import { migrate } from './migrate';

async function main() {
  await migrate();
  startJobs();
  createApp().listen(config.PORT, () => logger.info(`API listening on :${config.PORT}`));
}
main().catch((e) => { console.error(e); process.exit(1); });
