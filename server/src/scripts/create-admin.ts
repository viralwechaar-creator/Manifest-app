import readline from 'readline';
import { pool, query } from '../db';
import { migrate } from '../migrate';
import { hashPassword, passwordProblem } from '../lib/password';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));

async function main() {
  await migrate();
  const loginId = process.env.ADMIN_LOGIN || (await ask('Admin login ID (e.g. an email): ')).trim();
  const name = process.env.ADMIN_NAME || (await ask('Full name: ')).trim();
  const pw = process.env.ADMIN_PASSWORD || (await ask('Password (min 10 chars, letters + numbers): '));
  rl.close();
  const problem = passwordProblem(pw);
  if (problem) throw new Error(problem);
  const role = (await query("select id from roles where code = 'super_admin'")).rows[0].id;
  const u = await query(
    `insert into users (login_id, display_name, email, password_hash) values ($1::citext,$2,$3::citext,$4) returning id`,
    [loginId, name, loginId.includes('@') ? loginId : null, await hashPassword(pw)]);
  await query('insert into user_roles values ($1,$2)', [u.rows[0].id, role]);
  await query("insert into audit_logs (user_id, action, entity, entity_id) values ($1,'user.bootstrap','user',$1::text)", [u.rows[0].id]);
  console.log('Super Admin created. You can now sign in.');
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
