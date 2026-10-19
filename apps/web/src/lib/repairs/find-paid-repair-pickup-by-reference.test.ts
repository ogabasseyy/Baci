import { describe, expect, it, vi } from 'vitest';
import { findPaidRepairPickupByReference } from './find-paid-repair-pickup-by-reference';

const reference = 'RPU-ABC123DEF45678';
const merchantId = '123e4567-e89b-12d3-a456-426614174000';
const repairId = '223e4567-e89b-12d3-a456-426614174000';

function createLookupClient(data: unknown, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const eqService = vi.fn().mockReturnValue({ maybeSingle });
  const eqReference = vi.fn().mockReturnValue({ eq: eqService });
  const select = vi.fn().mockReturnValue({ eq: eqReference });
  const from = vi.fn().mockReturnValue({ select });
  return { eqReference, eqService, from, maybeSingle, select };
}

describe('findPaidRepairPickupByReference', () => {
  it('returns a retryable paid repair matched by pickup_payment_reference', async () => {
    const { from, eqReference, eqService } = createLookupClient({
      id: repairId,
      merchant_id: merchantId,
      pickup_currency: 'NGN',
      pickup_fee: 8250,
      pickup_payment_status: 'retrying',
    });

    const result = await findPaidRepairPickupByReference({
      reference,
      supabase: { from } as never,
      verifiedAmount: 8250,
    });

    expect(result).toEqual({
      kind: 'found',
      repair: {
        merchantId,
        pickupPaymentStatus: 'retrying',
        repairId,
      },
    });
    expect(from).toHaveBeenCalledWith('repairs');
    expect(eqReference).toHaveBeenCalledWith(
      'pickup_payment_reference',
      reference
    );
    expect(eqService).toHaveBeenCalledWith('service_type', 'pickup');
  });

  it('returns none for booked or review statuses', async () => {
    const { from } = createLookupClient({
      id: repairId,
      merchant_id: merchantId,
      pickup_currency: 'NGN',
      pickup_fee: 8250,
      pickup_payment_status: 'booked',
    });

    await expect(
      findPaidRepairPickupByReference({
        reference,
        supabase: { from } as never,
        verifiedAmount: 8250,
      })
    ).resolves.toEqual({ kind: 'none' });
  });

  it('returns none when amount or currency does not match the paid repair', async () => {
    const { from } = createLookupClient({
      id: repairId,
      merchant_id: merchantId,
      pickup_currency: 'NGN',
      pickup_fee: 9000,
      pickup_payment_status: 'retrying',
    });

    await expect(
      findPaidRepairPickupByReference({
        reference,
        supabase: { from } as never,
        verifiedAmount: 8250,
      })
    ).resolves.toEqual({ kind: 'none' });
  });

  it('returns lookup_failed when the repairs query errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { from } = createLookupClient(null, { message: 'offline' });

    try {
      await expect(
        findPaidRepairPickupByReference({
          reference,
          supabase: { from } as never,
          verifiedAmount: 8250,
        })
      ).resolves.toEqual({ kind: 'lookup_failed' });
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
