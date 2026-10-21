import type { Request, Response } from 'express';

export type RouteResult = { status: number; body: Record<string, unknown> };

/**
 * Runs an existing API route handler on behalf of the signed-in owner, so Pilot reuses the real
 * validation, plan checks and business rules instead of duplicating them. The original request's
 * headers (the session cookie) are passed through; only the body is replaced.
 */
export async function callRoute(handler: (req: Request, res: Response) => unknown, original: Pick<Request, 'headers'>, body: Record<string, unknown>): Promise<RouteResult> {
  const result: RouteResult = { status: 200, body: {} };
  const res = {
    headersSent: false,
    status(code: number) { result.status = code; return res; },
    json(payload: Record<string, unknown>) { result.body = payload; return res; },
    setHeader() { return res; },
  } as unknown as Response;
  const req = { headers: original.headers, body, params: {}, query: {}, method: 'POST' } as unknown as Request;
  await handler(req, res);
  return result;
}

/** A route result counts as success for 2xx statuses. */
export const succeeded = (result: RouteResult) => result.status >= 200 && result.status < 300;
export const errorText = (result: RouteResult, fallback: string) => (typeof result.body.error === 'string' && result.body.error ? result.body.error : fallback);
