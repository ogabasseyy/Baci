import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const state = vi.hoisted(() => ({
  csrf: true,
  user: true,
  linking: true,
  storage: true,
  handler: vi.fn().mockResolvedValue(new Response('approved')),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: async () => ({ valid: state.csrf }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.user ? { id: 'owner' } : null },
        error: null,
      }),
    },
  }),
}));
vi.mock('@/config/builder-linking', () => ({
  get BUILDER_ACCOUNT_LINKING_ENABLED() {
    return state.linking;
  },
}));
vi.mock('@/config/builder-private-storage', () => ({
  get BUILDER_PRIVATE_STORAGE_ENABLED() {
    return state.storage;
  },
}));
vi.mock('@/lib/website-builder/publication-runtime', () => ({
  getOwnerPublicationRuntime: () => state.handler,
}));
afterEach(() => {
  state.csrf = true;
  state.user = true;
  state.linking = true;
  state.storage = true;
  state.handler.mockClear();
});
it('fails closed for either disabled release flag and keeps responses private', async () => {
  for (const flag of ['linking', 'storage'] as const) {
    state[flag] = false;
    const r = await POST(
      new NextRequest('https://usebaci.com/api/builder-publication')
    );
    expect(r.status).toBe(503);
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
    state[flag] = true;
  }
  expect(state.handler).not.toHaveBeenCalled();
});
it('delegates GET and only a validated POST body', async () => {
  const req = new NextRequest('https://usebaci.com/api/builder-publication');
  const body = {
    action: 'confirm',
    intentId: '10000000-0000-4000-8000-000000000001',
  };
  await GET(req);
  await POST(
    new NextRequest(req.url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
  );
  expect(state.handler).toHaveBeenNthCalledWith(1, req);
  const forwarded = state.handler.mock.calls[1][0] as Request;
  expect(await forwarded.json()).toEqual(body);
});
it('blocks CSRF, malformed, invalid and oversized bodies before delegation', async () => {
  const req = (body: string) =>
    new NextRequest('https://usebaci.com/api/builder-publication', {
      method: 'POST',
      body,
    });
  state.csrf = false;
  expect((await POST(req('{}'))).status).toBe(403);
  state.csrf = true;
  for (const body of [
    '{',
    '{}',
    JSON.stringify({ action: 'confirm', intentId: 'invalid' }),
  ])
    expect((await POST(req(body))).status).toBe(400);
  expect((await POST(req('x'.repeat(4097)))).status).toBe(413);
  expect(state.handler).not.toHaveBeenCalled();
});
it('rejects signed-out callers before the runtime handler', async () => {
  state.user = false;
  const r = await GET(
    new NextRequest('https://usebaci.com/api/builder-publication')
  );
  expect(r.status).toBe(401);
  expect(state.handler).not.toHaveBeenCalled();
});
