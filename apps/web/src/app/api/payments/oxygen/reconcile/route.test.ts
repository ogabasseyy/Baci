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
vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: mocks.limit,
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

it('fails closed before constructing runtime when rate limited, CSRF-invalid or unauthenticated', async () => {
  mocks.limit.mockResolvedValueOnce(false);
  expect((await POST(request())).status).toBe(429);
  mocks.csrf.mockResolvedValueOnce({ valid: false });
  expect((await POST(request())).status).toBe(403);
  mocks.auth.mockResolvedValueOnce({ error: 'unauthorized' });
  expect((await POST(request())).status).toBe(401);
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
