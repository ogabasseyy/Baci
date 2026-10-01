import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRepairPickupPayment } from './handle-repair-pickup-payment';
import {
  createRepairPickupPaymentMetadata,
  createRepairPickupPaymentSupabase,
  repairPickupPaymentTestReference,
  repairPickupPaymentTestSecret,
} from './handle-repair-pickup-payment.test-support';

const mocks = vi.hoisted(() => ({
  bookRepairPickup: vi.fn(),
}));

vi.mock('@/lib/repairs/book-repair-pickup', () => ({
  bookRepairPickup: mocks.bookRepairPickup,
}));

describe('handleRepairPickupPayment payment-status lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PAYSTACK_SECRET_KEY = repairPickupPaymentTestSecret;
  });

  it('bugfix: returns 503 when the post-confirm payment-status lookup errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = createRepairPickupPaymentSupabase({
      pickupPaymentStatusError: { message: 'schema cache' },
    });

    try {
      const result = await handleRepairPickupPayment({
        gateway: 'paystack',
        gatewayResponse: {
          currency: 'NGN',
          metadata: createRepairPickupPaymentMetadata(),
        },
        reference: repairPickupPaymentTestReference,
        supabase: client,
        verifiedAmount: 8250,
      });

      expect(result).toEqual({
        handled: true,
        status: 503,
        body: { message: 'Repair pickup payment status lookup will retry' },
      });
      expect(mocks.bookRepairPickup).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
