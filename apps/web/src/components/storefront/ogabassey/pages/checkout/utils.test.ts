import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAIN_DISPLAY_NAMES,
  CHAIN_EXPLORER_URLS,
  CRYPTO_CHAIN_SUPPORT,
  calculateDeliveryCost,
  getDeliveryDateRange,
  getForwardableSelectedQuoteId,
  getSelectedQuoteIdForDeliveryMethod,
  getStationPickupQuotes,
  inferAddressLocationFromInput,
  isGatewayAmountDifferentFromOrderTotal,
  isKlumpUnavailableForGatewayAmount,
} from './utils';
import type { ShippingQuote } from './types';

function makeQuote(overrides: Partial<ShippingQuote>): ShippingQuote {
  return {
    id: 'quote-1',
    provider: 'GIGL',
    serviceTier: 'standard',
    carrierName: 'GIGL',
    displayName: 'GIGL Standard',
    estimatedDays: 3,
    price: 2500,
    currency: 'NGN',
    pickupIncluded: false,
    insuranceIncluded: false,
    ...overrides,
  };
}

describe('getDeliveryDateRange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns correct date range format from tomorrow to +3 days', () => {
    vi.setSystemTime(new Date('2026-02-08T12:00:00Z'));
    const result = getDeliveryDateRange();
    expect(result).toBe('9 Feb to 11 Feb');
  });

  it('handles month boundary correctly', () => {
    vi.setSystemTime(new Date('2026-01-29T12:00:00Z'));
    const result = getDeliveryDateRange();
    expect(result).toBe('30 Jan to 1 Feb');
  });

  it('handles year boundary correctly', () => {
    vi.setSystemTime(new Date('2025-12-30T12:00:00Z'));
    const result = getDeliveryDateRange();
    expect(result).toBe('31 Dec to 2 Jan');
  });
});

describe('CRYPTO_CHAIN_SUPPORT', () => {
  it('USDT supports all four chains', () => {
    expect(CRYPTO_CHAIN_SUPPORT.USDT).toEqual(['TRX', 'ETH', 'MATIC', 'AVAXC']);
  });

  it('USDC supports ETH, MATIC, and AVAXC chains', () => {
    expect(CRYPTO_CHAIN_SUPPORT.USDC).toEqual(['ETH', 'MATIC', 'AVAXC']);
  });
});

describe('CHAIN_DISPLAY_NAMES', () => {
  it('maps all four chains to display names', () => {
    expect(CHAIN_DISPLAY_NAMES.TRX).toBe('Tron (TRC-20)');
    expect(CHAIN_DISPLAY_NAMES.ETH).toBe('Ethereum (ERC-20)');
    expect(CHAIN_DISPLAY_NAMES.MATIC).toBe('Polygon');
    expect(CHAIN_DISPLAY_NAMES.AVAXC).toBe('Avalanche C-Chain');
  });
});

describe('CHAIN_EXPLORER_URLS', () => {
  it('maps all four chains to explorer URLs', () => {
    expect(CHAIN_EXPLORER_URLS.TRX).toBe('https://tronscan.org/#/address/');
    expect(CHAIN_EXPLORER_URLS.ETH).toBe('https://etherscan.io/address/');
    expect(CHAIN_EXPLORER_URLS.MATIC).toBe('https://polygonscan.com/address/');
    expect(CHAIN_EXPLORER_URLS.AVAXC).toBe('https://snowtrace.io/address/');
  });
});

describe('calculateDeliveryCost', () => {
  const mockQuotes: ShippingQuote[] = [
    {
      id: '1',
      provider: 'GIGL',
      serviceTier: 'standard',
      carrierName: 'GIGL',
      displayName: 'GIGL Standard',
      price: 3500,
      estimatedDays: 3,
      currency: 'NGN',
      pickupIncluded: false,
      insuranceIncluded: false,
    },
    {
      id: '2',
      provider: 'TOPSHIP',
      serviceTier: 'express',
      carrierName: 'Topship',
      displayName: 'Topship Express',
      price: 5000,
      estimatedDays: 1,
      currency: 'NGN',
      pickupIncluded: false,
      insuranceIncluded: false,
    },
  ];

  it('returns 0 for pickup delivery method', () => {
    const cost = calculateDeliveryCost('pickup', '', mockQuotes, 'delivery');
    expect(cost).toBe(0);
  });

  it('returns the station quote price for provider pickup stations', () => {
    const cost = calculateDeliveryCost(
      'pickup_station',
      'station-1',
      [
        ...mockQuotes,
        {
          id: 'station-1',
          provider: 'GIGL',
          serviceTier: 'station',
          carrierName: 'GIG Logistics',
          displayName: 'Pickup Stations (GIGL)',
          price: 4200,
          estimatedDays: 3,
          currency: 'NGN',
          pickupIncluded: true,
          insuranceIncluded: true,
          isStationPickup: true,
        },
      ],
      'delivery',
    );
    expect(cost).toBe(4200);
  });

  it('returns 0 for door delivery with no selected quote', () => {
    const cost = calculateDeliveryCost('door', '', mockQuotes, 'delivery');
    expect(cost).toBe(0);
  });

  it('returns quote price for door delivery with matching quote ID', () => {
    const cost = calculateDeliveryCost('door', '1', mockQuotes, 'delivery');
    expect(cost).toBe(3500);
  });

  it('returns correct price for different quote ID', () => {
    const cost = calculateDeliveryCost('door', '2', mockQuotes, 'delivery');
    expect(cost).toBe(5000);
  });

  it('returns 0 for door delivery with non-matching quote ID', () => {
    const cost = calculateDeliveryCost('door', '999', mockQuotes, 'delivery');
    expect(cost).toBe(0);
  });

  it('returns 35000 for airport delivery', () => {
    const cost = calculateDeliveryCost('airport', '', mockQuotes, 'delivery');
    expect(cost).toBe(35000);
  });

  it('returns 20000 for airport pickup', () => {
    const cost = calculateDeliveryCost('airport', '', mockQuotes, 'pickup');
    expect(cost).toBe(20000);
  });
});

describe('isGatewayAmountDifferentFromOrderTotal', () => {
  it('returns true when wallet credit reduces the payable gateway amount', () => {
    expect(isGatewayAmountDifferentFromOrderTotal(45_000, 50_000)).toBe(true);
  });

  it('returns true when the payable amount exceeds the order amount', () => {
    expect(isGatewayAmountDifferentFromOrderTotal(55_000, 50_000)).toBe(true);
  });

  it('returns false when the payable amount still matches the order amount', () => {
    expect(isGatewayAmountDifferentFromOrderTotal(50_000, 50_000)).toBe(false);
  });

  it('ignores sub-kobo rounding noise under the payment API threshold', () => {
    expect(isGatewayAmountDifferentFromOrderTotal(49_999.995, 50_000)).toBe(
      false,
    );
  });

  it('returns true at the payment API rejection threshold', () => {
    expect(isGatewayAmountDifferentFromOrderTotal(49_999.99, 50_000)).toBe(
      true,
    );
  });

  it('returns true for non-finite amounts', () => {
    expect(isGatewayAmountDifferentFromOrderTotal(Number.NaN, 50_000)).toBe(
      true,
    );
    expect(
      isGatewayAmountDifferentFromOrderTotal(
        Number.POSITIVE_INFINITY,
        50_000,
      ),
    ).toBe(true);
    expect(
      isGatewayAmountDifferentFromOrderTotal(
        Number.NEGATIVE_INFINITY,
        50_000,
      ),
    ).toBe(true);
    expect(
      isGatewayAmountDifferentFromOrderTotal(
        50_000,
        Number.POSITIVE_INFINITY,
      ),
    ).toBe(true);
  });
});

describe('isKlumpUnavailableForGatewayAmount', () => {
  it('returns true only for Klump gateway amount mismatches', () => {
    expect(
      isKlumpUnavailableForGatewayAmount({
        paymentMethod: 'klump',
        payableAmount: 45_000,
        orderAmount: 50_000,
      }),
    ).toBe(true);
    expect(
      isKlumpUnavailableForGatewayAmount({
        paymentMethod: 'paystack',
        payableAmount: 45_000,
        orderAmount: 50_000,
      }),
    ).toBe(false);
  });
});

describe('inferAddressLocationFromInput', () => {
  it('extracts city/state from a two-part address', () => {
    const result = inferAddressLocationFromInput('Lekki Phase 1, Lagos', [
      'Lagos',
      'Abuja',
    ]);
    expect(result).toEqual({ city: 'Lekki Phase 1', state: 'Lagos' });
  });

  it('extracts city/state from a full street, city, state address', () => {
    const result = inferAddressLocationFromInput(
      '12 Admiralty Way, Lekki, Lagos',
      ['Lagos', 'Abuja'],
    );
    expect(result).toEqual({ city: 'Lekki', state: 'Lagos' });
  });

  it('normalizes "State" suffix and matches configured shipping states', () => {
    const result = inferAddressLocationFromInput('Maitama, Abuja State', [
      'Lagos',
      'Abuja',
    ]);
    expect(result).toEqual({ city: 'Maitama', state: 'Abuja' });
  });

  it('matches Abuja aliases against configured FCT shipping state labels', () => {
    const result = inferAddressLocationFromInput('Maitama, Abuja', [
      'Lagos',
      'FCT - Abuja',
    ]);
    expect(result).toEqual({ city: 'Maitama', state: 'FCT - Abuja' });
  });

  it('strips trailing country tokens before inferring city/state', () => {
    const result = inferAddressLocationFromInput('Lekki, Lagos, Nigeria', [
      'Lagos',
      'Abuja',
    ]);
    expect(result).toEqual({ city: 'Lekki', state: 'Lagos' });
  });

  it('returns null when the trailing state is not configured for shipping', () => {
    const result = inferAddressLocationFromInput('Lekki, Lagos, Ghana', [
      'Lagos',
      'Abuja',
    ]);
    expect(result).toBeNull();
  });

  it('accepts the raw parsed city/state for markets with no subdivision list', () => {
    // Cameroon (CM) is outside the NG/IN/AE subdivision vocabulary, so the
    // checkout supplies an empty `shippingStates`. A typed two-part address
    // must still populate city/state so country-level merchant rates load.
    const result = inferAddressLocationFromInput('Douala, Littoral', []);

    expect(result).toEqual({ city: 'Douala', state: 'Littoral' });
  });

  it('accepts the raw city from a full street/city/state address with no list', () => {
    const result = inferAddressLocationFromInput(
      '15 Rue Joss, Douala, Littoral',
      [],
    );

    expect(result).toEqual({ city: 'Douala', state: 'Littoral' });
  });

  it('returns null for a single-segment address even with no subdivision list', () => {
    const result = inferAddressLocationFromInput('Douala', []);

    expect(result).toBeNull();
  });

  it('returns null when there are not enough address segments', () => {
    const result = inferAddressLocationFromInput('Lagos', ['Lagos']);
    expect(result).toBeNull();
  });

  it('strips a trailing India suffix and matches the IN subdivision list', () => {
    const result = inferAddressLocationFromInput(
      '12 MG Road, Mumbai, Maharashtra, India',
      ['Maharashtra', 'Karnataka'],
      'IN',
    );
    expect(result).toEqual({ city: 'Mumbai', state: 'Maharashtra' });
  });

  it('strips a trailing IN ISO code before matching the state segment', () => {
    const result = inferAddressLocationFromInput(
      '12 MG Road, Mumbai, Maharashtra, IN',
      ['Maharashtra', 'Karnataka'],
      'IN',
    );
    expect(result).toEqual({ city: 'Mumbai', state: 'Maharashtra' });
  });

  it('strips a trailing UAE suffix and matches the AE subdivision list', () => {
    const result = inferAddressLocationFromInput(
      'Sheikh Zayed Road, Dubai, Dubai, UAE',
      ['Dubai', 'Abu Dhabi'],
      'AE',
    );
    expect(result).toEqual({ city: 'Dubai', state: 'Dubai' });
  });

  it('strips the full "United Arab Emirates" country name suffix', () => {
    const result = inferAddressLocationFromInput(
      'Corniche, Abu Dhabi, Abu Dhabi, United Arab Emirates',
      ['Dubai', 'Abu Dhabi'],
      'AE',
    );
    expect(result).toEqual({ city: 'Abu Dhabi', state: 'Abu Dhabi' });
  });

  it('strips a dotted "U.A.E." country suffix and matches the AE subdivision list', () => {
    // The dotted acronym normalizes to `uae` (whitespace removed), matching the
    // compact `UAE` country token, so it is stripped instead of being treated
    // as the state — otherwise the AE subdivision match fails and the quote
    // gate never fires.
    const result = inferAddressLocationFromInput(
      'Sheikh Zayed Road, Dubai, Dubai, U.A.E.',
      ['Dubai', 'Abu Dhabi'],
      'AE',
    );
    expect(result).toEqual({ city: 'Dubai', state: 'Dubai' });
  });

  it('keeps a multi-word IN state name intact when stripping the country suffix', () => {
    // Country-token normalization removes whitespace, but state matching must
    // NOT: "West Bengal" has to stay `west bengal`, not collapse to
    // `westbengal`, so the configured subdivision still matches.
    const result = inferAddressLocationFromInput(
      'Salt Lake, Kolkata, West Bengal, India',
      ['West Bengal', 'Maharashtra'],
      'IN',
    );
    expect(result).toEqual({ city: 'Kolkata', state: 'West Bengal' });
  });

  it('keeps a multi-word NG state name intact when stripping the country suffix', () => {
    const result = inferAddressLocationFromInput(
      'Marina, Calabar, Cross River, Nigeria',
      ['Cross River', 'Lagos'],
      'NG',
    );
    expect(result).toEqual({ city: 'Calabar', state: 'Cross River' });
  });

  it('keeps NG parsing byte-identical when the merchant country is passed', () => {
    const result = inferAddressLocationFromInput(
      'Lekki, Lagos, Nigeria',
      ['Lagos', 'Abuja'],
      'NG',
    );
    expect(result).toEqual({ city: 'Lekki', state: 'Lagos' });
  });

  it('strips the merchant country name for a country-level market', () => {
    // Ghana (GH) has no subdivision vocabulary, so the checkout supplies an
    // empty `shippingStates`. Threading `merchantCountry` lets the parser strip
    // the trailing "Ghana" that the baseline (NG/IN/AE) set would not cover.
    const result = inferAddressLocationFromInput(
      'Osu, Accra, Ghana',
      [],
      'GH',
    );
    expect(result).toEqual({ city: 'Osu', state: 'Accra' });
  });

  it('does not strip an unsupported country suffix without a merchant country', () => {
    // Ghana is neither a subdivision market nor the resolved merchant country
    // here, so "Ghana" stays as the trailing segment and fails the NG match.
    const result = inferAddressLocationFromInput('Lekki, Lagos, Ghana', [
      'Lagos',
      'Abuja',
    ]);
    expect(result).toBeNull();
  });
});

describe('getForwardableSelectedQuoteId', () => {
  it('forwards a carrier quote id for door delivery', () => {
    expect(getForwardableSelectedQuoteId('door', 'quote-1')).toBe('quote-1');
  });

  it('forwards a carrier quote id for pickup station delivery', () => {
    expect(getForwardableSelectedQuoteId('pickup_station', 'station-1')).toBe(
      'station-1',
    );
  });

  it('omits a merchant-rate id on door delivery so the reuse route never 400s', () => {
    expect(
      getForwardableSelectedQuoteId(
        'door',
        'mrate_9f1b2c3d-0000-4000-8000-000000000009',
      ),
    ).toBeUndefined();
  });

  it('omits a merchant-rate id on pickup station delivery', () => {
    expect(
      getForwardableSelectedQuoteId(
        'pickup_station',
        'mrate_9f1b2c3d-0000-4000-8000-000000000009',
      ),
    ).toBeUndefined();
  });

  it('omits any id for pickup and airport methods', () => {
    expect(getForwardableSelectedQuoteId('pickup', 'quote-1')).toBeUndefined();
    expect(getForwardableSelectedQuoteId('airport', 'quote-1')).toBeUndefined();
  });

  it('omits an empty selection', () => {
    expect(getForwardableSelectedQuoteId('door', '')).toBeUndefined();
  });
});

describe('getStationPickupQuotes', () => {
  it('returns every station-pickup quote so multiple pickup locations stay selectable', () => {
    const quotes: ShippingQuote[] = [
      makeQuote({ id: 'door-1', isStationPickup: false }),
      makeQuote({
        id: 'mrate_pickup-a',
        provider: 'MERCHANT',
        serviceTier: 'pickup',
        isStationPickup: true,
      }),
      makeQuote({
        id: 'mrate_pickup-b',
        provider: 'MERCHANT',
        serviceTier: 'pickup',
        isStationPickup: true,
      }),
    ];

    expect(getStationPickupQuotes(quotes).map((quote) => quote.id)).toEqual([
      'mrate_pickup-a',
      'mrate_pickup-b',
    ]);
  });

  it('returns an empty array when there are no pickup quotes', () => {
    expect(
      getStationPickupQuotes([makeQuote({ id: 'door-1' })]),
    ).toEqual([]);
  });
});

describe('getSelectedQuoteIdForDeliveryMethod', () => {
  const doorQuote = makeQuote({ id: 'door-1', isStationPickup: false });
  const pickupA = makeQuote({
    id: 'mrate_pickup-a',
    provider: 'MERCHANT',
    serviceTier: 'pickup',
    isStationPickup: true,
  });
  const pickupB = makeQuote({
    id: 'mrate_pickup-b',
    provider: 'MERCHANT',
    serviceTier: 'pickup',
    isStationPickup: true,
  });
  const quotes = [doorQuote, pickupA, pickupB];

  it('keeps a matching non-station selection for door delivery', () => {
    expect(getSelectedQuoteIdForDeliveryMethod('door', 'door-1', quotes)).toBe(
      'door-1',
    );
  });

  it('falls back to the preferred door quote when door selection is a station', () => {
    expect(
      getSelectedQuoteIdForDeliveryMethod('door', 'mrate_pickup-a', quotes),
    ).toBe('door-1');
  });

  it('preserves an already-selected pickup location instead of resetting to the first', () => {
    expect(
      getSelectedQuoteIdForDeliveryMethod(
        'pickup_station',
        'mrate_pickup-b',
        quotes,
      ),
    ).toBe('mrate_pickup-b');
  });

  it('defaults to the first pickup when the current selection is not a pickup quote', () => {
    expect(
      getSelectedQuoteIdForDeliveryMethod('pickup_station', 'door-1', quotes),
    ).toBe('mrate_pickup-a');
  });
});
