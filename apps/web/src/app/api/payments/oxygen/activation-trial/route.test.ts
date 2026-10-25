import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  limit: vi.fn(),
  connect: vi.fn(),
  read: vi.fn(),
  run: vi.fn(),
  worker: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: m.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: m.csrf }));
vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: m.limit,
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: m.connect,
}));
vi.mock('@/lib/payments/oxygen/activation-trial', () => ({
  readOxygenActivationTrial: m.read,
  runOxygenActivationTrial: m.run,
}));

import { GET, POST } from './route';

const request = (reference = '438f96ee-37c4-49bb-a56c-51451f9cb624') =>
  new NextRequest('http://local/api/payments/oxygen/activation-trial', {
    method: 'POST',
    body: JSON.stringify({ reference }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({
    user: { id: 'customer' },
    supabase: { rpc: vi.fn() },
  });
  m.csrf.mockResolvedValue({ valid: true });
  m.limit.mockResolvedValue(true);
  m.worker.mockResolvedValue({ rpc: vi.fn() });
  m.connect.mockReturnValue({
    worker: m.worker,
    activationTrialRequest: vi.fn(),
  });
  m.read.mockResolvedValue({ status: 'ready', result: {} });
});
it('authenticates and validates exact booking before worker or activation work', async () => {
  m.auth.mockResolvedValueOnce({ error: 'unauthorized' });
  expect((await POST(request())).status).toBe(401);
  expect((await POST(request('another-booking'))).status).toBe(400);
  expect(m.worker).not.toHaveBeenCalled();
  expect(m.run).not.toHaveBeenCalled();
});
it('enforces CSRF and rate limits', async () => {
  m.csrf.mockResolvedValueOnce({ valid: false });
  expect((await POST(request())).status).toBe(403);
  m.limit.mockResolvedValueOnce(false);
  expect((await POST(request())).status).toBe(429);
  expect(m.run).not.toHaveBeenCalled();
});
it('checks ownership before worker login and returns only stored status', async () => {
  m.read.mockRejectedValueOnce(new Error('not owner'));
  expect((await POST(request())).status).toBe(409);
  expect(m.worker).not.toHaveBeenCalled();
  expect((await POST(request())).status).toBe(200);
  expect(m.run).toHaveBeenCalledTimes(1);
  expect(
    (
      await GET(
        new NextRequest('http://local/api/payments/oxygen/activation-trial')
      )
    ).status
  ).toBe(200);
});
