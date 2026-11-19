import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProviderBookingTimeoutError,
  tagProviderCallError,
} from '@/lib/shipping/order-shipment-booking-failure';
import { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';
import {
  buildBookingRequest,
  buildSupabaseMock,
  failureInsertPayloads,
  shipmentInsertPayloads,
} from './route.test-helpers';

const mockCheckCsrfProtection = vi.fn();
const mockCookies = vi.fn();
const mockCreateClient = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();
const mockHasPermission = vi.fn();
const mockBookShipment = vi.fn();

vi.mock('next/headers', () => ({ cookies: mockCookies }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mockCheckCsrfProtection }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mockCreateClient }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mockGetMerchantForApiRequest,
  toUserAccess: vi.fn((context: unknown) => context),
}));
vi.mock('@/lib/api-auth', () => ({ hasPermission: mockHasPermission }));
vi.mock('@/lib/shipping', () => ({
  shippingService: {
    bookShipment: mockBookShipment,
    getProviderQuotes: vi.fn(),
  },
}));

function unreachableError() {
  // shippingService is mocked, so tag the error as the real service would.
  const error = Object.assign(new Error('fetch failed'), {
    code: 'ECONNREFUSED',
  });
  tagProviderCallError(error);
  return error;
}

describe('bugfix: POST /api/shipping/book records the real failure and lock state', () => {
  beforeEach(() => {
    shipmentInsertPayloads.length = 0;
    failureInsertPayloads.length = 0;
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
    mockCookies.mockResolvedValue({});
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
      businessName: 'Merchant Store',
    });
    mockHasPermission.mockReturnValue(true);
  });

  it('releases the lock and records not_submitted when the provider is unreachable', async () => {
    mockCreateClient.mockReturnValue(buildSupabaseMock());
    mockBookShipment.mockRejectedValue(unreachableError());
    const { POST } = await import('./route');

    const response = await POST(buildBookingRequest() as NextRequest);

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('PROVIDER_UNREACHABLE');
    expect(failureInsertPayloads).toEqual([
      expect.objectContaining({
        outcome: 'not_submitted',
        error_code: 'PROVIDER_UNREACHABLE',
        lock_retained: false,
      }),
    ]);
  });

  it('records lock_retained true when releasing the lock fails after an unreachable provider', async () => {
    mockCreateClient.mockReturnValue(
      buildSupabaseMock({ lockReleaseError: { message: 'db down' } })
    );
    mockBookShipment.mockRejectedValue(unreachableError());
    const { POST } = await import('./route');

    const response = await POST(buildBookingRequest() as NextRequest);

    expect(response.status).toBe(503);
    expect(failureInsertPayloads).toEqual([
      expect.objectContaining({
        outcome: 'not_submitted',
        lock_retained: true,
      }),
    ]);
  });

  it('keeps the lock and records booked_not_saved when the booked shipment cannot be saved', async () => {
    mockCreateClient.mockReturnValue(
      buildSupabaseMock({ shipmentInsertError: { message: 'insert failed' } })
    );
    mockBookShipment.mockResolvedValue({
      provider: 'GIGL',
      providerShipmentId: 'GIGL-123',
      trackingNumber: 'GIGL-123',
      carrierName: 'GIG Logistics',
      status: 'booked',
      rawResponse: { Waybill: 'GIGL-123' },
    });
    const { POST } = await import('./route');

    const response = await POST(buildBookingRequest() as NextRequest);

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect((await response.json()).code).toBe('BOOKED_SHIPMENT_NOT_SAVED');
    expect(failureInsertPayloads).toEqual([
      expect.objectContaining({
        outcome: 'booked_not_saved',
        lock_retained: true,
      }),
    ]);
  });

  it('bugfix: records lock_retained true when the final cleanup fails for a pre-provider refusal that is not on the release list', async () => {
    mockCreateClient.mockReturnValue(
      buildSupabaseMock({ lockReleaseError: { message: 'db down' } })
    );
    mockBookShipment.mockRejectedValue(
      new OrderShipmentBookingError(
        'Quote does not belong to this order',
        409,
        'DOMESTIC_QUOTE_ORDER_MISMATCH'
      )
    );
    const { POST } = await import('./route');

    await POST(buildBookingRequest() as NextRequest);

    expect(failureInsertPayloads).toEqual([
      expect.objectContaining({
        error_code: 'DOMESTIC_QUOTE_ORDER_MISMATCH',
        lock_retained: true,
      }),
    ]);
  });

  it('bugfix: records lock_retained false and no pause promise when no booking lock could be acquired', async () => {
    mockCreateClient.mockReturnValue(
      buildSupabaseMock({ claimUnavailable: true })
    );
    mockBookShipment.mockRejectedValue(
      new ProviderBookingTimeoutError('GIGL booking timed out')
    );
    const { POST } = await import('./route');

    const response = await POST(buildBookingRequest() as NextRequest);

    expect(response.status).toBe(503);
    expect((await response.json()).error).not.toMatch(/15 minutes/);
    expect(failureInsertPayloads).toEqual([
      expect.objectContaining({
        outcome: 'provider_unconfirmed',
        lock_retained: false,
      }),
    ]);
  });
});
