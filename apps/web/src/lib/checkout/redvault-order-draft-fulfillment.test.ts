import { describe, expect, it } from 'vitest';
import { redvaultOrderDraftFulfillment } from './redvault-order-draft-fulfillment';

describe('REDVAULT fulfillment snapshot', () => {
  it('includes pickup provider, rate identity and collection details in the atomic order arguments', () => {
    const pickupAddress = {
      address: '1 Test Street',
      instructions: 'Collect at reception',
    };
    expect(
      redvaultOrderDraftFulfillment(
        { kind: 'pickup', rateName: 'Collect', pickupAddress },
        'rate-id'
      )
    ).toEqual({
      p_merchant_fulfillment: {
        provider: 'MERCHANT_PICKUP',
        rate_id: 'rate-id',
        rate_name: 'Collect',
        pickup_details: pickupAddress,
      },
    });
  });
  it('includes merchant shipping identity without stale pickup details', () => {
    expect(
      redvaultOrderDraftFulfillment(
        {
          kind: 'ship',
          rateName: 'Local delivery',
          pickupAddress: { address: 'Stale' },
        },
        'rate-id'
      )
    ).toEqual({
      p_merchant_fulfillment: {
        provider: 'MERCHANT',
        rate_id: 'rate-id',
        rate_name: 'Local delivery',
        pickup_details: null,
      },
    });
  });
  it('does not stamp provider quotes as merchant fulfillment', () => {
    expect(redvaultOrderDraftFulfillment(null, undefined)).toEqual({});
  });
});
