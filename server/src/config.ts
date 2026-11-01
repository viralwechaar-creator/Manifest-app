import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  APP_SECRET: z.string().regex(/^[0-9a-f]{64}$/i, 'APP_SECRET must be 64 hex characters'),
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:5173'),
  SESSION_TTL_HOURS: z.coerce.number().default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().default(120),
  STORAGE_DIR: z.string().default('./storage'),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(30), // sign-in attempts per IP per 15 minutes
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const env = parsed.data;

export const config = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
};
