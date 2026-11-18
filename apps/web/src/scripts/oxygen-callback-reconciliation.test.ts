import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('dotenv/config', () => ({}));
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
  });

  it('exits 0 immediately when OXYGEN_CALLBACK_DRAIN_ENABLED is not true', async () => {
    vi.stubEnv('OXYGEN_CALLBACK_DRAIN_ENABLED', 'false');
    await expect(runOxygenCallbackReconciliationCli()).resolves.toBe(0);
  });
});
