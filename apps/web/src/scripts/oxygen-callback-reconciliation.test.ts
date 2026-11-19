import { afterEach, describe, expect, it, vi } from 'vitest';
import { runOxygenEligibilityBackground } from '@/lib/payments/oxygen/background-eligibility';
import { readOxygenCallbackBacklog } from '@/lib/payments/oxygen/runtime-callback-backlog';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { reconcileOxygenCallbacks } from '@/lib/payments/oxygen/runtime-reconciliation';

vi.mock('dotenv/config', () => ({}));
vi.mock('@/lib/payments/oxygen/background-eligibility', () => ({
  runOxygenEligibilityBackground: vi.fn(),
}));
vi.mock('@/lib/payments/oxygen/runtime-callback-backlog', () => ({
  readOxygenCallbackBacklog: vi.fn(),
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: vi.fn(),
}));
vi.mock('@/lib/payments/oxygen/runtime-reconciliation', () => ({
  reconcileOxygenCallbacks: vi.fn(),
}));

import { runOxygenCallbackReconciliationCli } from './oxygen-callback-reconciliation';

describe('oxygen-callback-reconciliation CLI', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('exits 0 immediately when both workers are disabled', async () => {
    vi.stubEnv('OXYGEN_CALLBACK_DRAIN_ENABLED', 'false');
    vi.stubEnv('OXYGEN_ELIGIBILITY_BACKGROUND_ENABLED', 'false');
    await expect(runOxygenCallbackReconciliationCli()).resolves.toBe(0);
  });

  it('drains callbacks but exits nonzero after an eligibility worker failure', async () => {
    vi.stubEnv('OXYGEN_CALLBACK_DRAIN_ENABLED', 'true');
    vi.stubEnv('OXYGEN_ELIGIBILITY_BACKGROUND_ENABLED', 'true');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(connectOxygenRuntime).mockReturnValue({
      worker: vi.fn().mockResolvedValue({ rpc: vi.fn() }),
      partnerReference: 'test-partner',
    } as NonNullable<ReturnType<typeof connectOxygenRuntime>>);
    vi.mocked(runOxygenEligibilityBackground).mockRejectedValueOnce(
      new Error('eligibility worker unavailable')
    );
    vi.mocked(readOxygenCallbackBacklog).mockResolvedValue({
      oldestAgeSeconds: null,
      pendingCount: 0,
      capped: false,
    });

    const exitCode = await runOxygenCallbackReconciliationCli();

    expect(reconcileOxygenCallbacks).toHaveBeenCalledOnce();
    expect(exitCode).toBe(1);
  });
});
