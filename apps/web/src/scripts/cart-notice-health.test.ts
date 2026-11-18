import { describe, expect, it, vi } from 'vitest';

const mockRpc = vi.fn();

vi.mock('dotenv/config', () => ({}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => ({ rpc: mockRpc }),
}));

import { runCartNoticeHealthCli } from './cart-notice-health';

describe('cart-notice-health CLI', () => {
  it('returns 1 when RPC fails and 0 when payload is healthy', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(runCartNoticeHealthCli()).resolves.toBe(1);

    mockRpc.mockResolvedValueOnce({
      data: {
        healthy: true,
        staleUndelivered: 0,
        deadLettered24h: 0,
      },
      error: null,
    });
    await expect(runCartNoticeHealthCli()).resolves.toBe(0);
  });
});
