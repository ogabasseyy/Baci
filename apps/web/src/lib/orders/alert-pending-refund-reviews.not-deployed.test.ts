import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@/lib/orders/alert-merchant-cancellation-refund-review', () => ({
  alertMerchantOfRefundReview: vi.fn(),
}));

const senders = { sendEmail: vi.fn(), sendPush: vi.fn() };
const rpcError = (error: { code: string; message: string }) => ({
  from: vi.fn(),
  rpc: vi.fn(() => ({
    abortSignal: () => Promise.resolve({ data: null, error }),
  })),
});

async function load() {
  vi.resetModules();
  const { logger } = await import('@/lib/logger');
  const { alertPendingRefundReviews } = await import(
    './alert-pending-refund-reviews'
  );
  return { alertPendingRefundReviews, logger };
}

beforeEach(() => vi.clearAllMocks());

describe('alert RPC not deployed yet', () => {
  it.each([
    'PGRST202',
    '42883',
  ])('counts %s as deferred and warns once per process, never as failed', async (code) => {
    const { alertPendingRefundReviews, logger } = await load();
    const supabase = rpcError({ code, message: 'function does not exist' });
    const first = await alertPendingRefundReviews({
      senders,
      supabase: supabase as never,
    });
    const second = await alertPendingRefundReviews({
      senders,
      supabase: supabase as never,
    });
    expect(first).toMatchObject({ deferred: 1, failed: 0 });
    expect(second).toMatchObject({ deferred: 1, failed: 0 });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith({
      message: 'refund alert RPC not deployed yet',
    });
  });

  it('still counts real lookup errors as failed', async () => {
    const { alertPendingRefundReviews, logger } = await load();
    const result = await alertPendingRefundReviews({
      senders,
      supabase: rpcError({ code: '57014', message: 'timeout' }) as never,
    });
    expect(result).toMatchObject({ deferred: 0, failed: 1 });
    expect(logger.error).toHaveBeenCalled();
  });
});
