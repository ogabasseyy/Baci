import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildInternationalBookingRequest,
  buildInternationalSupabaseMock,
} from './route.international.test-fixtures';

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
  },
}));

describe('POST /api/shipping/book GIGL international guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
    mockCookies.mockResolvedValue({});
    mockCreateClient.mockReturnValue(buildInternationalSupabaseMock());
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
      businessName: 'Merchant Store',
    });
    mockHasPermission.mockReturnValue(true);
  });

  it('rejects a saved international quote that no longer matches the order', async () => {
    const { POST } = await import('./route');

    const response = await POST(buildInternationalBookingRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        'The saved international shipping quote no longer matches this order. Please get a new quote before shipping.',
      code: 'INTERNATIONAL_QUOTE_ORDER_MISMATCH',
    });
    expect(mockBookShipment).not.toHaveBeenCalled();
  });

  it('rejects quote IDs that are not selected on the merchant order', async () => {
    mockCreateClient.mockReturnValue(
      buildInternationalSupabaseMock({
        selectedQuoteId: '33333333-3333-4333-8333-333333333333',
      })
    );
    const { POST } = await import('./route');

    const response = await POST(buildInternationalBookingRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Quote does not match order',
    });
    expect(mockBookShipment).not.toHaveBeenCalled();
  });

  it('books GIGL international shipments with the saved quote sender', async () => {
    mockCreateClient.mockReturnValue(
      buildInternationalSupabaseMock({ matchingDestination: true })
    );
    mockBookShipment.mockResolvedValue({
      provider: 'GIGL',
      providerShipmentId: 'provider-1',
      trackingNumber: 'GIGL-TRACK-1',
      carrierName: 'GIG Logistics',
      status: 'processing',
    });
    const { POST } = await import('./route');

    const response = await POST(buildInternationalBookingRequest());

    expect(response.status).toBe(201);
    expect(mockBookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        receiver: expect.objectContaining({
          name: 'Jane Customer',
          phone: '+14165550123',
          country: 'Canada',
          countryCode: 'CA',
        }),
        sender: expect.objectContaining({
          name: 'Quoted Merchant Store',
          address: '7 Quoted Origin',
          phone: '+2348099999999',
        }),
      })
    );
  });

  it('allows direct booking to bind a valid quote when the order has no saved quote', async () => {
    mockCreateClient.mockReturnValue(
      buildInternationalSupabaseMock({
        matchingDestination: true,
        selectedQuoteId: null,
      })
    );
    mockBookShipment.mockResolvedValue({
      provider: 'GIGL',
      providerShipmentId: 'provider-1',
      trackingNumber: 'GIGL-TRACK-1',
      carrierName: 'GIG Logistics',
      status: 'processing',
    });
    const { POST } = await import('./route');

    const response = await POST(buildInternationalBookingRequest());

    expect(response.status).toBe(201);
    expect(mockBookShipment).toHaveBeenCalledOnce();
  });

  it('does not require a current merchant origin for a stored international quote', async () => {
    mockCreateClient.mockReturnValue(
      buildInternationalSupabaseMock({
        matchingDestination: true,
        merchantSenderAvailable: false,
      })
    );
    mockBookShipment.mockResolvedValue({
      provider: 'GIGL',
      providerShipmentId: 'provider-1',
      trackingNumber: 'GIGL-TRACK-1',
      carrierName: 'GIG Logistics',
      status: 'processing',
    });
    const { POST } = await import('./route');

    const response = await POST(buildInternationalBookingRequest());

    expect(response.status).toBe(201);
    expect(mockBookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        sender: expect.objectContaining({
          address: '7 Quoted Origin',
          countryCode: 'NG',
        }),
      })
    );
  });

  it('rejects an international quote whose stored sender is missing', async () => {
    mockCreateClient.mockReturnValue(
      buildInternationalSupabaseMock({
        matchingDestination: true,
        storedSenderAvailable: false,
      })
    );
    const { POST } = await import('./route');

    const response = await POST(buildInternationalBookingRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        'The saved international shipping quote is missing its sender. Please get a new quote before shipping.',
      code: 'INTERNATIONAL_QUOTE_SENDER_MISSING',
    });
    expect(mockBookShipment).not.toHaveBeenCalled();
  });
});
