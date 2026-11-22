import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  amendmentRefunds: vi.fn(),
  amendmentUpdates: vi.fn(),
  from: vi.fn(),
  processCancellationDrain: vi.fn(),
  rpc: vi.fn(),
  sendEmail: vi.fn(),
  notifyMerchant: vi.fn(),
}));

vi.mock('@/lib/zeptomail', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('@/lib/expo-push', () => ({ notifyMerchant: mocks.notifyMerchant }));
vi.mock('@/lib/payments/paystack-amendment-refund', () => ({
  drainPaystackAmendmentRefunds: mocks.amendmentRefunds,
}));
vi.mock('@/lib/orders/paid-order-amendment-update', () => ({
  drainPaidOrderAmendmentUpdates: mocks.amendmentUpdates,
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}));

vi.mock('./process-cancellation-drain', () => ({
  processCancellationDrain: mocks.processCancellationDrain,
}));

import { POST } from './route';

function makeCancellationDrainRequest() {
  return new Request(
    'https://usebaci.com/api/cron/process-settlements?cancellationsOnly=true',
    {
      headers: { Authorization: 'Bearer test-secret' },
      method: 'POST',
    }
  );
}

describe('POST /api/cron/process-settlements?cancellationsOnly=true', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    vi.stubEnv('CRON_SECRET', 'test-secret');
    vi.stubEnv('PAID_ORDER_AMENDMENT_REFUND_WORKER_ENABLED', 'false');
    vi.stubEnv('PAID_ORDER_AMENDMENT_UPDATES_ENABLED', 'false');
    mocks.processCancellationDrain.mockResolvedValue(
      NextResponse.json({ success: true })
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('delegates to the cancellation drain and returns its response', async () => {
    const response = await POST(makeCancellationDrainRequest());

    expect(mocks.processCancellationDrain).toHaveBeenCalledWith(
      expect.objectContaining({ from: mocks.from, rpc: mocks.rpc }),
      mocks.sendEmail,
      mocks.notifyMerchant,
      expect.any(Number)
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it('starts ordinary cancellations before amendment work consumes the reconciliation window', async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    vi.stubEnv('PAID_ORDER_AMENDMENT_REFUND_WORKER_ENABLED', 'true');
    vi.stubEnv('PAID_ORDER_AMENDMENT_UPDATES_ENABLED', 'true');
    mocks.amendmentRefunds.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 35_000))
    );
    mocks.amendmentUpdates.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 15_000))
    );
    mocks.processCancellationDrain.mockImplementation(
      async (_database, _email, _push, invocationStartedAt: number) => {
        expect(Date.now()).toBe(invocationStartedAt);
        return NextResponse.json({ success: true });
      }
    );

    const run = POST(makeCancellationDrainRequest());
    expect(mocks.processCancellationDrain).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(50_000);
    expect(mocks.amendmentRefunds).toHaveBeenCalledWith(
      expect.anything(),
      startedAt + 35_000
    );
    expect(mocks.amendmentUpdates).toHaveBeenCalledWith(
      expect.anything(),
      startedAt + 50_000
    );
    expect((await run).status).toBe(200);
  });

  it('rejects unauthenticated cancellation drains before delegating', async () => {
    const response = await POST(
      new Request(
        'https://usebaci.com/api/cron/process-settlements?cancellationsOnly=true',
        { headers: { Authorization: 'Bearer wrong' }, method: 'POST' }
      )
    );

    expect(response.status).toBe(401);
    expect(mocks.processCancellationDrain).not.toHaveBeenCalled();
  });

  it.each([
    '1',
    'True',
    'yes',
  ])('rejects malformed cancellationsOnly=%s without database work', async (value) => {
    const response = await POST(
      new Request(
        `https://usebaci.com/api/cron/process-settlements?cancellationsOnly=${value}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.CRON_SECRET}`,
          },
          method: 'POST',
        }
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid cancellationsOnly value',
    });
    expect(mocks.processCancellationDrain).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
