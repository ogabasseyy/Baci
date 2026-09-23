import { beforeEach, describe, expect, it } from 'vitest';
import './book-repair-pickup.test-support';
import { bookRepairPickup } from './book-repair-pickup';
import {
  arrangeHappyRepairPickup,
  getRepairPickupMocks,
  happyResponses,
  makeSupabase,
  merchantId,
  repairId,
  repairRow,
} from './book-repair-pickup.test-support';

const mocks = getRepairPickupMocks();

describe('bookRepairPickup payment gate', () => {
  beforeEach(() => {
    arrangeHappyRepairPickup();
  });

  it('grandfathers legacy unpaid pickups with null payment columns', async () => {
    const supabase = makeSupabase(
      happyResponses({
        'repairs.select': {
          data: {
            ...repairRow,
            pickup_fee: null,
            pickup_payment_status: null,
            pickup_payment_reference: null,
          },
          error: null,
        },
      })
    );

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({ ok: true, trackingNumber: 'TRK-123' });
    expect(mocks.bookShipment).toHaveBeenCalledOnce();
  });

  it('still requires payment when a pickup reference exists without paid status', async () => {
    const supabase = makeSupabase(
      happyResponses({
        'repairs.select': {
          data: {
            ...repairRow,
            pickup_fee: null,
            pickup_payment_status: null,
            pickup_payment_reference: 'RPU-PENDINGREF12345',
          },
          error: null,
        },
      })
    );

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({ ok: false, reason: 'payment_required' });
    expect(mocks.getProviderQuotes).not.toHaveBeenCalled();
    expect(mocks.bookShipment).not.toHaveBeenCalled();
  });

  it('requires payment for newly created awaiting_payment pickups', async () => {
    const supabase = makeSupabase(
      happyResponses({
        'repairs.select': {
          data: {
            ...repairRow,
            pickup_fee: null,
            pickup_payment_status: 'awaiting_payment',
            pickup_payment_reference: null,
          },
          error: null,
        },
      })
    );

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({ ok: false, reason: 'payment_required' });
    expect(mocks.getProviderQuotes).not.toHaveBeenCalled();
    expect(mocks.bookShipment).not.toHaveBeenCalled();
  });

  it('retries a paid pickup after a transient booking failure', async () => {
    const supabase = makeSupabase(
      happyResponses({
        'repairs.select': {
          data: { ...repairRow, pickup_payment_status: 'retrying' },
          error: null,
        },
      })
    );

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({ ok: true, trackingNumber: 'TRK-123' });
    expect(mocks.bookShipment).toHaveBeenCalledOnce();
  });

  it('retries a pickup that is awaiting merchant review after payment', async () => {
    const supabase = makeSupabase(
      happyResponses({
        'repairs.select': {
          data: { ...repairRow, pickup_payment_status: 'review' },
          error: null,
        },
      })
    );

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({ ok: true, trackingNumber: 'TRK-123' });
    expect(mocks.bookShipment).toHaveBeenCalledOnce();
  });

  it('refuses GIGL booking after merchant manual fulfillment', async () => {
    const supabase = makeSupabase(
      happyResponses({
        'repairs.select': {
          data: {
            ...repairRow,
            pickup_payment_status: 'manual_fulfilled',
          },
          error: null,
        },
      })
    );

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({ ok: false, reason: 'payment_required' });
    expect(mocks.getProviderQuotes).not.toHaveBeenCalled();
    expect(mocks.bookShipment).not.toHaveBeenCalled();
  });
});
