/**
 * Drizzle Kit configuration for database migrations
 *
 * Usage:
 * - Generate migrations: npx drizzle-kit generate
 * - Apply migrations: npx drizzle-kit migrate
 *
 * Configuration source:
 * - DB_* (or Railway MYSQL*) environment variables / .env, see src/server/db/config.ts
 * - Falls back to $NOMAD_TASK_DIR/config.json (defaults to /local/config.json)
 */
import { defineConfig } from 'drizzle-kit';
import { getDatabaseCredentials, getDatabaseSsl } from './src/server/db/config';

const credentials = getDatabaseCredentials();

export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: {
    host: credentials.host,
    port: credentials.port,
    user: credentials.user,
    password: credentials.password,
    database: credentials.database,
    ssl: getDatabaseSsl(),
  },
  verbose: true,
  strict: false,
});
