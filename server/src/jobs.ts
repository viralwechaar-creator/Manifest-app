import { deliveryConfigured, processOutbox } from './lib/delivery';
import { query } from './db';
import { logger } from './logger';
import { sendFeeReminders } from './modules/school/fees';
import { sendLibraryReminders } from './modules/school/library';

/** Deletes closed enquiries/messages (personal data) once the retention period set in Settings has passed. */
export async function purgeExpired() {
  const days = Number((await query("select value from site_settings where key = 'enquiry_retention_days'")).rows[0]?.value) || 365;
  const a = await query("delete from admission_enquiries where status = 'closed' and updated_at < now() - ($1 || ' days')::interval", [String(days)]);
  const b = await query("delete from contact_messages where status = 'closed' and updated_at < now() - ($1 || ' days')::interval", [String(days)]);
  await query("delete from sessions where expires_at < now()");
  await query("delete from notifications where read_at is not null and read_at < now() - interval '90 days'");
  if (a.rowCount || b.rowCount) {
    await query("insert into audit_logs (action, entity, details) values ('retention.purged','inbox',$1)", [JSON.stringify({ enquiries: a.rowCount, messages: b.rowCount, days })]);
    logger.info({ enquiries: a.rowCount, messages: b.rowCount }, 'retention purge');
  }
}

export function startJobs() {
  const run = () => purgeExpired().then(() => sendFeeReminders()).then(() => sendLibraryReminders()).catch((e) => logger.error({ err: e.message }, 'scheduled job failed'));
  setTimeout(run, 10_000).unref();
  setInterval(run, 6 * 3600_000).unref();
  // Message delivery (email / SMS / WhatsApp) every 2 minutes, only when a provider is configured.
  setInterval(() => { if (deliveryConfigured()) processOutbox().catch((e) => logger.error({ err: e.message }, 'message delivery failed')); }, 120_000).unref();
}
