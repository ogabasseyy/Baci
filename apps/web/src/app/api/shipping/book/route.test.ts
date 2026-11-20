import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildBookingRequest,
  buildSupabaseMock,
  shipmentInsertPayloads,
} from './route.test-helpers';

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

describe('POST /api/shipping/book', () => {
  beforeEach(() => {
    shipmentInsertPayloads.length = 0;
    vi.clearAllMocks();
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
    mockCookies.mockResolvedValue({});
    mockCreateClient.mockReturnValue(buildSupabaseMock());
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

  it('persists station-pickup metadata returned by the provider booking', async () => {
    const { POST } = await import('./route');

    const response = await POST(buildBookingRequest());

    expect(response.status).toBe(201);
    expect(shipmentInsertPayloads[0]).toEqual(
      expect.objectContaining({
        is_station_pickup: true,
        station_name: 'Lekki Service Centre',
        station_address: '1 Admiralty Way, Lekki',
      })
    );
  });

  it('passes sanitized Topship metadata when booking a submitted quote before order selection', async () => {
    const supabase = buildSupabaseMock({
      selectedQuoteId: null,
      provider: 'TOPSHIP',
      bookingMetadata: {
        pricingTier: 'Premium',
        serviceType: 'Express',
        cost: 12500,
      },
    });
    mockCreateClient.mockReturnValue(supabase);
    mockBookShipment.mockResolvedValueOnce({
      provider: 'TOPSHIP',
      providerShipmentId: 'TOPSHIP-123',
      trackingNumber: 'TOPSHIP-123',
      carrierName: 'Topship',
      status: 'booked',
      rawResponse: { id: 'TOPSHIP-123' },
    });

    const { POST } = await import('./route');
    const response = await POST(buildBookingRequest());

    expect(response.status).toBe(201);
    expect(mockBookShipment).toHaveBeenCalledWith(
      'TOPSHIP',
      expect.objectContaining({
        quoteId: '22222222-2222-4222-8222-222222222222',
        quoteMetadata: {
          pricingTier: 'Premium',
          serviceType: 'Express',
          cost: 12500,
        },
      })
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_shipping_quote_booking_metadata',
      {
        p_merchant_id: 'merchant-1',
        p_order_id: '11111111-1111-4111-8111-111111111111',
        p_quote_id: '22222222-2222-4222-8222-222222222222',
      }
    );
  });

  it('returns 403 without booking when the merchant cannot fulfill orders', async () => {
    mockHasPermission.mockReturnValue(false);
    const { POST } = await import('./route');

    const response = await POST(buildBookingRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
    expect(mockBookShipment).not.toHaveBeenCalled();
    expect(shipmentInsertPayloads).toEqual([]);
  });
});
