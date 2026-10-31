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
  sampleQuote,
} from './book-repair-pickup.test-support';

const mocks = getRepairPickupMocks();

// Pickups paid before GIG prices were rounded up to whole NGN 100 hold the
// unrounded fee; booking must still go through when GIG's cost is unchanged.
describe('bookRepairPickup paid pickup fee', () => {
  beforeEach(() => {
    arrangeHappyRepairPickup();
  });

  it('bugfix: books a pickup paid at the pre-rounding GIG price when GIG cost is unchanged', async () => {
    // Cost 8,941.43 was priced at 9,835.58 before rounding; it now quotes 9,900.
    mocks.getProviderQuotes.mockResolvedValueOnce([
      {
        ...sampleQuote,
        price: 9900,
        providerCost: 8941.43,
        platformMargin: 958.57,
        marginBasisPoints: 1000,
        pricingVersion: 'gigl_platform_margin_v1',
      },
    ]);
    const inserts: Array<{ table: string; payload: unknown }> = [];
    const supabase = makeSupabase(
      happyResponses({
        'repairs.select': {
          data: { ...repairRow, pickup_fee: 9835.58 },
          error: null,
        },
      }),
      [],
      inserts
    );

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({ ok: true });
    expect(inserts).toContainEqual({
      table: 'repair_pickup_quotes',
      payload: expect.objectContaining({ charge: 9835.58 }),
    });
  });

  it('still refuses a pickup when GIG cost itself rose above the paid fee', async () => {
    mocks.getProviderQuotes.mockResolvedValueOnce([
      {
        ...sampleQuote,
        price: 10000,
        providerCost: 9000,
        platformMargin: 1000,
        marginBasisPoints: 1000,
        pricingVersion: 'gigl_platform_margin_v1',
      },
    ]);
    const supabase = makeSupabase(
      happyResponses({
        'repairs.select': {
          data: { ...repairRow, pickup_fee: 9835.58 },
          error: null,
        },
      })
    );

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({ ok: false, reason: 'quote_increased' });
    expect(mocks.bookShipment).not.toHaveBeenCalled();
  });
});
