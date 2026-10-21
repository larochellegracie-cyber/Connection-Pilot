/**
 * A chainable stand-in for drizzle queries, for route tests. Each db.select(...) call
 * resolves to the next array queued in `state.queue`; updates and inserts are recorded.
 * Build it inside vi.mock with the object from vi.hoisted:
 *   const state = vi.hoisted(() => ({ queue: [] as unknown[][], updates: [] as unknown[], inserts: [] as unknown[] }));
 *   vi.mock('@/server/db/client.js', async () => ({ db: (await import('@/test/db-mock')).buildDb(state) }));
 */
export type DbMockState = { queue: unknown[][]; updates: unknown[]; inserts: unknown[]; deletes?: unknown[]; failWrites?: boolean };

function chain(result: unknown): unknown {
  const proxy: unknown = new Proxy({}, { get: (_target, prop) => (prop === 'then' ? (resolve: (value: unknown) => void) => resolve(result) : () => proxy) });
  return proxy;
}

export function buildDb(state: DbMockState) {
  return {
    select: () => chain(state.queue.shift() ?? []),
    update: () => ({ set: (values: unknown) => { if (state.failWrites) throw new Error('write failed'); state.updates.push(values); return chain([]); } }),
    insert: () => ({ values: (values: unknown) => { if (state.failWrites) throw new Error('write failed'); state.inserts.push(values); return chain([]); } }),
    delete: () => ({ where: () => { state.deletes?.push(true); return chain([]); } }),
    transaction: async (run: (tx: unknown) => unknown) => run(buildDb(state)),
  };
}
