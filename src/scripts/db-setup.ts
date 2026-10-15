/**
 * Creates every table from src/server/db/schema.ts in an EMPTY database.
 *
 * Usage:
 *   npm run db:setup
 *
 * Why this exists instead of `drizzle-kit push`: MySQL limits foreign-key
 * names to 64 characters and Drizzle's automatic names are longer for some
 * tables, so a plain push fails partway. This script exports the schema as SQL,
 * shortens only the over-long constraint names (deterministically), and runs it.
 *
 * Safety: it refuses to touch a database that already contains tables. If a
 * statement fails, it drops the tables it created so you can simply run it
 * again after fixing the problem.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import mysql from 'mysql2/promise';

import { getDatabaseCredentials, getDatabaseSsl } from '../server/db/config';

const MAX_IDENTIFIER_LENGTH = 64;

/** Shorten constraint names longer than MySQL's limit, keeping them unique. */
export function shortenConstraintNames(sql: string): { sql: string; renamed: number } {
  let renamed = 0;
  const result = sql.replace(/CONSTRAINT `([^`]+)`/g, (match, name: string) => {
    if (name.length <= MAX_IDENTIFIER_LENGTH) return match;
    renamed += 1;
    const hash = createHash('md5').update(name).digest('hex').slice(0, 8);
    return `CONSTRAINT \`${name.slice(0, MAX_IDENTIFIER_LENGTH - 9)}_${hash}\``;
  });
  return { sql: result, renamed };
}

/** Split exported SQL into statements (each starts with CREATE TABLE / ALTER TABLE). */
export function splitStatements(sql: string): string[] {
  const start = sql.search(/^CREATE TABLE/m);
  if (start === -1) throw new Error('drizzle-kit export produced no CREATE TABLE statements');
  return sql
    .slice(start)
    .split(/;\s*\n(?=(?:CREATE|ALTER) TABLE)/)
    .map((statement) => statement.trim().replace(/;$/, ''))
    .filter(Boolean);
}

function exportSchemaSql(): string {
  return execFileSync('npx', ['--no-install', 'drizzle-kit', 'export', '--sql'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

async function main() {
  const credentials = getDatabaseCredentials();
  const connection = await mysql.createConnection({
    host: credentials.host,
    port: credentials.port,
    user: credentials.user,
    password: credentials.password,
    database: credentials.database,
    ssl: getDatabaseSsl(),
  });

  try {
    const [rows] = await connection.query(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()',
    );
    const existing = (rows as Array<{ name: string }>).length;
    if (existing > 0) {
      console.log(`Database "${credentials.database}" already has ${existing} table(s). Nothing to do.`);
      return;
    }

    const { sql, renamed } = shortenConstraintNames(exportSchemaSql());
    const statements = splitStatements(sql);
    console.log(`Creating ${statements.length} statements in "${credentials.database}" (${renamed} long constraint names shortened)...`);

    try {
      for (const statement of statements) {
        await connection.query(statement);
      }
    } catch (error) {
      console.error('Setup failed; removing the tables created so far so it can be re-run.');
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      const [created] = await connection.query(
        'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()',
      );
      for (const { name } of created as Array<{ name: string }>) {
        await connection.query(`DROP TABLE IF EXISTS \`${name}\``);
      }
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      throw error;
    }

    const [after] = await connection.query(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()',
    );
    console.log(`Done. ${(after as unknown[]).length} tables created.`);
  } finally {
    await connection.end();
  }
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && /db-setup\.[tj]s$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
