import { describe, expect, it } from 'vitest';

import { evaluate, isSet, REQUIRED } from './check-env';

const fullEnv = {
  MYSQLHOST: 'h', MYSQLUSER: 'u', MYSQLPASSWORD: 'p', MYSQLDATABASE: 'd',
  BETTER_AUTH_SECRET: 's', BETTER_AUTH_URL: 'https://example.com',
};

describe('check-env', () => {
  it('accepts either DB_* or Railway MYSQL* names', () => {
    expect(evaluate(fullEnv).missingRequired).toEqual([]);
    expect(evaluate({ ...fullEnv, MYSQLHOST: undefined, DB_HOST: 'h' }).missingRequired).toEqual([]);
  });

  it('reports each missing required setting by name', () => {
    const { missingRequired } = evaluate({ BETTER_AUTH_SECRET: 's' });
    expect(missingRequired.map((s) => s.names[0])).toEqual(['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME', 'BETTER_AUTH_URL']);
  });

  it('treats blank values as missing', () => {
    expect(isSet(REQUIRED[4], { BETTER_AUTH_SECRET: '   ' })).toBe(false);
  });

  it('lists feature keys separately from required ones', () => {
    const { missingRequired, missingFeatures } = evaluate(fullEnv);
    expect(missingRequired).toHaveLength(0);
    expect(missingFeatures.map((s) => s.names[0])).toContain('STRIPE_SECRET_KEY');
  });
});
