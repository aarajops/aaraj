import { defineConfig } from 'drizzle-kit';
import { loadLocalEnvironment } from './src/platform/config/local-environment.js';

loadLocalEnvironment();

export default defineConfig({
  schema: './src/auth/auth-schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['identity'],
  dbCredentials: {
    host: process.env.POSTGRES_HOST ?? '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? '',
    password: process.env.POSTGRES_PASSWORD ?? '',
    database: process.env.POSTGRES_DB ?? '',
  },
});
