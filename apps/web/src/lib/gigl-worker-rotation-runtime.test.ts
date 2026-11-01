import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rotatedClient, rotate, batch } = vi.hoisted(() => ({
  rotatedClient: { rpc: vi.fn() },
  rotate: vi.fn(),
  batch: vi.fn(),
}));
vi.mock('@/lib/gigl-worker-rotation-client', () => ({
  createRotatingGiglWorkerClient: rotate,
}));
vi.mock('@/lib/gigl-tracking-worker-client', () => ({
  createGiglTrackingWorkerClient: () => {
    throw new Error('unrotated client used');
  },
}));
vi.mock('@/lib/shipping/providers/gigl.constants', () => ({
  isGiglRuntimeConfigured: () => true,
}));
vi.mock('@/app/api/cron/gigl-tracking/run-gigl-tracking-monitor-batch', () => ({
  runGiglTrackingMonitorBatch: batch,
}));

import { GET } from '@/app/api/cron/gigl-tracking/route';
import { runGiglTrackingCli } from '@/scripts/process-gigl-tracking';

describe('GIGL rotation runtime integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'rotation-test-secret');
    rotate.mockResolvedValue(rotatedClient);
    batch.mockResolvedValue({
      ok: true,
      summary: { applied: 0, claimed: 0, failed: 0, paused: 0, success: true },
    });
  });

  it('selects the credential before the fallback route claims work', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/cron/gigl-tracking', {
        headers: { Authorization: 'Bearer rotation-test-secret' },
      })
    );
    expect(response.status).toBe(200);
    expect(rotate).toHaveBeenCalledWith(process.env);
    expect(batch).toHaveBeenCalledWith(
      expect.objectContaining({ client: rotatedClient })
    );
  });

  it('does not claim work when selection cannot verify a credential', async () => {
    rotate.mockRejectedValue(new Error('fixture credential must not leak'));
    const response = await GET(
      new NextRequest('http://localhost/api/cron/gigl-tracking', {
        headers: { Authorization: 'Bearer rotation-test-secret' },
      })
    );
    expect(response.status).toBe(500);
    expect(batch).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(
      'fixture credential'
    );
  });

  it('selects the credential before the VPS poller claims work', async () => {
    const env = {
      GIGL_BASE_URL: 'https://gigl.example',
      GIGL_EMAIL: 'worker@example.com',
      GIGL_PASSWORD: 'fixture',
      GIGL_TRACKING_WORKER_TOKEN: 'primary',
      GIGL_TRACKING_WORKER_TOKEN_SECONDARY: 'secondary',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture',
      NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.example',
    };
    const logger = { error: vi.fn(), info: vi.fn() };
    expect(await runGiglTrackingCli({ env, logger })).toBe(0);
    expect(rotate).toHaveBeenCalledWith(env);
    expect(batch).toHaveBeenCalledWith(
      expect.objectContaining({ client: rotatedClient })
    );
  });
});
