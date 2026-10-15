import { describe, expect, it, vi } from 'vitest';

import { buildClearCookieHeaders, tryClearStaleSession } from './session-cookies';

describe('buildClearCookieHeaders', () => {
  it('returns nothing without a cookie header', () => {
    expect(buildClearCookieHeaders(undefined)).toEqual([]);
  });

  it('expires only BetterAuth cookies, first-party (SameSite=Lax; Secure)', () => {
    const headers = buildClearCookieHeaders('theme=dark; __Secure-better-auth.session_token=abc; other=1');
    expect(headers).toHaveLength(1);
    expect(headers[0]).toContain('__Secure-better-auth.session_token=;');
    expect(headers[0]).toContain('SameSite=Lax');
    expect(headers[0]).toContain('Secure');
    expect(headers[0]).not.toContain('SameSite=None');
    expect(headers[0]).not.toContain('Partitioned');
  });
});

describe('tryClearStaleSession', () => {
  it('ignores requests without ?clearCookies=1', () => {
    const res = { setHeader: vi.fn(), status: vi.fn() };
    expect(tryClearStaleSession({ query: {}, headers: {} }, res)).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('clears cookies and answers 200 for ?clearCookies=1', () => {
    const json = vi.fn();
    const res = { setHeader: vi.fn(), status: vi.fn().mockReturnValue({ json }) };
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const handled = tryClearStaleSession(
      { query: { clearCookies: '1' }, headers: { cookie: 'better-auth.session_token=abc' } },
      res,
    );
    info.mockRestore();
    expect(handled).toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith('set-cookie', [expect.stringContaining('better-auth.session_token=;')]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ cleared: true });
  });
});
