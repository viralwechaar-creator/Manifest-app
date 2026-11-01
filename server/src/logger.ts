import pino from 'pino';
import { config } from './config';

// Redact anything that could carry personal or secret data.
export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.phone', '*.email', '*.otp'],
});
