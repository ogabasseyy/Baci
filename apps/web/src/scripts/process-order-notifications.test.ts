import { describe, expect, it, vi } from 'vitest';

const mockRpc = vi.fn();

vi.mock('dotenv/config', () => ({}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ rpc: mockRpc }),
}));
vi.mock(
  '@/app/api/cron/order-notifications/order-notification-outbox-worker',
  () => ({
    claimedOrderNotificationOutboxRowSchema: {
      array: () => ({ safeParse: () => ({ success: true, data: [] }) }),
      shape: { event_type: { safeParse: () => ({ success: true }) } },
    },
    createOrderNotificationCronSummary: () => ({
      claimed: 0,
      failed: 0,
      sent: 0,
      skipped: 0,
    }),
    processClaimedOrderNotificationRows: vi.fn(),
  })
);

import { runOrderNotificationsCli } from './process-order-notifications';

describe('process-order-notifications CLI', () => {
  it('returns 1 when claim RPC fails and 0 when no rows are claimed', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(runOrderNotificationsCli(5)).resolves.toBe(1);

    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(runOrderNotificationsCli(5)).resolves.toBe(0);
  });
});
