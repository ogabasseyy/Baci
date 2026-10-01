import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  verifyTransaction: vi.fn(),
  extractVerifiedGatewayFeeNgn: vi.fn(),
  calculatePlatformFee: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));
vi.mock('@/lib/paystack', () => ({
  verifyTransaction: mocks.verifyTransaction,
  calculatePlatformFee: mocks.calculatePlatformFee,
}));
vi.mock('@/lib/payments/verified-gateway-fee', () => ({
  extractVerifiedGatewayFeeNgn: mocks.extractVerifiedGatewayFeeNgn,
}));

import { runReconcilePaystackUnmatchedPartialCli } from './reconcile-paystack-unmatched-partial';

const args = [
  '--review-id',
  '11111111-1111-4111-8111-111111111111',
  '--canonical-order-id',
  '22222222-2222-4222-8222-222222222222',
  '--merchant-id',
  '33333333-3333-4333-8333-333333333333',
  '--operator-user-id',
  '44444444-4444-4444-8444-444444444444',
  '--paystack-reference',
  'paystack-reference-1',
];

describe('runReconcilePaystackUnmatchedPartialCli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed when Paystack does not verify the reference as successful', async () => {
    mocks.verifyTransaction.mockResolvedValue({
      success: true,
      data: { status: 'pending', currency: 'NGN', amount: 100 },
    });

    await expect(runReconcilePaystackUnmatchedPartialCli(args)).resolves.toBe(1);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('fails closed before verification when arguments are invalid', async () => {
    await expect(
      runReconcilePaystackUnmatchedPartialCli([
        '--review-id',
        'not-a-uuid',
      ])
    ).resolves.toBe(1);
    expect(mocks.verifyTransaction).not.toHaveBeenCalled();
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('fails closed for a non-NGN verified payment before creating a client', async () => {
    mocks.verifyTransaction.mockResolvedValue({
      success: true,
      data: {
        status: 'success',
        currency: 'USD',
        amount: 100,
        customer: { email: 'buyer@example.com' },
      },
    });

    await expect(runReconcilePaystackUnmatchedPartialCli(args)).resolves.toBe(1);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('fails closed when the verified payment has no customer email', async () => {
    mocks.verifyTransaction.mockResolvedValue({
      success: true,
      data: { status: 'success', currency: 'NGN', amount: 100, customer: {} },
    });

    await expect(runReconcilePaystackUnmatchedPartialCli(args)).resolves.toBe(1);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('reconciles a verified partial payment with the exact fee and identity payload', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        outcome: 'partial_recorded',
        transaction_id: 'txn-1',
      },
      error: null,
    });
    mocks.createServiceClient.mockReturnValue({ rpc });
    mocks.verifyTransaction.mockResolvedValue({
      success: true,
      data: {
        status: 'success',
        currency: 'NGN',
        amount: 125_000,
        customer: {
          email: 'buyer@example.com',
          first_name: 'Ada',
          last_name: 'Lovelace',
        },
        fees: 2_500,
        reference: 'paystack-reference-1',
      },
    });
    mocks.calculatePlatformFee.mockReturnValue({
      platformFee: 2_500,
      merchantAmount: 122_500,
    });
    mocks.extractVerifiedGatewayFeeNgn.mockReturnValue(25);

    const exit = await runReconcilePaystackUnmatchedPartialCli(args);

    expect(exit).toBe(0);
    expect(rpc).toHaveBeenCalledWith(
      'reconcile_paystack_unmatched_partial_payment',
      expect.objectContaining({
        p_amount: 1_250,
        p_actor: 'script:reconcile-paystack-unmatched-partial',
        p_allow_email_mismatch: false,
        p_currency: 'NGN',
        p_customer_email: 'buyer@example.com',
        p_customer_name: 'Ada Lovelace',
        p_gateway_fee: 25,
        p_merchant_amount: 1_225,
        p_merchant_id: '33333333-3333-4333-8333-333333333333',
        p_operator_user_id: '44444444-4444-4444-8444-444444444444',
        p_order_id: '22222222-2222-4222-8222-222222222222',
        p_paystack_reference: 'paystack-reference-1',
        p_platform_fee: 25,
        p_review_id: '11111111-1111-4111-8111-111111111111',
      })
    );
  });

  it('marks an approved email mismatch override explicitly in the RPC payload', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { outcome: 'partial_recorded', transaction_id: 'txn-override' },
      error: null,
    });
    mocks.createServiceClient.mockReturnValue({ rpc });
    mocks.verifyTransaction.mockResolvedValue({
      success: true,
      data: {
        status: 'success',
        currency: 'NGN',
        amount: 125_000,
        customer: { email: 'payer@example.com' },
      },
    });
    mocks.calculatePlatformFee.mockReturnValue({
      platformFee: 2_500,
      merchantAmount: 122_500,
    });
    mocks.extractVerifiedGatewayFeeNgn.mockReturnValue(25);

    const exit = await runReconcilePaystackUnmatchedPartialCli([
      ...args,
      '--allow-email-mismatch',
      'true',
    ]);

    expect(exit).toBe(0);
    expect(rpc).toHaveBeenCalledWith(
      'reconcile_paystack_unmatched_partial_payment',
      expect.objectContaining({
        p_actor:
          'script:reconcile-paystack-unmatched-partial:email-mismatch-override',
        p_allow_email_mismatch: true,
        p_customer_email: 'payer@example.com',
      })
    );
  });

  it('fails closed when the reconciliation RPC returns an error', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'rpc failed' } });
    mocks.createServiceClient.mockReturnValue({ rpc });
    mocks.verifyTransaction.mockResolvedValue({
      success: true,
      data: {
        status: 'success',
        currency: 'NGN',
        amount: 125_000,
        customer: { email: 'buyer@example.com' },
      },
    });
    mocks.calculatePlatformFee.mockReturnValue({
      platformFee: 2_500,
      merchantAmount: 122_500,
    });
    mocks.extractVerifiedGatewayFeeNgn.mockReturnValue(25);

    await expect(runReconcilePaystackUnmatchedPartialCli(args)).resolves.toBe(1);
  });

  it('fails closed when the reconciliation RPC returns null data without an error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    mocks.createServiceClient.mockReturnValue({ rpc });
    mocks.verifyTransaction.mockResolvedValue({
      success: true,
      data: {
        status: 'success',
        currency: 'NGN',
        amount: 125_000,
        customer: { email: 'buyer@example.com' },
      },
    });
    mocks.calculatePlatformFee.mockReturnValue({
      platformFee: 2_500,
      merchantAmount: 122_500,
    });
    mocks.extractVerifiedGatewayFeeNgn.mockReturnValue(25);

    await expect(runReconcilePaystackUnmatchedPartialCli(args)).resolves.toBe(1);
  });
});
