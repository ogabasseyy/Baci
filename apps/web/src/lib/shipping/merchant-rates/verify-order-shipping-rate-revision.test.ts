import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  MerchantShippingRate,
  StorefrontShippingRatesPayload,
} from './types';
import { verifyOrderShippingRate } from './verify-order-shipping-rate';

type GetMerchantShippingRatesModule =
  typeof import('./get-merchant-shipping-rates');

const { mockGetMerchantShippingRatesOrThrow } = vi.hoisted(() => ({
  mockGetMerchantShippingRatesOrThrow: vi.fn(),
}));

vi.mock('./get-merchant-shipping-rates', async (importOriginal) => {
  const actual = await importOriginal<GetMerchantShippingRatesModule>();
  return {
    ...actual,
    getMerchantShippingRatesOrThrow: mockGetMerchantShippingRatesOrThrow,
  };
});

const supabase = {} as SupabaseClient;
const merchantId = 'merchant-revision-test';

function buildPayload(): StorefrontShippingRatesPayload {
  const rate: MerchantShippingRate = {
    id: 'rate-revision-test',
    zoneId: 'zone-revision-test',
    name: 'Standard',
    kind: 'ship',
    currency: 'NGN',
    baseAmount: 1500,
    conditionType: 'always',
    minSubtotal: null,
    maxSubtotal: null,
    freeOverAmount: null,
    deliveryMinDays: 1,
    deliveryMaxDays: 3,
    pickupAddress: null,
    sortOrder: 0,
    active: true,
  };
  return {
    zones: [
      {
        id: 'zone-revision-test',
        name: 'Lagos',
        isRestOfWorld: false,
        active: true,
      },
    ],
    locations: [
      {
        zoneId: 'zone-revision-test',
        countryCode: 'NG',
        subdivisionCode: 'NG-LA',
      },
    ],
    rates: [rate],
    shippingConfigRevision: '42',
  };
}

describe('verifyOrderShippingRate shipping config revision', () => {
  it('returns the revision from the same storefront config payload', async () => {
    mockGetMerchantShippingRatesOrThrow.mockResolvedValue(buildPayload());

    await expect(
      verifyOrderShippingRate({
        supabase,
        merchantId,
        shippingRateId: 'rate-revision-test',
        shippingAddress: { state: 'Lagos', country: null },
        merchantCountry: 'NG',
        merchantCurrency: 'NGN',
        canonicalSubtotal: 10_000,
      })
    ).resolves.toMatchObject({
      ok: true,
      shippingConfigRevision: '42',
    });
  });
});
