import { expect, it, vi } from 'vitest';
import { runGiglTrackingCli } from './process-gigl-tracking';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ rpc: vi.fn() })),
  runMonitorBatch: vi.fn(),
  createCache: vi.fn(),
  runWithCache: vi.fn(),
}));
vi.mock('@/app/api/cron/gigl-tracking/run-gigl-tracking-monitor-batch', () => ({
  runGiglTrackingMonitorBatch: mocks.runMonitorBatch,
}));
vi.mock('@/lib/gigl-tracking-worker-client', () => ({
  createGiglTrackingWorkerClient: mocks.createClient,
}));
vi.mock('@/lib/shipping/providers/gigl-tracking-token-cache', () => ({
  createGiglTrackingTokenCache: mocks.createCache,
}));
vi.mock('@/lib/shipping/providers/gigl-tracking-cache-runner', () => ({
  runWithGiglTrackingTokenCache: mocks.runWithCache,
}));

it('uses the private token cache for the scoped VPS poller', async () => {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    GIGL_BASE_URL: 'https://gigl.example.com',
    GIGL_EMAIL: 'worker@example.com',
    GIGL_PASSWORD: 'provider-password',
    GIGL_TRACKING_WORKER_TOKEN: 'header.payload.signature',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    NEXT_PUBLIC_SUPABASE_URL: 'https://projectref.supabase.co',
    HOME: '/home/worker',
    BACI_WORKER_PROFILE: 'gigl-tracking',
  };
  const cache = { load: vi.fn(), save: vi.fn(), clear: vi.fn() };
  mocks.createCache.mockReturnValue(cache);
  mocks.runWithCache.mockImplementation(async ({ run }) =>
    run({ trackShipments: vi.fn() })
  );
  mocks.runMonitorBatch.mockResolvedValue({
    ok: true,
    summary: { applied: 0, claimed: 0, failed: 0, paused: 0, success: true },
  });
  await expect(
    runGiglTrackingCli({ env, logger: { error: vi.fn(), info: vi.fn() } })
  ).resolves.toBe(0);
  expect(mocks.createCache).toHaveBeenCalledWith({
    directory: '/home/worker/baci-workers/gigl-tracking-token-cache',
    credentials: {
      baseUrl: env.GIGL_BASE_URL,
      email: env.GIGL_EMAIL,
      password: env.GIGL_PASSWORD,
    },
  });
  expect(mocks.runWithCache).toHaveBeenCalledWith(expect.objectContaining({ cache }));
  expect(mocks.runMonitorBatch).toHaveBeenCalledWith(
    expect.objectContaining({ processMonitors: expect.any(Function) })
  );
});
