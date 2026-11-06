import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MerchantShippingRatesLoadError } from './get-merchant-shipping-rates';
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

const MERCHANT_ID = 'merchant-1';
const LAGOS_ZONE_ID = 'zone-lagos';
const ROW_ZONE_ID = 'zone-row';
const LAGOS_RATE_ID = 'rate-lagos-standard';
const ROW_RATE_ID = 'rate-nationwide';

const supabase = {} as SupabaseClient;

function buildRate(
  overrides: Partial<MerchantShippingRate> = {}
): MerchantShippingRate {
  return {
    id: LAGOS_RATE_ID,
    zoneId: LAGOS_ZONE_ID,
    name: 'Lagos Standard',
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
    ...overrides,
  };
}

function buildPayload(
  rates: MerchantShippingRate[]
): StorefrontShippingRatesPayload {
  return {
    zones: [
      {
        id: LAGOS_ZONE_ID,
        name: 'Lagos',
        isRestOfWorld: false,
        active: true,
      },
      {
        id: ROW_ZONE_ID,
        name: 'Everywhere else',
        isRestOfWorld: true,
        active: true,
      },
    ],
    locations: [
      {
        zoneId: LAGOS_ZONE_ID,
        countryCode: 'NG',
        subdivisionCode: 'NG-LA',
      },
    ],
    rates,
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    supabase,
    merchantId: MERCHANT_ID,
    shippingRateId: LAGOS_RATE_ID,
    shippingAddress: { state: 'Lagos', country: null },
    merchantCountry: 'NG',
    merchantCurrency: 'NGN',
    canonicalSubtotal: 10_000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMerchantShippingRatesOrThrow.mockResolvedValue(
    buildPayload([buildRate()])
  );
});

describe('verifyOrderShippingRate', () => {
  it('loads rates for the given merchant via the service-role client', async () => {
    // Act
    await verifyOrderShippingRate(baseInput());

    // Assert
    expect(mockGetMerchantShippingRatesOrThrow).toHaveBeenCalledWith(
      supabase,
      MERCHANT_ID
    );
  });

  it('accepts a flat rate for the winning zone and returns the server amount', async () => {
    // Act
    const result = await verifyOrderShippingRate(baseInput());

    // Assert
    expect(result).toEqual({
      ok: true,
      amount: 1500,
      rateName: 'Lagos Standard',
      currency: 'NGN',
      kind: 'ship',
    });
  });

  it('returns amount 0 when the canonical subtotal crosses free_over_amount', async () => {
    // Arrange
    mockGetMerchantShippingRatesOrThrow.mockResolvedValue(
      buildPayload([buildRate({ freeOverAmount: 5000 })])
    );

    // Act
    const result = await verifyOrderShippingRate(
      baseInput({ canonicalSubtotal: 5000 })
    );

    // Assert
    expect(result).toEqual({
      ok: true,
      amount: 0,
      rateName: 'Lagos Standard',
      currency: 'NGN',
      kind: 'ship',
    });
  });

  it('keeps the base amount when the subtotal is below free_over_amount', async () => {
    // Arrange
    mockGetMerchantShippingRatesOrThrow.mockResolvedValue(
      buildPayload([buildRate({ freeOverAmount: 50_000 })])
    );

    // Act
    const result = await verifyOrderShippingRate(baseInput());

    // Assert
    expect(result).toEqual(expect.objectContaining({ ok: true, amount: 1500 }));
  });

  it('returns kind "pickup" for a pickup rate so the order can be stamped as pickup', async () => {
    // Arrange — a pickup rate with no configured collection address.
    mockGetMerchantShippingRatesOrThrow.mockResolvedValue(
      buildPayload([buildRate({ kind: 'pickup' })])
    );

    // Act
    const result = await verifyOrderShippingRate(baseInput());

    // Assert — kind is pickup and the (null) collection snapshot is returned.
    expect(result).toEqual({
      ok: true,
      amount: 1500,
      rateName: 'Lagos Standard',
      currency: 'NGN',
      kind: 'pickup',
      pickupAddress: null,
    });
  });

  it('returns the pickup collection address so the order can snapshot it', async () => {
    // Arrange — a pickup rate carrying a full collection address/instructions.
    const pickupAddress = {
      label: 'Ikeja Pickup Hub',
      address: '5 Allen Avenue',
      city: 'Ikeja',
      state: 'Lagos',
      countryCode: 'NG',
      instructions: 'Ask for the front desk',
    };
    mockGetMerchantShippingRatesOrThrow.mockResolvedValue(
      buildPayload([buildRate({ kind: 'pickup', pickupAddress })])
    );

    // Act
    const result = await verifyOrderShippingRate(baseInput());

    // Assert — the collection point is returned for the order stamp.
    expect(result).toEqual({
      ok: true,
      amount: 1500,
      rateName: 'Lagos Standard',
      currency: 'NGN',
      kind: 'pickup',
      pickupAddress,
    });
  });

  it('omits pickupAddress for a ship rate', async () => {
    // Act — the base rate is a ship rate.
    const result = await verifyOrderShippingRate(baseInput());

    // Assert — no pickup snapshot is attached to a door-delivery rate.
    expect(result).toEqual({
      ok: true,
      amount: 1500,
      rateName: 'Lagos Standard',
      currency: 'NGN',
      kind: 'ship',
    });
    expect(result).not.toHaveProperty('pickupAddress');
  });

  it('rejects a rate stamped in a currency other than the merchant current currency', async () => {
    // Arrange — the rate is priced in NGN but the store currency is now USD
    // (the merchant changed payout currency without re-saving rates).
    mockGetMerchantShippingRatesOrThrow.mockResolvedValue(
      buildPayload([buildRate()])
    );

    // Act
    const result = await verifyOrderShippingRate(
      baseInput({ merchantCurrency: 'USD' })
    );

    // Assert
    expect(result).toEqual({
      ok: false,
      code: 'SHIPPING_RATE_INVALID',
      message:
        'Selected shipping rate is out of date because the store currency changed; the merchant must re-save their shipping rates',
    });
  });

  it('matches the rate currency case-insensitively', async () => {
    // Arrange
    mockGetMerchantShippingRatesOrThrow.mockResolvedValue(
      buildPayload([buildRate({ currency: 'ngn' })])
    );

    // Act
    const result = await verifyOrderShippingRate(
      baseInput({ merchantCurrency: 'NGN' })
    );

    // Assert
    expect(result).toEqual(expect.objectContaining({ ok: true, amount: 1500 }));
  });

  it('accepts a price_tier rate when the canonical subtotal is within bounds', async () => {
    // Arrange
    mockGetMerchantShippingRatesOrThrow.mockResolvedValue(
      buildPayload([
        buildRate({
          conditionType: 'price_tier',
          minSubtotal: 5000,
          maxSubtotal: 20_000,
        }),
      ])
    );

    // Act
    const result = await verifyOrderShippingRate(baseInput());

    // Assert
    expect(result).toEqual(expect.objectContaining({ ok: true, amount: 1500 }));
  });

  it('rejects a price_tier rate when the canonical subtotal misses the tier', async () => {
    // Arrange
    mockGetMerchantShippingRatesOrThrow.mockResolvedValue(
      buildPayload([
        buildRate({
          conditionType: 'price_tier',
          minSubtotal: 20_000,
          maxSubtotal: null,
        }),
      ])
    );

    // Act
    const result = await verifyOrderShippingRate(baseInput());

    // Assert
    expect(result).toEqual({
      ok: false,
      code: 'SHIPPING_RATE_CONDITION_UNMET',
      message: 'Selected shipping rate conditions are not met for this order',
    });
  });

  it('rejects the tier upper bound exclusively (subtotal === maxSubtotal)', async () => {
    // Arrange
    mockGetMerchantShippingRatesOrThrow.mockResolvedValue(
      buildPayload([
        buildRate({
          conditionType: 'price_tier',
          minSubtotal: 0,
          maxSubtotal: 10_000,
        }),
      ])
    );

    // Act
    const result = await verifyOrderShippingRate(baseInput());

    // Assert
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        code: 'SHIPPING_RATE_CONDITION_UNMET',
      })
    );
  });

  it('rejects a rate whose zone is not the most-specific match for the destination', async () => {
    // Arrange — Lagos-zone rate picked, but the address resolves to Abuja, so
    // the rest-of-world zone wins the match.
    mockGetMerchantShippingRatesOrThrow.mockResolvedValue(
      buildPayload([
        buildRate(),
        buildRate({ id: ROW_RATE_ID, zoneId: ROW_ZONE_ID, baseAmount: 4000 }),
      ])
    );

    // Act
    const result = await verifyOrderShippingRate(
      baseInput({ shippingAddress: { state: 'FCT - Abuja', country: null } })
    );

    // Assert
    expect(result).toEqual({
      ok: false,
      code: 'SHIPPING_RATE_ZONE_MISMATCH',
      message: 'Selected shipping rate does not serve the delivery address',
    });
  });

  it('rejects an unknown rate id', async () => {
    // Act
    const result = await verifyOrderShippingRate(
      baseInput({ shippingRateId: 'rate-unknown' })
    );

    // Assert
    expect(result).toEqual(
      expect.objectContaining({ ok: false, code: 'SHIPPING_RATE_INVALID' })
    );
  });

  it("rejects another merchant's rate (scoped load returns no such rate)", async () => {
    // Arrange — the loader is merchant-scoped, so a foreign rate id is simply
    // absent from this merchant's payload.
    mockGetMerchantShippingRatesOrThrow.mockResolvedValue(buildPayload([]));

    // Act
    const result = await verifyOrderShippingRate(baseInput());

    // Assert
    expect(mockGetMerchantShippingRatesOrThrow).toHaveBeenCalledWith(
      supabase,
      MERCHANT_ID
    );
    expect(result).toEqual(
      expect.objectContaining({ ok: false, code: 'SHIPPING_RATE_INVALID' })
    );
  });

  it('rejects an inactive rate', async () => {
    // Arrange
    mockGetMerchantShippingRatesOrThrow.mockResolvedValue(
      buildPayload([buildRate({ active: false })])
    );

    // Act
    const result = await verifyOrderShippingRate(baseInput());

    // Assert
    expect(result).toEqual(
      expect.objectContaining({ ok: false, code: 'SHIPPING_RATE_INVALID' })
    );
  });

  it("rejects a rate whose zone is inactive or missing from the merchant's zones", async () => {
    // Arrange
    const payload = buildPayload([buildRate()]);
    payload.zones = payload.zones.map((zone) =>
      zone.id === LAGOS_ZONE_ID ? { ...zone, active: false } : zone
    );
    mockGetMerchantShippingRatesOrThrow.mockResolvedValue(payload);

    // Act
    const result = await verifyOrderShippingRate(baseInput());

    // Assert
    expect(result).toEqual(
      expect.objectContaining({ ok: false, code: 'SHIPPING_RATE_INVALID' })
    );
  });

  it('falls back to the merchant country when the address has no country (domestic assumption)', async () => {
    // Arrange — no address country; merchantCountry NG keeps the Lagos zone
    // matchable through the free-text state alone.
    mockGetMerchantShippingRatesOrThrow.mockResolvedValue(
      buildPayload([buildRate()])
    );

    // Act
    const result = await verifyOrderShippingRate(
      baseInput({ shippingAddress: { state: 'Lagos' }, merchantCountry: 'ng' })
    );

    // Assert
    expect(result).toEqual(expect.objectContaining({ ok: true, amount: 1500 }));
  });

  it('ignores a free-text (non ISO-2) address country and uses the merchant country', async () => {
    // Act
    const result = await verifyOrderShippingRate(
      baseInput({
        shippingAddress: { state: 'Lagos', country: 'Nigeria' },
      })
    );

    // Assert
    expect(result).toEqual(expect.objectContaining({ ok: true, amount: 1500 }));
  });

  it('prefers a valid ISO-2 address country over the merchant country', async () => {
    // Arrange — address says GB; the merchant's NG-scoped Lagos zone loses to
    // the rest-of-world zone, so the Lagos rate is a zone mismatch.
    mockGetMerchantShippingRatesOrThrow.mockResolvedValue(
      buildPayload([
        buildRate(),
        buildRate({ id: ROW_RATE_ID, zoneId: ROW_ZONE_ID, baseAmount: 4000 }),
      ])
    );

    // Act
    const lagosResult = await verifyOrderShippingRate(
      baseInput({ shippingAddress: { state: 'Lagos', country: 'gb' } })
    );
    const rowResult = await verifyOrderShippingRate(
      baseInput({
        shippingRateId: ROW_RATE_ID,
        shippingAddress: { state: 'Lagos', country: 'gb' },
      })
    );

    // Assert
    expect(lagosResult).toEqual(
      expect.objectContaining({
        ok: false,
        code: 'SHIPPING_RATE_ZONE_MISMATCH',
      })
    );
    expect(rowResult).toEqual(
      expect.objectContaining({ ok: true, amount: 4000 })
    );
  });

  it('fails closed with a zone mismatch when no destination country resolves', async () => {
    // Act
    const result = await verifyOrderShippingRate(
      baseInput({
        shippingAddress: { state: 'Lagos', country: null },
        merchantCountry: null,
      })
    );

    // Assert
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        code: 'SHIPPING_RATE_ZONE_MISMATCH',
      })
    );
  });

  it('propagates a load failure (throws, does not return a rejection verdict)', async () => {
    // Arrange — a rate-config LOAD failure must NOT collapse into an empty
    // payload/invalid-rate verdict; it throws so the route can map it to a 500.
    mockGetMerchantShippingRatesOrThrow.mockRejectedValue(
      new MerchantShippingRatesLoadError('rpc down', { code: 'PGRST002' })
    );

    // Act + Assert
    await expect(verifyOrderShippingRate(baseInput())).rejects.toBeInstanceOf(
      MerchantShippingRatesLoadError
    );
  });
});
