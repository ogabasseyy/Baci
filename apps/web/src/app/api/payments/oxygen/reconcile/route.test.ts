import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  limit: vi.fn(),
  connect: vi.fn(),
  reconcile: vi.fn(),
  payment: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/rate-limit', () => ({
  getTrustedClientIdentifier: () => 'trusted-ip',
  checkOxygenProviderRateLimit: async (...args: unknown[]) => ({
    allowed: await mocks.limit(...args),
  }),
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: mocks.connect,
}));
vi.mock('@/lib/payments/oxygen/runtime-reconciliation', () => ({
  reconcileOxygenCallbacks: mocks.reconcile,
}));

import { POST } from './route';

const request = () =>
  new NextRequest('https://example.test/api/payments/oxygen/reconcile', {
    method: 'POST',
  });
const worker = { rpc: vi.fn() };
const provider = { call: vi.fn() };
const hosts = new Set(['example.test']);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('OXYGEN_CALLBACK_DRAIN_ENABLED', 'true');
  mocks.limit.mockResolvedValue(true);
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.auth.mockResolvedValue({ user: { id: 'worker' }, supabase: worker });
  mocks.connect.mockReturnValue({
    provider,
    hosts,
    partnerReference: 'partner',
    reconcilePaymentCallback: mocks.payment,
  });
  mocks.reconcile.mockResolvedValue(undefined);
});

it('does not drain callbacks when the drain is disabled', async () => {
  vi.stubEnv('OXYGEN_CALLBACK_DRAIN_ENABLED', 'false');
  expect((await POST(request())).status).toBe(503);
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(mocks.reconcile).not.toHaveBeenCalled();
});

it('fails closed before constructing runtime when rate limited, CSRF-invalid or unauthenticated', async () => {
  mocks.limit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect((await POST(request())).status).toBe(429);
  mocks.csrf.mockResolvedValueOnce({ valid: false });
  expect((await POST(request())).status).toBe(403);
  mocks.auth.mockResolvedValueOnce({ error: 'unauthorized' });
  expect((await POST(request())).status).toBe(401);
  expect(mocks.limit).toHaveBeenCalledWith('worker', 'reconcile', 10);
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(mocks.reconcile).not.toHaveBeenCalled();
});

it('passes only the authenticated worker and callback binding to the drain', async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  const [actualWorker, actualProvider, partner, actualHosts, payment] =
    mocks.reconcile.mock.calls[0];
  expect([actualWorker, actualProvider, partner, actualHosts]).toEqual([
    worker,
    provider,
    'partner',
    hosts,
  ]);
  await payment('workflow', 'callback', 'retry');
  expect(mocks.payment).toHaveBeenCalledExactlyOnceWith(
    worker,
    'workflow',
    'callback',
    'retry'
  );
});

it('returns safe errors when runtime is absent or a drain fails', async () => {
  mocks.connect.mockReturnValueOnce(null);
  expect((await POST(request())).status).toBe(503);
  mocks.reconcile.mockRejectedValueOnce(new Error('private provider data'));
  const response = await POST(request());
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain('private');
});

it('denies the IP budget after authentication before runtime construction', async () => {
  mocks.limit.mockResolvedValueOnce(false);
  expect((await POST(request())).status).toBe(429);
  expect(mocks.limit).toHaveBeenCalledExactlyOnceWith(
    'trusted-ip',
    'reconcile-ip',
    60
  );
  expect(mocks.auth).toHaveBeenCalledOnce();
  expect(mocks.connect).not.toHaveBeenCalled();
});

it('applies the IP budget even when authentication fails', async () => {
  mocks.auth.mockResolvedValueOnce({ error: 'unauthorized' });
  mocks.limit.mockResolvedValueOnce(false);
  expect((await POST(request())).status).toBe(429);
  expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.limit.mock.invocationCallOrder[0]
  );
  expect(mocks.limit).toHaveBeenCalledExactlyOnceWith(
    'trusted-ip',
    'reconcile-ip',
    60
  );
});
