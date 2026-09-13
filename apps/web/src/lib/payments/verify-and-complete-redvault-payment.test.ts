import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { verifyAndCompleteRedvaultPayment } from './verify-and-complete-redvault-payment';

const mocks = vi.hoisted(() => ({
  availability: vi.fn(),
  verify: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: mocks.revalidate,
}));
vi.mock('@/lib/checkout/redvault-payment-availability', () => ({
  getRedvaultPaymentAvailability: mocks.availability,
}));
vi.mock('@/lib/paystack', () => ({ verifyTransaction: mocks.verify }));

const context = {
  acceptedFilterPolicyHash: 'a'.repeat(64),
  amountKobo: 9500,
  currency: 'NGN',
  customerEmail: 'customer@example.test',
  issuerName: 'UBA TEST BANK',
  merchantId: OGABASSEY_MERCHANT_ID,
  orderId: '11111111-1111-4111-8111-111111111111',
  reference: 'RV-test',
  transactionId: '22222222-2222-4222-8222-222222222222',
  verificationDomain: 'test',
};
const completion = {
  actor: 'uba_redvault_verified_completion',
  already_completed: false,
  cancelled_at: null,
  order_already_paid: false,
  order_cancelled: false,
  order_number: 'ORDER-1',
  order_skipped_status: null,
  order_updated: true,
  payment_status: 'paid',
  previous_payment_status: 'unpaid',
  previous_shipping_status: 'pending',
  shipping_status: 'pending',
};
function verificationData() {
  return {
    amount: 9500,
    authorization: {
      bank: 'UBA TEST BANK',
      brand: 'visa',
      channel: 'card',
      bin: 'unused',
    },
    channel: 'card',
    currency: 'NGN',
    customer: { email: context.customerEmail },
    domain: 'test',
    id: 42,
    paid_at: '2026-09-12T09:13:00.000Z',
    reference: context.reference,
    status: 'success',
  };
}
function setup() {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: context, error: null })
    .mockResolvedValueOnce({
      data: {
        kind: 'approved',
        duplicate: false,
        completion,
        inventoryConfirmed: true,
        inventoryReclaimedUnitCount: 0,
      },
      error: null,
    });
  return {
    rpc,
    input: {
      merchantId: context.merchantId,
      orderId: context.orderId,
      reference: context.reference,
      supabase: { rpc } as never,
      transactionId: context.transactionId,
    },
  };
}

describe('server verified REDVAULT completion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.availability.mockReturnValue({ available: true });
    mocks.verify.mockResolvedValue({ success: true, data: verificationData() });
  });
  it('does not query or verify while availability is disabled', async () => {
    mocks.availability.mockReturnValue({ available: false });
    const { input, rpc } = setup();
    expect(await verifyAndCompleteRedvaultPayment(input)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('rejects a different merchant before any authority call', async () => {
    const { input, rpc } = setup();
    expect(
      await verifyAndCompleteRedvaultPayment({
        ...input,
        merchantId: context.orderId,
      })
    ).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('uses fresh server verification and sends only normalized evidence to approval', async () => {
    const { input, rpc } = setup();
    expect(await verifyAndCompleteRedvaultPayment(input)).toMatchObject({
      kind: 'approved',
      duplicate: false,
    });
    expect(mocks.verify).toHaveBeenCalledWith(context.reference);
    expect(rpc).toHaveBeenLastCalledWith(
      'approve_and_complete_uba_redvault_payment',
      expect.objectContaining({
        p_order_id: context.orderId,
        p_transaction_id: context.transactionId,
        p_verified_evidence: expect.objectContaining({
          amountKobo: 9500,
          issuerName: 'UBA TEST BANK',
          domain: 'test',
        }),
      })
    );
    expect(JSON.stringify(rpc.mock.calls.at(-1))).not.toContain('unused');
  });
  it.each([
    'orderId',
    'transactionId',
    'reference',
  ] as const)('rejects mismatched persisted %s before verification', async (key) => {
    const { input, rpc } = setup();
    rpc.mockReset().mockResolvedValue({
      data: {
        ...context,
        [key]:
          key === 'reference'
            ? 'RV-other'
            : '33333333-3333-4333-8333-333333333333',
      },
      error: null,
    });
    expect(await verifyAndCompleteRedvaultPayment(input)).toBeNull();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it.each([
    { amount: 9501 },
    { domain: 'live' },
    { reference: 'RV-other' },
    { status: 'pending' },
  ])('never approves mismatched verification %j', async (change) => {
    mocks.verify.mockResolvedValue({
      success: true,
      data: { ...verificationData(), ...change },
    });
    const { input, rpc } = setup();
    expect(await verifyAndCompleteRedvaultPayment(input)).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('preserves the hold on provider failure', async () => {
    mocks.verify.mockResolvedValue({ success: false });
    const { input, rpc } = setup();
    expect(await verifyAndCompleteRedvaultPayment(input)).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('refreshes caches after committed inventory reclamation without undoing payment on cache failure', async () => {
    const { input, rpc } = setup();
    rpc
      .mockReset()
      .mockResolvedValueOnce({ data: context, error: null })
      .mockResolvedValueOnce({
        data: {
          kind: 'approved',
          duplicate: false,
          completion,
          inventoryConfirmed: true,
          inventoryReclaimedUnitCount: 1,
        },
        error: null,
      });
    mocks.revalidate.mockImplementation(() => {
      throw new Error('cache unavailable');
    });
    expect(await verifyAndCompleteRedvaultPayment(input)).toMatchObject({
      kind: 'approved',
    });
    expect(mocks.revalidate).toHaveBeenCalledWith(OGABASSEY_MERCHANT_ID);
  });
  it('fails closed after ambiguous approval response', async () => {
    const { input, rpc } = setup();
    rpc
      .mockReset()
      .mockResolvedValueOnce({ data: context, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'private database details' },
      });
    await expect(verifyAndCompleteRedvaultPayment(input)).rejects.toThrow(
      'REDVAULT verified completion failed'
    );
  });
});
