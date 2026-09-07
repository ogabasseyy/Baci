import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shippingQuoteEnvTestMock } from '@/lib/shipping/shipping-quote-env.test-mock';
import {
  buildDomesticSenderBookingRequest,
  buildDomesticSenderSupabaseMock,
  domesticSenderShipmentInsertPayloads,
} from './route.domestic-sender.test-fixtures';

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>();
  return { ...actual, ...shippingQuoteEnvTestMock };
});

const mockCheckCsrfProtection = vi.fn();
const mockCookies = vi.fn();
const mockCreateClient = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();
const mockHasPermission = vi.fn();
const mockBookShipment = vi.fn();

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mockCheckCsrfProtection,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mockGetMerchantForApiRequest,
  toUserAccess: vi.fn((context: unknown) => context),
}));

vi.mock('@/lib/api-auth', () => ({
  hasPermission: mockHasPermission,
}));

vi.mock('@/lib/shipping', () => ({
  shippingService: {
    bookShipment: mockBookShipment,
    getProviderQuotes: vi.fn(),
  },
}));

describe('bugfix: ignore request-controlled domestic sender', () => {
  beforeEach(() => {
    domesticSenderShipmentInsertPayloads.length = 0;
    vi.clearAllMocks();
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
    mockCookies.mockResolvedValue({});
    mockCreateClient.mockReturnValue(buildDomesticSenderSupabaseMock());
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
      businessName: 'Merchant Store',
    });
    mockHasPermission.mockReturnValue(true);
    mockBookShipment.mockResolvedValue({
      provider: 'GIGL',
      providerShipmentId: 'GIGL-123',
      trackingNumber: 'GIGL-123',
      carrierName: 'GIG Logistics',
      status: 'booked',
      isStationPickup: true,
      pickupStationName: 'Lekki Service Centre',
      pickupStationAddress: '1 Admiralty Way, Lekki',
      rawResponse: { Waybill: 'GIGL-123' },
    });
  });

  it('books with the registered merchant sender when the request sender differs', async () => {
    const { POST } = await import('./route');

    const response = await POST(buildDomesticSenderBookingRequest());

    expect(response.status).toBe(201);
    expect(mockBookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        sender: expect.objectContaining({
          name: 'Registered Merchant Store',
          phone: '+2348012345678',
          city: 'Ikeja',
          state: 'Lagos',
          // The selected business address has no postal code; do not mix one
          // in from the separate registered-address source.
          postalCode: undefined,
        }),
      })
    );
    expect(mockBookShipment).not.toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        sender: expect.objectContaining({
          name: 'Merchant Store',
          address: '1 Merchant Road',
        }),
      })
    );
  });

  it('refreshes before booking when the stored domestic quote sender differs', async () => {
    const { shippingService } = await import('@/lib/shipping');
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        provider: 'GIGL',
        serviceTier: 'GoStandard',
        carrierName: 'GIG Logistics',
        displayName: 'GIG Logistics - GoStandard',
        price: 3200,
        currency: 'NGN',
        estimatedDays: 2,
        pickupIncluded: true,
        insuranceIncluded: false,
        providerRateId: 'GIGL_IKEJA_1',
        expiresAt: new Date('2099-01-02T00:00:00.000Z'),
        rawResponse: { refreshed: true },
      },
    ]);

    mockCreateClient.mockReturnValue(
      buildDomesticSenderSupabaseMock({
        service_tier: 'GoStandard',
        carrier_name: 'GIG Logistics',
        provider_rate_id: 'GIGL_LAGOS_OLD',
        quote_request: {
          shipmentType: 'domestic',
          sessionId: 'session-old',
          sender: {
            name: 'Caller Sender',
            phone: '+2348011111111',
            address: '1 Merchant Road, Lagos, Lagos',
            city: 'Lagos',
            state: 'Lagos',
            country: 'Nigeria',
            countryCode: 'NG',
          },
          receiver: {
            name: 'Jane Customer',
            phone: '+2348022222222',
            address: '123 Queen Street West',
            city: 'Toronto',
            state: 'Ontario',
            country: 'Canada',
            countryCode: 'CA',
            postalCode: 'M5V 3L9',
          },
          items: [
            {
              name: 'Phone',
              quantity: 1,
              weight: 1,
              value: 500000,
              hsCode: '851712',
              length: 10,
              width: 8,
              height: 6,
            },
          ],
        },
      })
    );

    const { POST } = await import('./route');
    const response = await POST(buildDomesticSenderBookingRequest());

    expect(response.status).toBe(201);
    expect(shippingService.getProviderQuotes).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        sender: expect.objectContaining({
          city: 'Ikeja',
          state: 'Lagos',
        }),
      })
    );
    expect(mockBookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        quoteId: '33333333-3333-4333-8333-333333333333',
        providerRateId: 'GIGL_IKEJA_1',
        sender: expect.objectContaining({
          city: 'Ikeja',
          state: 'Lagos',
        }),
      })
    );
  });

  it('refreshes an expired domestic quote before booking', async () => {
    const { shippingService } = await import('@/lib/shipping');
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        provider: 'GIGL',
        serviceTier: 'GoStandard',
        carrierName: 'GIG Logistics',
        displayName: 'GIG Logistics - GoStandard',
        price: 4500,
        currency: 'NGN',
        estimatedDays: 2,
        pickupIncluded: true,
        insuranceIncluded: false,
        providerRateId: 'GIGL_LAGOS_OLD',
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        rawResponse: { refreshed: true },
      },
    ]);

    mockCreateClient.mockReturnValue(
      buildDomesticSenderSupabaseMock({
        service_tier: 'GoStandard',
        carrier_name: 'GIG Logistics',
        provider_rate_id: 'GIGL_LAGOS_OLD',
        expires_at: '2020-01-01T00:00:00.000Z',
        quote_request: {
          shipmentType: 'domestic',
          sessionId: 'session-old',
          sender: {
            name: 'Registered Merchant Store',
            phone: '+2348012345678',
            address: '9 Registered Road, Ikeja, Lagos',
            city: 'Ikeja',
            state: 'Lagos',
            country: 'Nigeria',
            countryCode: 'NG',
          },
          receiver: {
            name: 'Jane Customer',
            phone: '+2348022222222',
            address: '123 Queen Street West',
            city: 'Toronto',
            state: 'Ontario',
            country: 'Canada',
            countryCode: 'CA',
            postalCode: 'M5V 3L9',
          },
          items: [
            {
              name: 'Phone',
              quantity: 1,
              weight: 1,
              value: 500000,
              hsCode: '851712',
              length: 10,
              width: 8,
              height: 6,
            },
          ],
        },
      })
    );

    const { POST } = await import('./route');
    const response = await POST(buildDomesticSenderBookingRequest());

    expect(response.status).toBe(201);
    expect(shippingService.getProviderQuotes).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({ sessionId: expect.any(String) })
    );
    expect(mockBookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        quoteId: '33333333-3333-4333-8333-333333333333',
      })
    );
  });
});
