import { describe, expect, it, vi } from 'vitest';
import { runGiglTrackingCli } from './process-gigl-tracking';

const { mockCreateClient, mockRunMonitorBatch } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(() => ({ rpc: vi.fn() })),
  mockRunMonitorBatch: vi.fn(),
}));

vi.mock('@/app/api/cron/gigl-tracking/run-gigl-tracking-monitor-batch', () => ({
  runGiglTrackingMonitorBatch: mockRunMonitorBatch,
}));
vi.mock('@/lib/gigl-tracking-worker-client', () => ({
  createGiglTrackingWorkerClient: mockCreateClient,
}));

const configuredEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  GIGL_BASE_URL: 'https://gigl.example.com',
  GIGL_EMAIL: 'worker@example.com',
  GIGL_PASSWORD: 'provider-password',
  GIGL_TRACKING_WORKER_TOKEN: 'header.payload.signature',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  NEXT_PUBLIC_SUPABASE_URL: 'https://projectref.supabase.co',
};

describe('process-gigl-tracking', () => {
  it('runs the monitor batch directly and logs only bounded counts', async () => {
    const runBatch = vi.fn().mockResolvedValue({
      ok: true,
      summary: {
        applied: 2,
        claimed: 3,
        failed: 1,
        paused: 0,
        providerPayload: 'must-not-be-logged',
        success: true,
      },
    });
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCli({ env: configuredEnv, logger, runBatch })
    ).resolves.toBe(0);

    expect(runBatch).toHaveBeenCalledWith({ batchSize: 25 });
    expect(logger.info).toHaveBeenCalledWith(
      '[gigl-tracking] completed',
      JSON.stringify({
        applied: 2,
        claimed: 3,
        failed: 1,
        paused: 0,
        success: true,
      })
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(
      'must-not-be-logged'
    );
  });

  it('fails closed before work when a provider variable is missing', async () => {
    const runBatch = vi.fn();
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCli({
        env: { ...configuredEnv, GIGL_BASE_URL: '' },
        logger,
        runBatch,
      })
    ).resolves.toBe(1);

    expect(runBatch).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[gigl-tracking] preflight failed'
    );
  });

  it.each([
    'http://gigl.example.com',
    'https://user@gigl.example.com',
    'https://user:pass@gigl.example.com',
  ])('rejects unsafe provider URLs without running the batch: %s', async (url) => {
    const runBatch = vi.fn();
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCli({
        env: { ...configuredEnv, GIGL_BASE_URL: url },
        logger,
        runBatch,
      })
    ).resolves.toBe(1);

    expect(runBatch).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[gigl-tracking] preflight failed'
    );
  });

  it('preserves the explicit GIGL disable switch without claiming work', async () => {
    const runBatch = vi.fn();
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCli({
        env: { ...configuredEnv, GIGL_ENABLED: 'false' },
        logger,
        runBatch,
      })
    ).resolves.toBe(0);

    expect(runBatch).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      '[gigl-tracking] completed',
      JSON.stringify({
        applied: 0,
        claimed: 0,
        failed: 0,
        paused: 0,
        success: true,
      })
    );
  });

  it('returns a failing exit code without exposing worker errors', async () => {
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCli({
        env: configuredEnv,
        logger,
        runBatch: vi
          .fn()
          .mockRejectedValue(new Error('provider credential leaked here')),
      })
    ).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith('[gigl-tracking] failed');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'provider credential leaked here'
    );
  });

  it('builds the default batch client from the validated environment', async () => {
    mockRunMonitorBatch.mockResolvedValue({
      ok: true,
      summary: {
        applied: 1,
        claimed: 1,
        failed: 0,
        paused: 0,
        success: true,
      },
    });
    const logger = { error: vi.fn(), info: vi.fn() };
    const originalToken = process.env.GIGL_TRACKING_WORKER_TOKEN;
    process.env.GIGL_TRACKING_WORKER_TOKEN = 'process-env-token';
    try {
      await expect(
        runGiglTrackingCli({ env: configuredEnv, logger })
      ).resolves.toBe(0);
    } finally {
      if (originalToken === undefined) {
        delete process.env.GIGL_TRACKING_WORKER_TOKEN;
      } else {
        process.env.GIGL_TRACKING_WORKER_TOKEN = originalToken;
      }
    }

    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        GIGL_TRACKING_WORKER_TOKEN: 'header.payload.signature',
      })
    );
  });

  it('fails the run when every claimed monitor failed', async () => {
    // A total provider outage surfaces as ok:true with
    // failed === claimed; exiting 0 would log "completed" and hide the
    // outage from the dead-man log check.
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCli({
        env: configuredEnv,
        logger,
        runBatch: vi.fn().mockResolvedValue({
          ok: true,
          summary: {
            applied: 0,
            claimed: 3,
            failed: 3,
            paused: 0,
            success: true,
          },
        }),
      })
    ).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith('[gigl-tracking] failed');
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('succeeds an empty batch with nothing claimed', async () => {
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCli({
        env: configuredEnv,
        logger,
        runBatch: vi.fn().mockResolvedValue({
          ok: true,
          summary: {
            applied: 0,
            claimed: 0,
            failed: 0,
            paused: 0,
            success: true,
          },
        }),
      })
    ).resolves.toBe(0);

    expect(logger.info).toHaveBeenCalledWith(
      '[gigl-tracking] completed',
      expect.any(String)
    );
  });

  it('fails generically when the monitor batch returns a bounded failure', async () => {
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      runGiglTrackingCli({
        env: configuredEnv,
        logger,
        runBatch: vi.fn().mockResolvedValue({
          ok: false,
          reason: 'claim_failed',
        }),
      })
    ).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith('[gigl-tracking] failed');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'claim_failed'
    );
  });

  it('keeps the terminal failure message when the default console logger is suppressed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(
        runGiglTrackingCli({
          env: configuredEnv,
          runBatch: vi.fn().mockRejectedValue(new Error('provider failure')),
        })
      ).resolves.toBe(1);

      expect(error).toHaveBeenCalledWith('[gigl-tracking] failed');
    } finally {
      error.mockRestore();
    }
  });
});
