import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  verifyTransaction: vi.fn(),
  applyPaidOrderSideEffects: vi.fn(),
  completeOrderGatewayPayment: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));
vi.mock('@/lib/paystack', () => ({
  verifyTransaction: mocks.verifyTransaction,
}));
vi.mock('@/lib/payments/apply-paid-order-side-effects', () => ({
  applyPaidOrderSideEffects: mocks.applyPaidOrderSideEffects,
}));
vi.mock('@/lib/payments/complete-order-gateway-payment', () => ({
  completeOrderGatewayPayment: mocks.completeOrderGatewayPayment,
}));

import { runReconcilePaystackDvaCli } from '@/scripts/reconcile-paystack-dva';
import {
  createSupabaseMock,
  efosaArgs,
  verifySuccess,
} from '@/scripts/reconcile-paystack-dva-fixtures';

describe('runReconcilePaystackDvaCli — ledger completion failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exits before side effects when ledger healing fails', async () => {
    const { supabase } = createSupabaseMock({});
    mocks.createServiceClient.mockReturnValue(supabase);
    mocks.verifyTransaction.mockResolvedValue(verifySuccess);
    mocks.completeOrderGatewayPayment.mockResolvedValue({
      ok: false,
      error: new Error('ledger heal failed'),
    });

    const exit = await runReconcilePaystackDvaCli(efosaArgs);

    expect(exit).toBe(1);
    expect(mocks.applyPaidOrderSideEffects).not.toHaveBeenCalled();
  });

  it('exits before side effects when completion returns an error code', async () => {
    const { supabase } = createSupabaseMock({});
    mocks.createServiceClient.mockReturnValue(supabase);
    mocks.verifyTransaction.mockResolvedValue(verifySuccess);
    mocks.completeOrderGatewayPayment.mockResolvedValue({
      ok: true,
      completion: { error_code: 'TRANSACTION_IN_UNEXPECTED_STATE' },
    });

    const exit = await runReconcilePaystackDvaCli(efosaArgs);

    expect(exit).toBe(1);
    expect(mocks.applyPaidOrderSideEffects).not.toHaveBeenCalled();
  });

  it('fails closed when the canonical order belongs to another merchant', async () => {
    const { supabase } = createSupabaseMock({
      order: {
        id: '211bcf0e-0795-488f-aeeb-52c5b7a8b9ae',
        merchant_id: 'another-merchant',
      },
    });
    mocks.createServiceClient.mockReturnValue(supabase);
    mocks.verifyTransaction.mockResolvedValue(verifySuccess);
    mocks.completeOrderGatewayPayment.mockResolvedValue({
      ok: true,
      completion: { error_code: undefined },
    });

    const exit = await runReconcilePaystackDvaCli(efosaArgs);

    expect(exit).toBe(1);
    expect(mocks.applyPaidOrderSideEffects).not.toHaveBeenCalled();
  });
});
