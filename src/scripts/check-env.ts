/**
 * Reports which deployment settings are present or missing. Prints NAMES only,
 * never values. Exits with code 1 if anything required is missing.
 *
 * Usage:
 *   npm run check:env
 *
 * Loads a local .env file if present (same as the server). On Railway you can
 * run it against the deployed variables with `railway run npm run check:env`.
 */
import { existsSync } from 'node:fs';

type Setting = {
  /** Any one of these names satisfies the setting. */
  names: string[];
  purpose: string;
};

export const REQUIRED: Setting[] = [
  { names: ['DB_HOST', 'MYSQLHOST'], purpose: 'database host' },
  { names: ['DB_USER', 'MYSQLUSER'], purpose: 'database user' },
  { names: ['DB_PASS', 'MYSQLPASSWORD'], purpose: 'database password' },
  { names: ['DB_NAME', 'MYSQLDATABASE'], purpose: 'database name' },
  { names: ['BETTER_AUTH_SECRET'], purpose: 'login/session encryption (random 32+ byte value)' },
  { names: ['BETTER_AUTH_URL'], purpose: 'public address of the site, e.g. https://connectionpilot.net' },
];

export const FEATURES: Setting[] = [
  { names: ['RESEND_API_KEY'], purpose: 'sending email (password resets, quotes, schedules, contact form)' },
  { names: ['EMAIL_FROM'], purpose: 'sender address on the verified domain (default noreply@connectionpilot.net)' },
  { names: ['STRIPE_SECRET_KEY'], purpose: 'payments and subscriptions' },
  { names: ['STRIPE_WEBHOOK_SECRET'], purpose: 'verifying Stripe webhooks' },
  { names: ['OPENAI_API_KEY'], purpose: 'Pilot assistant and AI receptionist' },
  { names: ['TWILIO_ACCOUNT_SID'], purpose: 'phone and text' },
  { names: ['TWILIO_AUTH_TOKEN'], purpose: 'phone and text (also verifies Twilio webhooks)' },
  { names: ['FIRECRAWL_API_KEY'], purpose: 'learning about a business from its website' },
];

export function isSet(setting: Setting, env: NodeJS.ProcessEnv): boolean {
  return setting.names.some((name) => Boolean(env[name]?.trim()));
}

export function evaluate(env: NodeJS.ProcessEnv) {
  return {
    missingRequired: REQUIRED.filter((s) => !isSet(s, env)),
    missingFeatures: FEATURES.filter((s) => !isSet(s, env)),
  };
}

function label(setting: Setting): string {
  return setting.names.join(' or ');
}

function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');

  const { missingRequired, missingFeatures } = evaluate(process.env);
  const line = (mark: string, s: Setting) => console.log(`  ${mark} ${label(s)} — ${s.purpose}`);

  console.log('Required to start:');
  REQUIRED.forEach((s) => line(missingRequired.includes(s) ? 'MISSING' : 'ok     ', s));
  console.log('\nNeeded for features:');
  FEATURES.forEach((s) => line(missingFeatures.includes(s) ? 'missing' : 'ok     ', s));

  if (process.env.NODE_ENV === 'production' && !isSet({ names: ['RESEND_API_KEY'], purpose: '' }, process.env)) {
    console.log('\nNote: in production, sending email without RESEND_API_KEY fails instead of printing to the terminal.');
  }

  if (missingRequired.length > 0) {
    console.log(`\n${missingRequired.length} required setting(s) missing.`);
    process.exit(1);
  }
  console.log('\nAll required settings are present.');
}

if (process.argv[1] && /check-env\.[tj]s$/.test(process.argv[1])) main();
