import crypto from 'crypto';
import { config } from '../config';
import { query } from '../db';
import { logger } from '../logger';

/**
 * Message delivery beyond the in-app bell: email, SMS and WhatsApp.
 * - Families opt in per channel (notification_prefs). Safety messages cannot be muted.
 * - Nothing is queued while NOTIFY_PROVIDER is 'off', so no queue builds up for a channel that cannot deliver.
 * - Each message is sent at most once per person, channel and day (dedupe key), with retries and a visible failure state.
 */
export const deliveryConfigured = () => config.NOTIFY_PROVIDER === 'webhook' && !!config.NOTIFY_WEBHOOK_URL && !!config.NOTIFY_WEBHOOK_SECRET;

const categoryOf = (link: string) =>
  /fees|payment/.test(link) ? 'fees' : /attendance/.test(link) ? 'attendance' : /homework|results|timetable/.test(link) ? 'academics'
  : /safety|pickup|gate/.test(link) ? 'safety' : /transport/.test(link) ? 'transport' : /message|concern|meeting/.test(link) ? 'messages' : 'general';

export async function enqueueForUsers(userIds: string[], m: { title: string; body: string; category: string }) {
  if (!deliveryConfigured() || userIds.length === 0) return 0;
  const rows = (await query(
    `select u.id, coalesce(u.email, g.email, st.email) as email, coalesce(g.phone, st.phone) as phone,
            coalesce(p.email, true) as want_email, coalesce(p.sms, false) as want_sms, coalesce(p.whatsapp, false) as want_wa, coalesce(p.muted_categories, '{}') as muted
       from users u left join guardians g on g.user_id = u.id left join staff st on st.user_id = u.id left join notification_prefs p on p.user_id = u.id
      where u.id = any($1::uuid[]) and u.status = 'active'`, [userIds])).rows;
  const key = crypto.createHash('md5').update(m.title + '|' + m.body).digest('hex') + ':' + new Date().toISOString().slice(0, 10);
  let queued = 0;
  for (const r of rows) {
    if (m.category !== 'safety' && (r.muted as string[]).includes(m.category)) continue;
    const targets: [string, string | null][] = [['email', r.want_email ? r.email : null], ['sms', r.want_sms ? r.phone : null], ['whatsapp', r.want_wa ? r.phone : null]];
    for (const [channel, to] of targets) {
      if (!to) continue;
      const body = channel === 'email' ? m.body : `${m.title}: ${m.body}`.slice(0, 300);
      const ins = await query(
        `insert into outbox (user_id, channel, to_address, subject, body, category, dedupe_key) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,
        [r.id, channel, to, channel === 'email' ? m.title : null, body, m.category, key]);
      queued += ins.rowCount ?? 0;
    }
  }
  return queued;
}

/** In-app notification plus (when configured and opted in) email / SMS / WhatsApp. */
export async function notifyUsers(userIds: string[], title: string, body: string, link: string, category?: string) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  for (const id of ids) await query('insert into notifications (user_id, title, body, link) values ($1,$2,$3,$4)', [id, title, body, link]);
  await enqueueForUsers(ids, { title, body, category: category ?? categoryOf(link) }).catch((e) => logger.warn({ err: { message: e.message } }, 'could not queue message delivery'));
}

async function send(row: { id: number; channel: string; to_address: string; subject: string | null; body: string; category: string }) {
  if (!deliveryConfigured()) throw new Error('No delivery provider is configured');
  const payload = JSON.stringify({ id: row.id, channel: row.channel, to: row.to_address, subject: row.subject, body: row.body, category: row.category });
  const signature = crypto.createHmac('sha256', config.NOTIFY_WEBHOOK_SECRET!).update(payload).digest('hex');
  const res = await fetch(config.NOTIFY_WEBHOOK_URL!, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': signature }, body: payload, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`The delivery relay answered ${res.status}`);
  const j: any = await res.json().catch(() => ({}));
  return j?.id ? String(j.id) : null;
}

/** Sends due messages. Failures back off (2, 4, 8, 16 minutes) and are marked failed after 5 attempts. */
export async function processOutbox(limit = 50) {
  if (!deliveryConfigured()) return { sent: 0, failed: 0, retrying: 0 };
  const due = (await query(
    `update outbox set next_attempt_at = now() + interval '5 minutes'
      where id in (select id from outbox where status='queued' and next_attempt_at <= now() order by id limit $1 for update skip locked) returning *`, [limit])).rows;
  let sent = 0, failed = 0, retrying = 0;
  for (const r of due) {
    try {
      const ref = await send(r);
      await query("update outbox set status='sent', sent_at=now(), attempts=attempts+1, provider_ref=$2, last_error=null where id=$1", [r.id, ref]); sent++;
    } catch (e) {
      const attempts = r.attempts + 1; const msg = (e as Error).message.slice(0, 300);
      if (attempts >= 5) { await query("update outbox set status='failed', attempts=$2, last_error=$3 where id=$1", [r.id, attempts, msg]); failed++; }
      else { await query("update outbox set attempts=$2, last_error=$3, next_attempt_at = now() + ($4 || ' minutes')::interval where id=$1", [r.id, attempts, msg, String(2 ** attempts)]); retrying++; }
    }
  }
  return { sent, failed, retrying };
}
