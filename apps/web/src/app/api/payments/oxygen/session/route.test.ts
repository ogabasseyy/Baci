import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  csrf: vi.fn(),
  rate: vi.fn(),
  connect: vi.fn(),
  client: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: m.csrf }));
vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: m.rate,
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: m.connect,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: m.client }));

import { POST } from './route';

const request = (body: string) =>
  new NextRequest('https://checkout.test/api/payments/oxygen/session', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('VERCEL_ENV', 'preview');
  m.connect.mockReturnValue({});
  m.csrf.mockResolvedValue({ valid: true });
  m.rate.mockResolvedValue(true);
  m.client.mockResolvedValue({ auth: { signInWithPassword: m.signIn } });
});
afterEach(() => vi.unstubAllEnvs());
it('is unavailable in production before reading credentials or creating a client', async () => {
  vi.stubEnv('VERCEL_ENV', 'production');
  expect((await POST(request('{}'))).status).toBe(404);
  expect(m.client).not.toHaveBeenCalled();
  expect(m.connect).not.toHaveBeenCalled();
});
it('requires CSRF and rate limits before authentication', async () => {
  m.csrf.mockResolvedValue({ valid: false });
  expect((await POST(request('{}'))).status).toBe(403);
  expect(m.client).not.toHaveBeenCalled();
  m.csrf.mockResolvedValue({ valid: true });
  m.rate.mockResolvedValue(false);
  expect((await POST(request('{}'))).status).toBe(429);
  expect(m.client).not.toHaveBeenCalled();
});
it.each([
  '{',
  JSON.stringify({ email: 'not-email', password: 'test' }),
  'x'.repeat(9000),
])('rejects malformed or oversized credentials', async (body) => {
  expect((await POST(request(body))).status).toBe(400);
  expect(m.signIn).not.toHaveBeenCalled();
});
it('uses normal Auth and never returns the session token', async () => {
  m.signIn.mockResolvedValue({
    error: null,
    data: {
      user: { id: 'synthetic' },
      session: { access_token: 'private-token' },
    },
  });
  const r = await POST(
    request(
      JSON.stringify({
        email: 'customer@example.invalid',
        password: 'synthetic-password',
      })
    )
  );
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ authenticated: true });
  expect(m.signIn).toHaveBeenCalledWith({
    email: 'customer@example.invalid',
    password: 'synthetic-password',
  });
});
it('returns a safe error for invalid credentials', async () => {
  m.signIn.mockResolvedValue({
    error: { message: 'private provider detail' },
    data: { user: null },
  });
  const r = await POST(
    request(
      JSON.stringify({
        email: 'customer@example.invalid',
        password: 'incorrect',
      })
    )
  );
  expect(r.status).toBe(401);
  expect(await r.json()).toEqual({ error: 'Unable to sign in' });
});
