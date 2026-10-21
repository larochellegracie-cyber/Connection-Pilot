import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailNotConfiguredError, emailFailure, sendEmail, sendEmailOrThrow } from './email';

const originalEnv = { ...process.env };

describe('sendEmail', () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('prints to the terminal instead of sending when no API key is set', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendEmail({ to: 'a@example.com', subject: 'Hello', text: 'Body text', fromName: 'Test Co' });

    expect(result.messageId).toMatch(/^local-/);
    expect(result.delivered).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    const printed = String(info.mock.calls[0]?.[0]);
    expect(printed).toContain('Subject:    Hello');
    expect(printed).toContain('"Test Co" <noreply@connectionpilot.net>');
    expect(printed).toContain('Body text');
  });

  it('refuses to fake-send in production when no API key is set', async () => {
    process.env.NODE_ENV = 'production';
    await expect(sendEmail({ to: 'a@example.com', subject: 'Hi', text: 'x' })).rejects.toThrow(/RESEND_API_KEY/);
  });

  it('posts to Resend with the expected payload when an API key is set', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'hello@connectionpilot.net';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendEmail({
      to: ['a@example.com'],
      subject: 'Quote',
      html: '<p>Hi</p>',
      replyTo: 'owner@example.com',
      fromName: 'Bad "Name"\r\nBcc: x@y.z',
      attachments: [{ filename: 'a.txt', content: Buffer.from('hi'), contentType: 'text/plain' }],
    });

    expect(result).toEqual({ messageId: 'msg_123', delivered: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_test_key');
    const sent = JSON.parse(String(init.body));
    expect(sent.from).not.toMatch(/[\r\n]/);
    expect(sent.from).toMatch(/<hello@connectionpilot\.net>$/);
    expect(sent.reply_to).toBe('owner@example.com');
    expect(sent.attachments).toEqual([{ filename: 'a.txt', content: 'aGk=', content_type: 'text/plain' }]);
  });

  it('throws a readable error when Resend rejects the message', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'domain not verified' }), { status: 403 })));
    await expect(sendEmail({ to: 'a@example.com', subject: 'Hi', text: 'x' })).rejects.toThrow(/domain not verified/);
  });

  it('requires a recipient and a body', async () => {
    await expect(sendEmail({ to: [], subject: 'Hi', text: 'x' })).rejects.toThrow(/recipient/);
    await expect(sendEmail({ to: 'a@example.com', subject: 'Hi' })).rejects.toThrow(/body/);
  });

  it('sendEmailOrThrow refuses to report a printed-only message as sent', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await expect(sendEmailOrThrow({ to: 'a@example.com', subject: 'Hi', text: 'x' })).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });

  it('sendEmailOrThrow returns the provider result when Resend accepts the message', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'msg_9' }), { status: 200 })));
    await expect(sendEmailOrThrow({ to: 'a@example.com', subject: 'Hi', text: 'x' })).resolves.toEqual({ messageId: 'msg_9', delivered: true });
  });

  it('turns failures into clear messages for the owner without leaking the key', () => {
    expect(emailFailure(new EmailNotConfiguredError())).toMatchObject({ status: 503, setupRequired: true });
    expect(emailFailure(new EmailNotConfiguredError()).error).toMatch(/isn’t set up yet.*nothing was sent/);
    const rejected = emailFailure(new Error('email send failed: domain not verified'));
    expect(rejected).toEqual({ status: 502, error: 'The email service could not send this message: domain not verified' });
    expect(emailFailure('weird').status).toBe(502);
  });
});
