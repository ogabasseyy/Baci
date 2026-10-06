import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { createPiggyvestCustomerPurchaseHandler } from './customer-purchase-handler';
import { paymentLegRecoveryFixture } from './payment-leg-recovery.fixture';
import { PAYMENT_LEG_RECOVERY_STATEMENTS } from './payment-leg-recovery-statements';

vi.mock('server-only', () => ({}));
vi.mock('./customer-policy-context', () => ({
  resolvePiggyvestCustomerPolicyContext: async () => ({
    status: 'ready',
    actorId: '30000000-0000-4000-8000-000000000001',
    configuration: {
      environment: 'staging',
      integrationId: '30000000-0000-4000-8000-000000000001',
      merchantId: '30000000-0000-4000-8000-000000000001',
      customerId: '30000000-0000-4000-8000-000000000001',
      goalId: '30000000-0000-4000-8000-000000000001',
      expectedBusinessId: 'synthetic',
    },
  }),
}));
const uuid = '30000000-0000-4000-8000-000000000001';
it('opt-in status reads only metadata with exact actor/operation and no fallback on failure', async () => {
  const receipt = paymentLegRecoveryFixture().result;
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: receipt }] });
  const handler = createPiggyvestCustomerPurchaseHandler({
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: uuid } }, error: null }),
      },
    } as unknown as SupabaseClient,
    goalId: uuid,
    configuration: {},
    execute,
    checkCsrfProtection: vi.fn(),
    paymentLegRecovery: { enabled: true },
  });
  const request = () =>
    new NextRequest(
      `http://localhost/purchase/status?goalId=${uuid}&operationId=${uuid}`
    );
  expect(await (await handler.status(request())).json()).toEqual({
    ...receipt,
    goalId: uuid,
  });
  expect(execute).toHaveBeenCalledExactlyOnceWith(
    PAYMENT_LEG_RECOVERY_STATEMENTS.paymentLegRecoveryRead.text,
    [uuid, uuid, uuid, uuid, 'synthetic', uuid, uuid, null]
  );
  execute.mockRejectedValueOnce(new Error('private'));
  expect(await (await handler.status(request())).json()).toMatchObject({
    status: 'unavailable',
    reservation: 'may_be_retained',
  });
  expect(execute).toHaveBeenCalledTimes(2);
});
it('preserves the exact historical receipt and includes current non-authoritative surplus evidence', async () => {
  const receipt = {
    status: 'purchase_pending',
    operationId: uuid,
    quoteId: uuid,
    savingsKobo: 100,
    otherPaymentKobo: 10,
    principalKobo: 90,
    paidInterestKobo: 10,
    surplusKobo: 5,
    collectionPaused: true,
    dispatch: 'contract_gap',
    fulfilment: 'disabled',
    current: {
      status: 'observed',
      reservation: 'retained',
      balances: {
        unreservedPrincipalKobo: 55,
        unreservedPaidInterestKobo: 0,
        pendingInterestKobo: 7,
      },
      evidence: 'internal_ledger_only',
      fundsUse: 'not_authorized',
      retry: 'not_authorized',
      observedAt: '2026-09-12T00:00:00Z',
    },
  };
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: receipt }] });
  const handler = createPiggyvestCustomerPurchaseHandler({
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: uuid } }, error: null }),
      },
    } as unknown as SupabaseClient,
    goalId: uuid,
    configuration: {},
    execute,
    checkCsrfProtection: vi.fn(),
  });
  const response = await handler.status(
    new NextRequest(
      `http://localhost/purchase/status?goalId=${uuid}&operationId=${uuid}`
    )
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...receipt, goalId: uuid });
  expect(execute).toHaveBeenCalledExactlyOnceWith(
    'SELECT piggyvest_purchase_preparation.read_current_recovery($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
    [uuid, uuid, uuid, uuid, 'synthetic', uuid, uuid]
  );
});
