import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { reconcileMobileRepairPickupPayment } from './reconcile-mobile-repair-pickup-payment';
import { repairPickupPaymentClaims } from './repair-pickup-payment-claim';

const verify = vi.hoisted(() => vi.fn());
vi.mock('@/lib/paystack', () => ({ verifyTransaction: verify }));
const unknown = {
  success: false as const,
  code: 'payment_initialization_unknown',
  error: 'unknown',
  reference: 'RPU-123',
};
const merchantId = '14bf2192-16de-442b-bf75-700f4ff2aaca';
const repairId = '22bf2192-16de-442b-bf75-700f4ff2aaca';
const secret = 'paystack-secret-for-tests';
const reconcilable = {
  success: false as const,
  code: 'payment_initialization_unknown',
  error: 'unknown',
  id: repairId,
  ticketNumber: 42,
  resumeToken: 'token',
  reference: 'RPU-123',
  amountKobo: 300000,
  currency: 'NGN',
};
function verified(status: string) {
  const metadata = repairPickupPaymentClaims.create(
    {
      amountKobo: 300000,
      currency: 'NGN',
      merchantId,
      reference: 'RPU-123',
      repairId,
    },
    secret
  );
  return {
    success: true,
    data: {
      reference: 'RPU-123',
      status,
      amount: 300000,
      currency: 'NGN',
      metadata,
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  process.env.PAYSTACK_SECRET_KEY = secret;
});
afterEach(() => {
  delete process.env.PAYSTACK_SECRET_KEY;
});
it('keeps the original reference when verification fails', async () => {
  verify.mockResolvedValue({ success: false });
  expect(await reconcileMobileRepairPickupPayment(unknown, 'merchant')).toEqual(
    unknown
  );
  expect(verify).toHaveBeenCalledWith('RPU-123');
});
it('does not trust an unrelated payment without signed metadata', async () => {
  verify.mockResolvedValue({
    success: true,
    data: { reference: 'RPU-123', status: 'success', metadata: null },
  });
  expect(await reconcileMobileRepairPickupPayment(unknown, 'merchant')).toEqual(
    unknown
  );
});
it.each([
  'failed',
  'abandoned',
])('retires the unknown attempt after a terminal %s verification', async (status) => {
  verify.mockResolvedValue(verified(status));
  expect(
    await reconcileMobileRepairPickupPayment(reconcilable, merchantId)
  ).toEqual({
    ...reconcilable,
    code: 'payment_initialization_failed',
    error:
      'The previous payment attempt did not complete. Start a new payment to continue.',
  });
});
it('keeps a verified success on the unknown receipt until the webhook fulfills', async () => {
  verify.mockResolvedValue(verified('success'));
  expect(
    await reconcileMobileRepairPickupPayment(reconcilable, merchantId)
  ).toEqual({
    ...reconcilable,
    error:
      'Payment received. Check this repair ticket for pickup confirmation.',
  });
});
it('keeps a pending verification unknown for a later retry', async () => {
  verify.mockResolvedValue(verified('pending'));
  expect(
    await reconcileMobileRepairPickupPayment(reconcilable, merchantId)
  ).toEqual({
    ...reconcilable,
    error:
      'The original payment is not confirmed. Keep this ticket and contact the store for payment recovery.',
  });
});
