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
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
  provider_rate_id: 'GIGL_4_0_1_0_0_4',
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
  providerRateId: 'GIGL_4_0_1_0_0_4',
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
    { serviceTier: 'GoFaster', providerRateId: 'GIGL_4_0_1_0_1_4' },
    { providerRateId: 'GIGL_5_0_1_0_0_4' },
    { currency: 'USD' },
    { pricingVersion: 'gigl_platform_margin_v2' },
  ])('requires confirmation before changing service, currency or pricing version %j', async (change) => {
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
    { service_tier: 'standard' },
    { carrier_name: 'GIGL' },
    {
      service_tier: 'Legacy standard delivery',
      carrier_name: 'Old carrier label',
    },
  ])('preserves the saved quote when full rate identity is unchanged despite labels %j', async (labels) => {
    const providerRateId = buildGiglProviderRateId({
      senderStationId: 4,
      receiverStationId: 30,
      pickupOption: PickupOptions.HomeDelivery,
      vehicleType: VehicleType.Bike,
      deliveryType: GiglDeliveryType.GoStandard,
    });
    const saved = { ...quote, ...labels, provider_rate_id: providerRateId };
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([
      { ...fresh, providerRateId },
    ]);
    expect(await validateSavedGiglCheckoutQuote(saved, sender, 1100)).toBe(
      saved
    );
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
  it.each([
    { pricing_version: null },
    { provider_cost: null },
    { quote_request: null },
  ])('requires explicit recovery rather than silently rebuilding untrusted legacy data %j', async (legacy) => {
    await expect(
      validateSavedGiglCheckoutQuote({ ...quote, ...legacy }, sender, 1100)
    ).rejects.toMatchObject({
      code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED',
      status: 409,
    });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
  });
  it.each([
    'GIGL_4_9_1_0_0_4',
    'GIGL_4_0_1_0_9_4',
    'GIGL_9007199254740993_0_1_0_0_4',
    ' GIGL_4_0_1_0_0_4',
    'GIGL_4_0_1_0_0_4 ',
  ])('requires recovery before fetching prices for unverified raw saved rate %s', async (provider_rate_id) => {
    await expect(
      validateSavedGiglCheckoutQuote(
        { ...quote, provider_rate_id },
        sender,
        1100
      )
    ).rejects.toMatchObject({
      code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED',
      status: 409,
    });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
  });
  it.each([
    1000,
    '1100.01',
    null,
    undefined,
    '',
  ])('requires recovery before fetching when the order shipping fee %j differs from the saved quote price', async (expectedFee) => {
    await expect(
      validateSavedGiglCheckoutQuote(quote, sender, expectedFee)
    ).rejects.toMatchObject({
      code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED',
      status: 409,
    });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
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
  it.each([
    '+23415781',
    '',
    '0800000',
  ])('bugfix: refuses before any GIG call when the current sender phone %j is unusable', async (phone) => {
    await expect(
      validateSavedGiglCheckoutQuote(quote, { ...sender, phone }, 1100)
    ).rejects.toMatchObject({ code: 'MERCHANT_SENDER_REQUIRED', status: 409 });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
  });
  it.each([
    { name: 'Different Shop' },
    { phone: '08000000001' },
  ])('bugfix: books at the paid price when only the sender name or phone changed %j', async (changed) => {
    expect(
      await validateSavedGiglCheckoutQuote(
        quote,
        { ...sender, ...changed },
        1100
      )
    ).toBe(quote);
    expect(shippingService.getProviderQuotes).toHaveBeenCalledOnce();
  });
  it('bugfix: does not require a valid saved sender phone, which GIG does not price on', async () => {
    const saved = {
      ...quote,
      quote_request: { ...request, sender: { ...sender, phone: '+23450642' } },
    };
    expect(await validateSavedGiglCheckoutQuote(saved, sender, 1100)).toBe(
      saved
    );
  });
  it.each([
    { city: 'Abuja', state: 'FCT' },
    { postalCode: '100001' },
  ])('still requires confirmation when the pickup location changed %j', async (changed) => {
    await expect(
      validateSavedGiglCheckoutQuote(quote, { ...sender, ...changed }, 1100)
    ).rejects.toMatchObject({ code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED' });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
  });
  it('accepts equivalent sender name casing and phone formatting', async () => {
    expect(
      await validateSavedGiglCheckoutQuote(
        quote,
        { ...sender, name: '  SHOP ', phone: '+234 800 000 0000' },
        1100
      )
    ).toBe(quote);
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
  it.each([
    { providerCost: 900, price: 990, platformMargin: 90 },
    { providerCost: 1100, price: 1210, platformMargin: 110 },
    { providerCost: 1050, price: 1155, platformMargin: 105 },
  ])('bugfix: books the original paid quote when GIG now costs no more than the customer paid %j', async (live) => {
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([
      { ...fresh, ...live },
    ]);
    const result = await validateSavedGiglCheckoutQuote(quote, sender, 1100);
    expect(result).toBe(quote);
    expect(result).toMatchObject({ id: 'saved', price: 1100 });
  });
  it('refuses with an explicit code and only the paid price when GIG now costs more than the customer paid', async () => {
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([
      { ...fresh, providerCost: 1250, price: 1375, platformMargin: 125 },
    ]);
    await expect(
      validateSavedGiglCheckoutQuote(quote, sender, 1100)
    ).rejects.toMatchObject({
      code: 'GIGL_COST_EXCEEDS_CUSTOMER_PAID',
      status: 409,
      message:
        "GIG's current price for this delivery is higher than the ₦1,100 the customer paid. No booking was made.",
    });
  });
});
