import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://school:school_dev_pw@localhost:5432/school_test',
      APP_SECRET: 'a'.repeat(64),
      STORAGE_DIR: './storage-test',
      LOGIN_RATE_LIMIT: '5000',
    },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
