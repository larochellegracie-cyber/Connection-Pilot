/**
 * Database configuration loader
 *
 * Reads DB_HOST/DB_PORT/DB_USER/DB_PASS/DB_NAME from the environment (or a
 * local .env file). Railway's MYSQLHOST/MYSQLPORT/MYSQLUSER/MYSQLPASSWORD/
 * MYSQLDATABASE variables are also understood. Falls back to the platform
 * config.json when none of these are set.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from 'node:process';

/**
 * Database credentials interface
 */
export interface DatabaseCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Load database configuration from the task-local config file.
 * Reads from $NOMAD_TASK_DIR/config.json (defaults to /local/config.json).
 *
 * @returns Database connection credentials
 * @throws Error if config file not found or invalid
 */
export function getDatabaseCredentials(): DatabaseCredentials {
  // Standalone/local mode: load .env (if present) and use DB_* variables.
  // Falls back to the platform config.json below when they are not set.
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const host = env.DB_HOST || env.MYSQLHOST;
  const user = env.DB_USER || env.MYSQLUSER;
  const database = env.DB_NAME || env.MYSQLDATABASE;
  if (host && user && database) {
    return {
      host,
      port: parseInt(env.DB_PORT || env.MYSQLPORT || '3306', 10),
      user,
      password: env.DB_PASS ?? env.MYSQLPASSWORD ?? '',
      database,
    };
  }

  const configPath = join(env.NOMAD_TASK_DIR || '/local', 'config.json');

  if (!existsSync(configPath)) {
    throw new Error(
      `Database configuration file not found at ${configPath}`
    );
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));

    if (!config.DATABASE?.VALUE) {
      throw new Error('Invalid config.json structure: DATABASE.VALUE not found');
    }

    const db = config.DATABASE.VALUE;

    if (!db.HOST || !db.PORT || !db.USERNAME || !db.PASSWORD || !db.NAME) {
      throw new Error('Invalid config.json: Missing required database credentials');
    }

    return {
      host: db.HOST,
      port: parseInt(String(db.PORT), 10),
      user: db.USERNAME,
      password: db.PASSWORD,
      database: db.NAME,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse ${configPath}: Invalid JSON format`);
    }
    throw error;
  }
}

/**
 * SSL options for the MySQL connection. Enabled by default (certificate is not
 * verified, matching the original behaviour); set DB_SSL=false for a database
 * that does not offer SSL, such as some private-network setups.
 */
export function getDatabaseSsl(): { rejectUnauthorized: boolean } | undefined {
  return env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false };
}
