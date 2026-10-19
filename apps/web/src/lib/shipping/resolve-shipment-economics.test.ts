import { describe, expect, it } from 'vitest';
import { resolveShipmentEconomics } from './resolve-shipment-economics';

const quote = {
  id: 'quote-1',
  merchant_id: 'merchant-1',
  provider: 'GIGL',
  service_tier: 'standard',
  carrier_name: 'GIG Logistics',
  price: 1100,
  currency: 'NGN',
  estimated_days: 3,
  provider_rate_id: 'rate-1',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  quote_request: null,
  provider_metadata: null,
};

describe('resolveShipmentEconomics', () => {
  it('uses the protected order snapshot when quote economics are not selectable', () => {
    expect(
      resolveShipmentEconomics('GIGL', quote, {
        shipping_provider_cost: '1000.00',
        shipping_platform_margin: 100,
        shipping_pricing_version: 'gigl_platform_margin_v1',
      })
    ).toEqual({ provider_cost: 1000, platform_margin: 100 });
  });

  it('uses complete fresh server quote economics ahead of the older order snapshot', () => {
    expect(
      resolveShipmentEconomics(
        'GIGL',
        {
          ...quote,
          provider_cost: 900,
          platform_margin: 90,
          pricing_version: 'gigl_platform_margin_v1',
        },
        {
          shipping_provider_cost: 1000,
          shipping_platform_margin: 100,
          shipping_pricing_version: 'gigl_platform_margin_v1',
        }
      )
    ).toEqual({ provider_cost: 900, platform_margin: 90 });
  });

  it('clears economics for non-GIGL or invalid snapshots', () => {
    expect(
      resolveShipmentEconomics('TOPSHIP', quote, {
        shipping_provider_cost: 1000,
        shipping_platform_margin: 100,
        shipping_pricing_version: 'gigl_platform_margin_v1',
      })
    ).toEqual({ provider_cost: null, platform_margin: null });
    expect(
      resolveShipmentEconomics('GIGL', quote, {
        shipping_provider_cost: 'not-a-number',
        shipping_platform_margin: -1,
        shipping_pricing_version: 'gigl_platform_margin_v1',
      })
    ).toEqual({ provider_cost: null, platform_margin: null });
  });
});
