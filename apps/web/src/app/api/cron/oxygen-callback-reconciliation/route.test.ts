import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  reconcile: vi.fn(),
  configuration: vi.fn(),
  refreshBanks: vi.fn(),
  readBanks: vi.fn(),
  getRedis: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: mocks.connect,
}));
vi.mock('@/lib/payments/oxygen/runtime-reconciliation', () => ({
  reconcileOxygenCallbacks: mocks.reconcile,
}));
vi.mock('@/lib/payments/oxygen/runtime-configuration', () => ({
  readOxygenRuntimeConfiguration: mocks.configuration,
}));
vi.mock('@/lib/payments/oxygen/supported-bank-cache', () => ({
  refreshSupportedBanks: mocks.refreshBanks,
  readSupportedBanks: mocks.readBanks,
}));
vi.mock('@/lib/redis', () => ({ getRedis: mocks.getRedis }));

import { OXYGEN_CALLBACK_DURATION_MS } from '@/lib/payments/oxygen/reconciliation-budget';
import { GET, maxDuration } from './route';

const request = (authorization?: string) =>
  new Request('https://example.test/api/cron/oxygen-callback-reconciliation', {
    headers: authorization ? { authorization } : {},
  });

describe('Oxygen callback reconciliation cron', () => {
  it('budgets one payment and activation sequence with storage headroom', () => {
    const providerBudgetSeconds = 3 * 2 * 30;
    expect(maxDuration).toBeGreaterThanOrEqual(providerBudgetSeconds + 60);
    expect(maxDuration * 1000).toBeGreaterThanOrEqual(
      OXYGEN_CALLBACK_DURATION_MS
    );
  });
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'secret');
    vi.stubEnv('OXYGEN_CALLBACK_DRAIN_ENABLED', 'true');
    mocks.connect.mockReset();
    mocks.reconcile.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('authenticates before constructing runtime, even when disabled or misconfigured', async () => {
    vi.stubEnv('OXYGEN_CALLBACK_DRAIN_ENABLED', 'false');
    expect((await GET(request('Bearer wrong'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(request('Bearer secret'))).status).toBe(401);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('defaults to disabled without constructing a runtime', async () => {
    vi.stubEnv('OXYGEN_CALLBACK_DRAIN_ENABLED', '');
    const response = await GET(request('Bearer secret'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('returns an unavailable response when runtime or worker fails', async () => {
    mocks.connect.mockReturnValueOnce(null);
    expect((await GET(request('Bearer secret'))).status).toBe(503);
    mocks.connect.mockReturnValueOnce({
      worker: vi.fn().mockRejectedValue(new Error('private')),
    });
    const response = await GET(request('Bearer secret'));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private');
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('drains once with the restricted worker and gated payment recovery', async () => {
    const worker = {
      rpc: vi.fn().mockResolvedValue({
        error: null,
        data: { pendingCount: 2, capped: false, oldestAgeSeconds: 120 },
      }),
    };
    const provider = { call: vi.fn() };
    const hosts = new Set(['example.test']);
    const payment = vi.fn().mockResolvedValue(undefined);
    mocks.connect.mockReturnValue({
      worker: vi.fn().mockResolvedValue(worker),
      provider,
      hosts,
      partnerReference: 'partner',
      reconcilePaymentCallback: payment,
    });
    const response = await GET(request('Bearer secret'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      enabled: true,
      backlog: { pendingCount: 2, capped: false, oldestAgeSeconds: 120 },
    });
    expect(worker.rpc).toHaveBeenCalledExactlyOnceWith('oxygen_callback', {
      p_operation: 'backlog',
      p_partner: 'partner',
      p_payload: {},
    });
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    const [actualWorker, actualProvider, partner, actualHosts, check, filter] =
      mocks.reconcile.mock.calls[0];
    expect([
      actualWorker,
      actualProvider,
      partner,
      actualHosts,
      filter,
    ]).toEqual([worker, provider, 'partner', hosts, undefined]);
    await check('workflow', 'callback', 'retry');
    expect(payment).toHaveBeenCalledExactlyOnceWith(
      worker,
      'workflow',
      'callback',
      'retry'
    );
    payment.mockRejectedValueOnce(new Error('unconfirmed'));
    await expect(check('workflow', 'callback', 'retry')).rejects.toThrow();
  });

  it('returns failure for an unsuccessful drain without leaking errors', async () => {
    mocks.connect.mockReturnValue({ worker: vi.fn().mockResolvedValue({}) });
    mocks.reconcile.mockRejectedValue(new Error('private'));
    const response = await GET(request('Bearer secret'));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private');
  });

  it('signals an aged callback backlog to the scheduler without exposing callback data', async () => {
    const worker = {
      rpc: vi.fn().mockResolvedValue({
        error: null,
        data: { pendingCount: 3, capped: false, oldestAgeSeconds: 900 },
      }),
    };
    mocks.connect.mockReturnValue({
      worker: vi.fn().mockResolvedValue(worker),
      provider: {},
      hosts: new Set(),
      partnerReference: 'partner',
      reconcilePaymentCallback: vi.fn(),
    });
    const response = await GET(request('Bearer secret'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Callback backlog requires attention',
      code: 'oxygen_callback_backlog',
    });
  });
});
