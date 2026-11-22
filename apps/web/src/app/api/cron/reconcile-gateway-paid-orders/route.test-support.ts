import { NextRequest } from 'next/server';
import { vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  drainFailedPaidOrderSideEffects: vi.fn(),
  finalizeOrderGatewayPayment: vi.fn(),
  fileWedgeReview: vi.fn(),
  getCronSecret: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn() },
  recheckPaidBankCardOfferCaptures: vi.fn(),
  reconcileAbandonedPaystackAttempts: vi.fn(),
  reconcileWedgedGatewayOrders: vi.fn(),
}));

vi.mock('@/env', () => ({
  getCronSecret: routeMocks.getCronSecret,
}));
vi.mock('@/lib/logger', () => ({
  logger: routeMocks.logger,
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: routeMocks.createServiceClient,
}));
vi.mock('@/lib/payments/reconcile-wedged-gateway-orders', () => ({
  reconcileWedgedGatewayOrders: routeMocks.reconcileWedgedGatewayOrders,
}));
vi.mock('@/lib/payments/reconcile-abandoned-paystack-attempts', () => ({
  reconcileAbandonedPaystackAttempts:
    routeMocks.reconcileAbandonedPaystackAttempts,
}));
vi.mock('@/lib/payments/recheck-paid-bank-card-offer-captures', () => ({
  recheckPaidBankCardOfferCaptures: routeMocks.recheckPaidBankCardOfferCaptures,
}));
vi.mock('@/lib/payments/drain-failed-paid-order-side-effects', () => ({
  drainFailedPaidOrderSideEffects: routeMocks.drainFailedPaidOrderSideEffects,
}));
vi.mock('@/lib/payments/finalize-order-gateway-payment', () => ({
  finalizeOrderGatewayPayment: routeMocks.finalizeOrderGatewayPayment,
}));

import { GET as getRoute } from './route';

export const CRON_SECRET = 'cron-secret-for-tests';

export function buildRequest(authorization?: string) {
  return new NextRequest(
    'https://usebaci.com/api/cron/reconcile-gateway-paid-orders',
    {
      headers: authorization ? { authorization } : undefined,
    }
  );
}

export function mockSweepResult(result: unknown) {
  routeMocks.reconcileWedgedGatewayOrders.mockImplementation(async (input) => {
    await input.beforeSweep?.({
      finalizePayment: routeMocks.finalizeOrderGatewayPayment,
      fileWedgeReview: routeMocks.fileWedgeReview,
    });
    return result;
  });
}

export function resetReconciliationRouteMocks() {
  vi.clearAllMocks();
  routeMocks.getCronSecret.mockReturnValue(CRON_SECRET);
  routeMocks.createServiceClient.mockReturnValue({});
  mockSweepResult({ checked: 0, failed: [], healed: [], skipped: [] });
  routeMocks.reconcileAbandonedPaystackAttempts.mockResolvedValue({
    checked: 0,
    failed: false,
    held: [],
    retired: [],
  });
  routeMocks.drainFailedPaidOrderSideEffects.mockResolvedValue({
    drained: [],
    failed: [],
    recovered: [],
    skipped: [],
    stranded: [],
  });
  routeMocks.recheckPaidBankCardOfferCaptures.mockResolvedValue({
    checked: 0,
    failed: 0,
    retrying: 0,
    reversed: 0,
  });
}

export const GET = getRoute;
export const mocks = routeMocks;
