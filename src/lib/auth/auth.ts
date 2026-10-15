/**
 * BetterAuth Server Configuration
 *
 * Supports both Email/Password and OAuth authentication.
 * Enable/disable methods by uncommenting the relevant sections.
 *
 * Secrets (via getSecret from #airo/secrets):
 * - BETTER_AUTH_SECRET: Session encryption key (auto-generated during install)
 * - OAuth credentials (GOOGLE_CLIENT_ID, etc.) for social login
 *
 * CORS/Trusted Origins:
 * - Only trusts origins matching the server's hostname
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from '@/server/db/client';
import { user, session, account, verification } from '@/server/db/schema';
import { getSecret } from '#airo/secrets';
import { sendEmail } from '@/server/email';

// Lazy singleton — betterAuth() must NOT run at module init time.
//
// The BETTER_AUTH_SECRET is loaded from the alloc config at runtime, so the
// auth instance must be constructed after the secrets are available (i.e. on
// the first HTTP request, not at import time).
//
// Pattern mirrors how db/client.ts defers the actual MySQL connection — the
// pool object is safe to create at init, but anything that reads schema state
// or secrets must be deferred to request time.
let _auth: ReturnType<typeof betterAuth> | null = null;

/** Extra exact origins from BETTER_AUTH_TRUSTED_ORIGINS (comma separated). */
function extraTrustedOrigins(): string[] {
  const raw = getSecret('BETTER_AUTH_TRUSTED_ORIGINS');
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function getAuth() {
  if (_auth) return _auth;

  const authSecret = getSecret('BETTER_AUTH_SECRET');
  if (!authSecret || typeof authSecret !== 'string') {
    throw new Error('BETTER_AUTH_SECRET is not set or invalid — run requestSecrets() first');
  }

  if (!db) {
    throw new Error('Database not configured. Install the database skill first, then configure auth.');
  }

  const configuredBaseUrl = getSecret('BETTER_AUTH_URL');
  const baseURL = typeof configuredBaseUrl === 'string' && configuredBaseUrl.trim()
    ? configuredBaseUrl.trim().replace(/\/$/, '')
    : 'https://connectionpilot.net';

  const auth = betterAuth({
    // Schema passed explicitly — avoids BetterAuth's runtime schema inference.
    database: drizzleAdapter(db, {
      provider: 'mysql',
      schema: { user, session, account, verification },
    }),

    secret: authSecret,
    // Keep auth redirects and reset links on the canonical public domain.
    baseURL,

    // Protect admin status field from user input
    user: {
      additionalFields: {
        isAdmin: {
          type: 'boolean',
          defaultValue: false,
          input: false,  // Prevent clients from writing this field
          returned: true,
        },
      },
    },

    // CORS: trusts the canonical domain, the configured BETTER_AUTH_URL origin,
    // localhost for development, and any exact origins listed (comma separated)
    // in BETTER_AUTH_TRUSTED_ORIGINS (e.g. a staging URL).
    trustedOrigins: (request?: Request) => {
      if (!request) return [];

      const origin = request.headers.get('origin');
      if (!origin) return [];

      try {
        const originUrl = new URL(origin);
        const hostname = originUrl.hostname;

        // Trust the published Connection Pilot application origin.
        if (hostname === 'connectionpilot.net') {
          return [origin];
        }

        // Trust the configured public URL of this deployment.
        if (originUrl.origin === new URL(baseURL).origin) {
          return [origin];
        }

        // Trust localhost for development
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
          return [origin];
        }

        // Trust explicitly configured extra origins.
        if (extraTrustedOrigins().includes(originUrl.origin)) {
          return [origin];
        }

        return [];
      } catch {
        return [];
      }
    },

    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          fromName: 'Connection Pilot',
          to: user.email,
          subject: 'Reset your Connection Pilot password',
          text: `Reset your Connection Pilot password: ${url}`,
        });
      },
    },

    // socialProviders: {
    //   google: {
    //     clientId: getSecret('GOOGLE_CLIENT_ID') as string,
    //     clientSecret: getSecret('GOOGLE_CLIENT_SECRET') as string,
    //   },
    //   github: {
    //     clientId: getSecret('GITHUB_CLIENT_ID') as string,
    //     clientSecret: getSecret('GITHUB_CLIENT_SECRET') as string,
    //   },
    // },
  });

  _auth = auth as unknown as ReturnType<typeof betterAuth>;
  return auth;
}

export type Session = ReturnType<typeof getAuth>['$Infer']['Session'];
export type User = ReturnType<typeof getAuth>['$Infer']['Session']['user'];
