import { vi } from 'vitest';
import { repairPickupPaymentClaims } from './repair-pickup-payment-claim';

export const repairPickupPaymentTestSecret = 'paystack-secret-for-tests';
export const repairPickupPaymentTestMerchantId =
  '123e4567-e89b-12d3-a456-426614174000';
export const repairPickupPaymentTestRepairId =
  '223e4567-e89b-12d3-a456-426614174000';
export const repairPickupPaymentTestReference = 'RPU-ABC123';

export function createRepairPickupPaymentMetadata() {
  return repairPickupPaymentClaims.create(
    {
      amountKobo: 825_000,
      currency: 'NGN',
      merchantId: repairPickupPaymentTestMerchantId,
      reference: repairPickupPaymentTestReference,
      repairId: repairPickupPaymentTestRepairId,
    },
    repairPickupPaymentTestSecret
  );
}

export function createRepairPickupPaymentSupabase(
  options:
    | boolean
    | {
        confirmed?: boolean;
        pickupPaymentStatus?: string | null;
        pickupPaymentStatusError?: { message: string };
      } = true
) {
  const normalized =
    typeof options === 'boolean' ? { confirmed: options } : options;
  const confirmed = normalized.confirmed ?? true;
  const pickupPaymentStatus = normalized.pickupPaymentStatus ?? 'paid';
  const maybeSingle = vi.fn().mockResolvedValue(
    normalized.pickupPaymentStatusError
      ? { data: null, error: normalized.pickupPaymentStatusError }
      : {
          data: { pickup_payment_status: pickupPaymentStatus },
          error: null,
        }
  );
  const rpc = vi.fn().mockResolvedValue({
    data: [{ confirmed }],
    error: null,
  });
  const manualNeq = vi.fn().mockResolvedValue({ error: null });
  const reviewNeq = vi.fn().mockReturnValue({ neq: manualNeq });
  const bookedNeq = vi.fn().mockReturnValue({ neq: reviewNeq });
  const thirdEq = vi.fn().mockReturnValue({ neq: bookedNeq });
  const secondEq = vi.fn().mockReturnValue({ eq: thirdEq, neq: bookedNeq });
  const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
  const update = vi.fn().mockReturnValue({ eq: firstEq });
  const selectSecondEq = vi.fn().mockReturnValue({ maybeSingle });
  const selectFirstEq = vi.fn().mockReturnValue({ eq: selectSecondEq });
  const select = vi.fn().mockReturnValue({ eq: selectFirstEq });
  const from = vi.fn().mockReturnValue({ select, update });
  return {
    bookedNeq,
    client: { from, rpc } as never,
    firstEq,
    from,
    manualNeq,
    maybeSingle,
    reviewNeq,
    rpc,
    secondEq,
    select,
    thirdEq,
    update,
  };
}
