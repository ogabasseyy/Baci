import { describe, expect, it, vi } from 'vitest';

const mockProcessCancellationDrain = vi.fn();

vi.mock('dotenv/config', () => ({}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({}),
}));
vi.mock('@/lib/expo-push', () => ({ notifyMerchant: vi.fn() }));
vi.mock('@/lib/zeptomail', () => ({ sendEmail: vi.fn() }));
vi.mock(
  '@/app/api/cron/process-settlements/process-cancellation-drain',
  () => ({
    processCancellationDrain: (...args: unknown[]) =>
      mockProcessCancellationDrain(...args),
  })
);

import { runOrderCancellationSideEffectsCli } from './process-order-cancellation-side-effects';

describe('process-order-cancellation-side-effects CLI', () => {
  it('returns 0 on 200 and 1 on >= 400', async () => {
    mockProcessCancellationDrain.mockResolvedValueOnce(
      new Response('ok', { status: 200 })
    );
    await expect(runOrderCancellationSideEffectsCli()).resolves.toBe(0);

    mockProcessCancellationDrain.mockResolvedValueOnce(
      new Response('err', { status: 500 })
    );
    await expect(runOrderCancellationSideEffectsCli()).resolves.toBe(1);
  });
});
