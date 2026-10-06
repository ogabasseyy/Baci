// @vitest-environment node
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { createRuntimeCompositionRlsFactory } from './runtime-composition-auth';

vi.mock('server-only', () => ({}));
const jwt = (payload: unknown) =>
  `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.synthetic`;
const publicKey = jwt({ role: 'anon' });
const url = 'http://127.0.0.1:55555';
const actorId = '90000000-0000-4000-8000-000000000001';

it('constructs a new actual SSR client per request and validates getUser through explicit synthetic transport', async () => {
  const fetchImplementation = vi.fn<typeof fetch>(async () =>
    Response.json({ id: actorId, aud: 'authenticated' })
  );
  const factory = createRuntimeCompositionRlsFactory(
    { url, publicKey, syntheticLoopback: true },
    { fetchImplementation }
  );
  const token = jwt({ sub: actorId, role: 'authenticated', exp: 4102444800 });
  const session = {
    access_token: token,
    refresh_token: 'synthetic-refresh',
    expires_at: 4102444800,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: actorId },
  };
  const cookie = `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
  const first = factory(
    new NextRequest('http://127.0.0.1:4181/csrf', { headers: { cookie } })
  );
  const second = factory(new NextRequest('http://127.0.0.1:4181/csrf'));
  expect(first.supabase).not.toBe(second.supabase);
  expect(fetchImplementation).not.toHaveBeenCalled();
  expect((await first.supabase.auth.getUser()).data.user?.id).toBe(actorId);
  expect(String(fetchImplementation.mock.calls[0][0])).toBe(
    `${url}/auth/v1/user`
  );
  expect((await second.supabase.auth.getUser()).data.user).toBeNull();
});

it('propagates refreshed session cookies without serializing tokens in the response body', async () => {
  const token = jwt({ sub: actorId, role: 'authenticated', exp: 4102444800 });
  const refreshed = {
    access_token: token,
    refresh_token: 'synthetic-refreshed',
    expires_at: 4102444800,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: actorId },
  };
  const fetchImplementation = vi.fn<typeof fetch>(async (input) =>
    Response.json(String(input).includes('/token') ? refreshed : refreshed.user)
  );
  const factory = createRuntimeCompositionRlsFactory(
    { url, publicKey, syntheticLoopback: true },
    { fetchImplementation }
  );
  const stale = {
    ...refreshed,
    access_token: jwt({ sub: actorId, role: 'authenticated', exp: 1 }),
    expires_at: 1,
  };
  const request = new NextRequest('http://127.0.0.1:4181/csrf', {
    headers: {
      cookie: `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(stale)).toString('base64url')}`,
    },
  });
  const context = factory(request);
  expect((await context.supabase.auth.getUser()).data.user?.id).toBe(actorId);
  const response = context.applyCookies(Response.json({ status: 'ok' }));
  expect(response.headers.getSetCookie().join(';')).toContain(
    'sb-127-auth-token='
  );
  expect(response.headers.getSetCookie().join(';')).toContain('HttpOnly');
  expect(await response.text()).toBe('{"status":"ok"}');
});

it('rejects privileged or ambient configuration before any transport', () => {
  for (const configuration of [
    undefined,
    { url, publicKey: jwt({ role: 'service_role' }) },
    { url, publicKey: 'sb_secret_private' },
    { url, publicKey, serviceRole: true },
  ])
    expect(() => createRuntimeCompositionRlsFactory(configuration)).toThrow(
      'Local savings authentication unavailable'
    );
});
