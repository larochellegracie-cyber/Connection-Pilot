/**
 * Standalone stub for #airo/secrets in exported AAB projects.
 *
 * In production AAB containers, getSecret reads from the Nomad task-local
 * config.json injected by dev-supervisor. Outside AAB (downloaded projects,
 * GitHub CI), secrets are resolved from environment variables so skills
 * (stripe, auth, hubspot, zoom, etc.) can be configured via a .env file.
 */

import { existsSync } from 'node:fs';

let lastDotEnvRead = 0;
/**
 * Local development: .env used to be read only as a side effect of the first database connection, so a key added to .env while the
 * server was running (or one needed before the first database call) was invisible until a restart. When a secret is not in the
 * environment, .env is read again (at most every 2 seconds). loadEnvFile never replaces a variable that is already set, so real
 * environment settings (Railway, CI) always win, and with no .env file this does nothing.
 */
function readDotEnvAgain(): void {
  if (process.env.VITEST) return; // tests set up their own environment; the developer's .env must not leak into them
  const now = Date.now();
  if (now - lastDotEnvRead < 2000) return;
  lastDotEnvRead = now;
  try { if (existsSync('.env')) process.loadEnvFile('.env'); } catch { /* an unreadable .env is the same as none */ }
}

export function getSecret(secretName: string): string | object | null {
  if (process.env[secretName] === undefined) readDotEnvAgain();
  return process.env[secretName] ?? null;
}

export function listSecretNames(): string[] {
  return Object.keys(process.env).filter(
    (k) => !k.startsWith('npm_') && !k.startsWith('NODE_') && !k.startsWith('PATH'),
  );
}
