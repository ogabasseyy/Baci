import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

import { GET } from './route';

describe('Oxygen bank-list refresh task', () => {
  it('schedules recovery again shortly after an abandoned lock can expire', () => {
    const appConfig = resolve(process.cwd(), '../../vercel.json');
    const config = JSON.parse(
      readFileSync(
        existsSync(appConfig)
          ? appConfig
          : resolve(process.cwd(), 'vercel.json'),
        'utf8'
      )
    );
    const job = config.crons.find((entry: { path: string }) =>
      entry.path.endsWith('?task=ensure-banks')
    );
    expect(job?.schedule).toBe('*/10 * * * *');
  });
  const refreshRequest = (authorization?: string) =>
    new Request(
      'https://example.test/api/cron/oxygen-callback-reconciliation?task=refresh-banks',
      { headers: authorization ? { authorization } : {} }
    );

  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'secret');
    vi.stubEnv('OXYGEN_CALLBACK_DRAIN_ENABLED', 'false');
    mocks.connect.mockReset().mockReturnValue({
      provider: { environment: 'production' },
    });
    mocks.reconcile.mockReset();
    mocks.configuration.mockReset().mockReturnValue({
      environment: 'production',
      reference: 'partner',
    });
    mocks.getRedis.mockReset().mockReturnValue({
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    });
    mocks.readBanks.mockReset();
    mocks.refreshBanks
      .mockReset()
      .mockResolvedValue([{ name: 'Access Bank', code: '044' }]);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('refreshes the configured provider environment outside the drain gate', async () => {
    const response = await GET(refreshRequest('Bearer secret'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ count: 1 });
    expect(mocks.refreshBanks).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ set: expect.any(Function) }),
      { environment: 'production' },
      'production',
      'partner'
    );
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('recovers a missing bank cache without calling Oxygen when the cache is valid', async () => {
    const ensure = new Request(
      'https://example.test/api/cron/oxygen-callback-reconciliation?task=ensure-banks',
      { headers: { authorization: 'Bearer secret' } }
    );
    const cache = {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    };
    mocks.getRedis.mockReturnValue(cache);
    mocks.readBanks.mockResolvedValueOnce([
      { name: 'Access Bank', code: '044' },
    ]);
    expect(await (await GET(ensure)).json()).toEqual({ status: 'available' });
    expect(mocks.connect).not.toHaveBeenCalled();
    mocks.readBanks.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    expect((await GET(ensure)).status).toBe(200);
    expect(cache.set).toHaveBeenCalledWith(
      expect.stringMatching(/^oxygen:supported-banks-recovery:production:/),
      expect.any(String),
      { nx: true, ex: 330 }
    );
    expect(mocks.refreshBanks).toHaveBeenCalledOnce();
  });

  it('returns 503 when the cache read or lock operation fails', async () => {
    const ensure = new Request(
      'https://example.test/api/cron/oxygen-callback-reconciliation?task=ensure-banks',
      { headers: { authorization: 'Bearer secret' } }
    );
    mocks.readBanks.mockRejectedValueOnce(new Error('redis down'));
    expect((await GET(ensure)).status).toBe(503);
    mocks.readBanks.mockResolvedValueOnce(null);
    mocks.getRedis.mockReturnValueOnce({
      set: vi.fn().mockRejectedValue(new Error('redis down')),
    });
    expect((await GET(ensure)).status).toBe(503);
    expect(mocks.refreshBanks).not.toHaveBeenCalled();
  });

  it('releases only its own lock after a failed provider refresh', async () => {
    const ensure = new Request(
      'https://example.test/api/cron/oxygen-callback-reconciliation?task=ensure-banks',
      { headers: { authorization: 'Bearer secret' } }
    );
    const cache = {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    };
    mocks.getRedis.mockReturnValue(cache);
    mocks.readBanks.mockResolvedValue(null);
    mocks.refreshBanks.mockRejectedValueOnce(new Error('provider down'));
    expect((await GET(ensure)).status).toBe(503);
    const [key, token] = cache.set.mock.calls[0];
    expect(cache.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('get', KEYS[1]) == ARGV[1]"),
      [key],
      [token]
    );
    expect((await GET(ensure)).status).toBe(200);
  });

  it('rejects unauthenticated cache recovery before inspecting Redis', async () => {
    const request = new Request(
      'https://example.test/api/cron/oxygen-callback-reconciliation?task=ensure-banks'
    );
    expect((await GET(request)).status).toBe(401);
    expect(mocks.getRedis).not.toHaveBeenCalled();
    expect(mocks.refreshBanks).not.toHaveBeenCalled();
  });

  it('logs a failed lock release without exposing Redis details', async () => {
    const ensure = new Request(
      'https://example.test/api/cron/oxygen-callback-reconciliation?task=ensure-banks',
      { headers: { authorization: 'Bearer secret' } }
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getRedis.mockReturnValue({
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockRejectedValue(new Error('private redis detail')),
    });
    mocks.readBanks.mockResolvedValue(null);
    expect((await GET(ensure)).status).toBe(200);
    expect(log).toHaveBeenCalledWith(
      'Oxygen supported-bank recovery lock release failed'
    );
    log.mockRestore();
  });

  it('does not run concurrent recovery when another worker holds the lock', async () => {
    const ensure = new Request(
      'https://example.test/api/cron/oxygen-callback-reconciliation?task=ensure-banks',
      { headers: { authorization: 'Bearer secret' } }
    );
    mocks.getRedis.mockReturnValue({ set: vi.fn().mockResolvedValue(null) });
    mocks.readBanks.mockResolvedValue(null);
    const response = await GET(ensure);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'recovery_in_progress' });
    expect(response.headers.get('Retry-After')).toBe('330');
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.refreshBanks).not.toHaveBeenCalled();
  });

  it('does not start a weekly refresh while recovery holds the shared lock', async () => {
    mocks.getRedis.mockReturnValue({ set: vi.fn().mockResolvedValue(null) });
    const response = await GET(refreshRequest('Bearer secret'));
    expect(response.status).toBe(202);
    expect(mocks.refreshBanks).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated refresh before touching the provider', async () => {
    expect((await GET(refreshRequest())).status).toBe(401);
    expect(mocks.refreshBanks).not.toHaveBeenCalled();
  });

  it('refuses an environment mismatch without calling the provider', async () => {
    mocks.connect.mockReturnValue({ provider: { environment: 'staging' } });

    expect((await GET(refreshRequest('Bearer secret'))).status).toBe(503);
    expect(mocks.refreshBanks).not.toHaveBeenCalled();
  });

  it('keeps the last good cache when the provider refresh fails', async () => {
    mocks.refreshBanks.mockRejectedValue(new Error('private provider detail'));

    const response = await GET(refreshRequest('Bearer secret'));

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private provider detail');
  });
});
