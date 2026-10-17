import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shippingService } from '@/lib/shipping';
import {
  buildGiglProviderRateId,
  GiglDeliveryType,
  PickupOptions,
  VehicleType,
} from './providers/gigl.constants';
import type { OrderShipmentQuoteRecord } from './refresh-order-shipment-quote';
import { validateSavedGiglCheckoutQuote } from './validate-saved-gigl-checkout-quote';

vi.mock('@/lib/shipping', () => ({
  shippingService: { getProviderQuotes: vi.fn() },
}));
const sender = {
  name: 'Shop',
  phone: '08000000000',
  address: '1 Shop Road',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};
const request = {
  sessionId: 'session',
  shipmentType: 'domestic' as const,
  sender,
  receiver: {
    ...sender,
    address: '2 Buyer Road',
    latitude: 6.5,
    longitude: 3.3,
  },
  items: [{ name: 'Phone', quantity: 1, weight: 1, value: 5000 }],
};
const quote: OrderShipmentQuoteRecord = {
  id: 'saved',
  merchant_id: 'merchant',
  provider: 'GIGL',
  service_tier: 'GoStandard',
  carrier_name: 'GIG Logistics',
  price: 1100,
  currency: 'NGN',
  estimated_days: 3,
  provider_rate_id: 'GIGL_4_0',
  expires_at: '2020-01-01T00:00:00Z',
  quote_request: request,
  provider_metadata: null,
  provider_cost: 1000,
  platform_margin: 100,
  platform_margin_bps: 1000,
  pricing_version: 'gigl_platform_margin_v1',
};
const fresh = {
  id: 'new',
  provider: 'GIGL' as const,
  serviceTier: 'GoStandard',
  carrierName: 'GIG Logistics',
  displayName: 'GIG Logistics',
  price: 1100,
  currency: 'NGN',
  providerCost: 1000,
  platformMargin: 100,
  marginBasisPoints: 1000,
  pricingVersion: 'gigl_platform_margin_v1',
  estimatedDays: 3,
  pickupIncluded: true,
  insuranceIncluded: false,
  providerRateId: 'GIGL_4_0',
  expiresAt: new Date('2099-01-01'),
  rawResponse: {},
};
describe('saved paid GIG quote validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([fresh]);
  });
  it.each([
    '2020-01-01',
    '2099-01-01',
  ])('checks current prices and reuses the exact saved quote with expiry %s', async (expiry) => {
    const saved = { ...quote, expires_at: expiry };
    expect(await validateSavedGiglCheckoutQuote(saved, sender, 1100)).toBe(
      saved
    );
    expect(shippingService.getProviderQuotes).toHaveBeenCalledOnce();
  });
  it.each([
    { price: 1101 },
    { providerCost: 999 },
    { serviceTier: 'GoFaster' },
    { providerRateId: 'GIGL_5_0' },
    { currency: 'USD' },
  ])('requires confirmation before changing tariff or service %j', async (change) => {
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([
      { ...fresh, ...change },
    ]);
    await expect(
      validateSavedGiglCheckoutQuote(quote, sender, 1100)
    ).rejects.toMatchObject({
      code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED',
      status: 409,
    });
  });
  it.each([
    5,
    undefined,
  ])('requires consent when explicit saved origin station4 changes to %s', async (senderStationId) => {
    const service = {
      receiverStationId: 30,
      pickupOption: PickupOptions.HomeDelivery,
      vehicleType: VehicleType.Bike,
      deliveryType: GiglDeliveryType.GoStandard,
    };
    const saved = {
      ...quote,
      provider_rate_id: buildGiglProviderRateId({
        ...service,
        senderStationId: 4,
      }),
    };
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([
      {
        ...fresh,
        providerRateId: buildGiglProviderRateId({
          ...service,
          senderStationId,
        }),
      },
    ]);
    await expect(
      validateSavedGiglCheckoutQuote(saved, sender, 1100)
    ).rejects.toMatchObject({
      code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED',
      status: 409,
    });
  });
  it('accepts a legacy saved rate without an origin station when current effective service matches', async () => {
    const service = {
      receiverStationId: 30,
      pickupOption: PickupOptions.HomeDelivery,
      vehicleType: VehicleType.Bike,
      deliveryType: GiglDeliveryType.GoStandard,
    };
    const saved = {
      ...quote,
      provider_rate_id: buildGiglProviderRateId(service),
    };
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([
      {
        ...fresh,
        providerRateId: buildGiglProviderRateId({
          ...service,
          senderStationId: 4,
        }),
      },
    ]);
    expect(await validateSavedGiglCheckoutQuote(saved, sender, 1100)).toBe(
      saved
    );
  });
  it('reports unavailable pricing without claiming that details changed', async () => {
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([]);
    await expect(
      validateSavedGiglCheckoutQuote(quote, sender, 1100)
    ).rejects.toMatchObject({ code: 'QUOTE_REFRESH_FAILED', status: 409 });
  });
  it('rejects a saved quote bound to a different provider before fetching', async () => {
    await expect(
      validateSavedGiglCheckoutQuote(
        { ...quote, provider: 'TOPSHIP' },
        sender,
        1100
      )
    ).rejects.toMatchObject({ code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED' });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
  });
  it('requires confirmation for changed origin before requesting any tariff', async () => {
    await expect(
      validateSavedGiglCheckoutQuote(
        quote,
        { ...sender, address: 'New origin' },
        1100
      )
    ).rejects.toMatchObject({ code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED' });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
  });
});
