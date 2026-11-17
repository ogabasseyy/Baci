import { describe, expect, it, vi } from 'vitest';

const mockRpc = vi.fn();

vi.mock('dotenv/config', () => ({}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/posthog/merchant-signup-health-telemetry', () => ({
  recordMerchantSignupHealthTelemetry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => ({ rpc: mockRpc }),
}));

import { runMerchantSignupHealthCli } from './merchant-signup-health';

describe('merchant-signup-health CLI', () => {
  it('returns 1 when RPC returns an error and 0 when healthy', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'err' } });
    await expect(runMerchantSignupHealthCli()).resolves.toBe(1);

    mockRpc.mockResolvedValueOnce({
      data: {
        trigger_exists: true,
        trigger_enabled: true,
        search_path_pinned: true,
      },
      error: null,
    });
    await expect(runMerchantSignupHealthCli()).resolves.toBe(0);
  });
});
