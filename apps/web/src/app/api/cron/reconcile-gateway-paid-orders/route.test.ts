import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  drainFailedPaidOrderSideEffects: vi.fn(),
  getCronSecret: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn() },
  reconcileAbandonedPaystackAttempts: vi.fn(),
  reconcileWedgedGatewayOrders: vi.fn(),
}));

vi.mock('@/env', () => ({
  getCronSecret: mocks.getCronSecret,
}));
vi.mock('@/lib/logger', () => ({
  logger: mocks.logger,
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));
vi.mock('@/lib/payments/reconcile-wedged-gateway-orders', () => ({
  reconcileWedgedGatewayOrders: mocks.reconcileWedgedGatewayOrders,
}));
vi.mock('@/lib/payments/reconcile-abandoned-paystack-attempts', () => ({
  reconcileAbandonedPaystackAttempts: mocks.reconcileAbandonedPaystackAttempts,
}));
vi.mock('@/lib/payments/drain-failed-paid-order-side-effects', () => ({
  drainFailedPaidOrderSideEffects: mocks.drainFailedPaidOrderSideEffects,
}));

import { GET } from './route';

const CRON_SECRET = 'cron-secret-for-tests';

function buildRequest(authorization?: string) {
  return new NextRequest(
    'https://usebaci.com/api/cron/reconcile-gateway-paid-orders',
    {
      headers: authorization ? { authorization } : undefined,
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCronSecret.mockReturnValue(CRON_SECRET);
  mocks.createServiceClient.mockReturnValue({});
  mocks.reconcileAbandonedPaystackAttempts.mockResolvedValue({
    checked: 0,
    held: [],
    retired: [],
  });
  mocks.drainFailedPaidOrderSideEffects.mockResolvedValue({
    drained: [],
    failed: [],
    recovered: [],
    skipped: [],
    stranded: [],
  });
});

describe('GET /api/cron/reconcile-gateway-paid-orders', () => {
  it('returns 500 server_misconfigured when CRON_SECRET is unset', async () => {
    mocks.getCronSecret.mockReturnValue(undefined);

    const response = await GET(buildRequest(`Bearer ${CRON_SECRET}`));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'server_misconfigured' });
    expect(mocks.reconcileAbandonedPaystackAttempts).not.toHaveBeenCalled();
    expect(mocks.reconcileWedgedGatewayOrders).not.toHaveBeenCalled();
  });

  it('returns 401 when the bearer token is missing or wrong', async () => {
    const missing = await GET(buildRequest());
    const wrong = await GET(buildRequest('Bearer nope'));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(mocks.reconcileAbandonedPaystackAttempts).not.toHaveBeenCalled();
    expect(mocks.reconcileWedgedGatewayOrders).not.toHaveBeenCalled();
  });

  it('runs the sweep and returns its summary on success', async () => {
    const summary = {
      checked: 1,
      detectedUnhealable: [],
      failed: [],
      healed: [{ orderId: 'order-1', orderNumber: 'ORD-1' }],
      skipped: [],
    };
    mocks.reconcileWedgedGatewayOrders.mockResolvedValue(summary);

    const response = await GET(buildRequest(`Bearer ${CRON_SECRET}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject(summary);
    expect(body.abandonedAttemptSweep).toEqual({
      checked: 0,
      held: [],
      retired: [],
    });
    expect(mocks.reconcileAbandonedPaystackAttempts).toHaveBeenCalledWith(
      expect.objectContaining({ supabase: expect.anything() })
    );
    expect(body.sideEffectDrain).toEqual({
      drained: [],
      failed: [],
      recovered: [],
      skipped: [],
      stranded: [],
    });
    expect(typeof body.checked_at).toBe('string');
    expect(mocks.reconcileWedgedGatewayOrders).toHaveBeenCalledWith(
      expect.objectContaining({ supabase: expect.anything() })
    );
    expect(mocks.drainFailedPaidOrderSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ supabase: expect.anything() })
    );
  });

  it('surfaces and logs recovered/stranded side effects even when nothing else changed', async () => {
    mocks.reconcileWedgedGatewayOrders.mockResolvedValue({
      checked: 0,
      detectedUnhealable: [],
      failed: [],
      healed: [],
      skipped: [],
    });
    const sideEffectDrain = {
      drained: [],
      failed: [],
      recovered: [{ orderId: 'order-9', step: 'paid_email' }],
      skipped: [],
      stranded: [
        {
          error: 'still_broken',
          orderId: 'order-7',
          step: 'merchant_settlement',
        },
      ],
    };
    mocks.drainFailedPaidOrderSideEffects.mockResolvedValue(sideEffectDrain);

    const response = await GET(buildRequest(`Bearer ${CRON_SECRET}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sideEffectDrain).toEqual(sideEffectDrain);
    // The recovered/stranded disjuncts in the log gate must actually fire when
    // they are the only non-empty signal (checked/drained/failed all zero).
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ sideEffectDrain })
    );
  });

  it('keeps the existing repair passes running if the Paystack attempt sweep fails', async () => {
    mocks.reconcileAbandonedPaystackAttempts.mockRejectedValue(
      new Error('candidate lookup failed')
    );
    mocks.reconcileWedgedGatewayOrders.mockResolvedValue({
      checked: 0,
      detectedUnhealable: [],
      failed: [],
      healed: [],
      skipped: [],
    });

    const response = await GET(buildRequest(`Bearer ${CRON_SECRET}`));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.abandonedAttemptSweepFailed).toBe(true);
    expect(mocks.logger.error).toHaveBeenCalled();
    expect(mocks.reconcileWedgedGatewayOrders).toHaveBeenCalled();
    expect(mocks.drainFailedPaidOrderSideEffects).toHaveBeenCalled();
  });

  it('returns 500 when the sweep itself throws', async () => {
    mocks.reconcileWedgedGatewayOrders.mockRejectedValue(
      new Error('lookup exploded')
    );

    const response = await GET(buildRequest(`Bearer ${CRON_SECRET}`));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Cron job failed' });
  });
});
