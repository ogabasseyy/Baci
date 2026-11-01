import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: mocks.connect,
}));
vi.mock('@/lib/payments/oxygen/runtime-reconciliation', () => ({
  reconcileOxygenCallbacks: mocks.reconcile,
}));

import { GET } from './route';

const request = (authorization?: string) =>
  new Request('https://example.test/api/cron/oxygen-callback-reconciliation', {
    headers: authorization ? { authorization } : {},
  });

describe('Oxygen callback reconciliation cron', () => {
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
    const worker = { rpc: vi.fn() };
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
    expect((await GET(request('Bearer secret'))).status).toBe(200);
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
});
