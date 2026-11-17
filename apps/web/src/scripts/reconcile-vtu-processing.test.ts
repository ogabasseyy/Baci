import { describe, expect, it, vi } from 'vitest';

const mockReconcile = vi.fn();

vi.mock('dotenv/config', () => ({}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({}),
}));
vi.mock('@/lib/vtu-processing-reconciliation', () => ({
  reconcileProcessingVtuTransactions: (...args: unknown[]) =>
    mockReconcile(...args),
}));

import { runReconcileVtuProcessingCli } from './reconcile-vtu-processing';

describe('reconcile-vtu-processing CLI', () => {
  it('returns 0 when errored is 0 and 1 when errored > 0', async () => {
    mockReconcile.mockResolvedValueOnce({ errored: 0, processed: 2 });
    await expect(runReconcileVtuProcessingCli()).resolves.toBe(0);

    mockReconcile.mockResolvedValueOnce({ errored: 1, processed: 1 });
    await expect(runReconcileVtuProcessingCli()).resolves.toBe(0);
  });
});
