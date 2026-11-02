import { spawnSync } from 'node:child_process';
import { beforeEach, expect, it, vi } from 'vitest';
import { runGiglTrackingCli } from './process-gigl-tracking';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ rpc: vi.fn() })),
  runMonitorBatch: vi.fn(),
  createCache: vi.fn(),
  runWithCache: vi.fn(),
  hasLock: vi.fn(() => true),
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
vi.mock('@/lib/shipping/providers/gigl-cache-lock-verification', () => ({
  hasVerifiedGiglCacheLock: mocks.hasLock,
}));
vi.mock('@/lib/shipping/providers/gigl.constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shipping/providers/gigl.constants')>()),
  GIGL_BASE_URL: 'https://actual-provider.example.com',
  GIGL_EMAIL: 'actual-provider@example.com',
  GIGL_PASSWORD: 'actual-provider-password',
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasLock.mockReturnValue(true);
});

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
    isLocked: expect.any(Function),
    credentials: {
      baseUrl: 'https://actual-provider.example.com',
      email: 'actual-provider@example.com',
      password: 'actual-provider-password',
    },
  });
  expect(mocks.runWithCache).toHaveBeenCalledWith(expect.objectContaining({ cache }));
  expect(mocks.runMonitorBatch).toHaveBeenCalledWith(
    expect.objectContaining({ processMonitors: expect.any(Function) })
  );
});

it('runs without cache when the inherited worker lock is not verified', async () => {
  mocks.hasLock.mockReturnValue(false);
  mocks.runMonitorBatch.mockResolvedValue({ ok: true, summary: { applied: 0, claimed: 0, failed: 0, paused: 0, success: true } });
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test', GIGL_BASE_URL: 'https://gigl.example.com', GIGL_EMAIL: 'worker@example.com',
    GIGL_PASSWORD: 'provider-password', GIGL_TRACKING_WORKER_TOKEN: 'header.payload.signature',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key', NEXT_PUBLIC_SUPABASE_URL: 'https://projectref.supabase.co',
    HOME: '/home/worker', BACI_WORKER_PROFILE: 'gigl-tracking',
  };
  await expect(runGiglTrackingCli({ env, logger: { error: vi.fn(), info: vi.fn() } })).resolves.toBe(0);
  expect(mocks.createCache).not.toHaveBeenCalled();
  expect(mocks.runWithCache).not.toHaveBeenCalled();
  expect(mocks.runMonitorBatch).toHaveBeenCalledOnce();
});

it('does not share the cache between overlapping runs in one process', async () => {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test', GIGL_BASE_URL: 'https://gigl.example.com', GIGL_EMAIL: 'worker@example.com',
    GIGL_PASSWORD: 'provider-password', GIGL_TRACKING_WORKER_TOKEN: 'header.payload.signature',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key', NEXT_PUBLIC_SUPABASE_URL: 'https://projectref.supabase.co',
    HOME: '/home/worker', BACI_WORKER_PROFILE: 'gigl-tracking',
  };
  const result = { ok: true, summary: { applied: 0, claimed: 0, failed: 0, paused: 0, success: true } };
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  mocks.createCache.mockReturnValue({ load: vi.fn(), save: vi.fn(), clear: vi.fn() });
  mocks.runMonitorBatch.mockResolvedValue(result);
  mocks.runWithCache.mockImplementation(async () => { entered(); await gate; return result; });
  const first = runGiglTrackingCli({ env, logger: { error: vi.fn(), info: vi.fn() } });
  try {
    await started;
    await expect(runGiglTrackingCli({ env, logger: { error: vi.fn(), info: vi.fn() } })).resolves.toBe(0);
    expect(mocks.runWithCache).toHaveBeenCalledOnce();
    expect(mocks.runMonitorBatch).toHaveBeenCalledOnce();
  } finally {
    release();
    await first;
  }
});

it('records the final status when the direct worker process exits', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--conditions', 'react-server', 'src/scripts/process-gigl-tracking.ts'], {
    encoding: 'utf8',
    env: { ...process.env, GIGL_ENABLED: 'false' },
    timeout: 30000,
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toMatch(/\[gigl-tracking\] Finished at .* \(exit 0\)/);
});
