import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  giglBookingEconomicsProjection,
  giglQuoteEconomicsFields,
  prepaidGiglCustomerCheckoutOrderFields,
} from './route.test-fixtures';

const mockCheckCsrfProtection = vi.fn();
const mockCookies = vi.fn();
const mockCreateClient = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();
const mockHasPermission = vi.fn();
const mockBookShipment = vi.fn();

vi.mock('next/headers', () => ({ cookies: mockCookies }));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mockCheckCsrfProtection,
}));
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

const orderId = '11111111-1111-4111-8111-111111111111';
const quoteId = '22222222-2222-4222-8222-222222222222';

function mutationQuery(result: { error: unknown }) {
  return Object.assign(Promise.resolve(result), {
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({
        data: result.error ? null : { id: 'order-1' },
        error: result.error,
      }),
    }),
  });
}

function buildSupabaseMock(options: { respectRetainedLock?: boolean } = {}) {
  let claimCount = 0;
  let lockHeld = false;
  let orderUpdateCount = 0;
  let shipmentInsertCount = 0;

  const order = {
    id: orderId,
    merchant_id: 'merchant-1',
    selected_quote_id: quoteId,
    ...prepaidGiglCustomerCheckoutOrderFields,
    shipping_status: 'pending',
    shipping_fee: 4500,
    shipping_address: null,
    order_items: [{ name: 'Phone', quantity: 1, price: 500000 }],
  };
  const quote = {
    id: quoteId,
    merchant_id: 'merchant-1',
    provider: 'GIGL',
    service_tier: 'GoStandard',
    carrier_name: 'GIG Logistics',
    provider_rate_id: 'GIGL_RATE_1',
    provider_metadata: {},
    quote_request: null,
    expires_at: '2099-01-01T00:00:00.000Z',
    price: 4500,
    currency: 'NGN',
    estimated_days: 2,
    ...giglQuoteEconomicsFields,
  };
  const savedShipment = {
    id: 'shipment-1',
    provider: 'GIGL',
    provider_shipment_id: 'GIGL-123',
    tracking_number: 'GIGL-123',
    carrier_name: 'GIG Logistics',
    estimated_delivery_days: 2,
    label_url: null,
    pickup_scheduled_at: null,
    status: 'booked',
  };

  const supabase = {
    rpc: vi.fn().mockImplementation((name: string) => {
      if (name === 'get_shipping_quote_booking_metadata') {
        return Promise.resolve({ data: null, error: null });
      }
      if (name === 'get_shipping_quote_booking_economics') {
        return Promise.resolve({
          data: giglBookingEconomicsProjection,
          error: null,
        });
      }
      claimCount += 1;
      const blockedByRetainedLock = Boolean(
        options.respectRetainedLock && claimCount > 1 && lockHeld
      );
      if (!blockedByRetainedLock) lockHeld = true;
      return Promise.resolve({
        data: [
          {
            claimed: !blockedByRetainedLock,
            shipment_id: null,
            tracking_number: null,
          },
        ],
        error: null,
      });
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: order, error: null }),
          })),
          update: vi.fn((values: Record<string, unknown>) => {
            if (
              'shipment_booking_lock_token' in values &&
              !('shipment_id' in values)
            ) {
              lockHeld = false;
              return mutationQuery({ error: null });
            }
            orderUpdateCount += 1;
            return mutationQuery({
              error:
                orderUpdateCount === 1
                  ? { message: 'simulated order persistence failure' }
                  : null,
            });
          }),
        };
      }
      if (table === 'shipping_quotes') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: quote, error: null }),
          })),
          update: vi.fn(() => mutationQuery({ error: null })),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === 'shipments') {
        return {
          insert: vi.fn(() => {
            shipmentInsertCount += 1;
            return {
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'shipment-1' },
                  error: null,
                }),
              })),
            };
          }),
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: shipmentInsertCount > 0 ? savedShipment : null,
              error: null,
            }),
          })),
        };
      }
      if (table === 'merchants') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                business_name: 'Merchant Store',
                business_address: '9 Registered Road, Ikeja, Lagos',
                phone: '+2348012345678',
                registered_address: null,
                state_code: 'LA',
              },
              error: null,
            }),
          })),
        };
      }
      if (table === 'merchant_settlements') {
        const eqSourceId = vi.fn().mockResolvedValue({
          data: [
            {
              metadata: {
                retained_shipping_amount:
                  giglBookingEconomicsProjection.shipping_platform_retained_amount,
              },
              status: 'completed',
            },
          ],
          error: null,
        });
        const eqSourceType = vi.fn(() => ({ eq: eqSourceId }));
        const eqMerchant = vi.fn(() => ({ eq: eqSourceType }));
        return {
          select: vi.fn(() => ({ eq: eqMerchant })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { supabase, getShipmentInsertCount: () => shipmentInsertCount };
}

function buildRequest(): NextRequest {
  return new Request('https://usebaci.com/api/shipping/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId,
      carrierId: 'GIGL',
      quoteId,
      receiver: {
        name: 'Customer',
        phone: '+2348111111111',
        address: '2 Customer Road',
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
        countryCode: 'NG',
      },
      items: [{ name: 'Phone', quantity: 1, weight: 1, value: 500000 }],
    }),
  }) as unknown as NextRequest;
}

describe('POST /api/shipping/book idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
    mockCookies.mockResolvedValue({});
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
      rawResponse: {},
    });
  });

  it('recovers a persisted provider booking after order persistence fails', async () => {
    const { supabase, getShipmentInsertCount } = buildSupabaseMock();
    mockCreateClient.mockReturnValue(supabase);
    const { POST } = await import('./route');

    const firstResponse = await POST(buildRequest());
    const retryResponse = await POST(buildRequest());

    expect(firstResponse.status).toBe(500);
    expect(retryResponse.status).toBe(201);
    expect(mockBookShipment).toHaveBeenCalledOnce();
    expect(getShipmentInsertCount()).toBe(1);
  });

  it('does not call the provider again after an unknown provider failure', async () => {
    const { supabase } = buildSupabaseMock({ respectRetainedLock: true });
    mockCreateClient.mockReturnValue(supabase);
    mockBookShipment.mockRejectedValue(new Error('provider timeout'));
    const { POST } = await import('./route');

    const firstResponse = await POST(buildRequest());
    const retryResponse = await POST(buildRequest());

    expect(firstResponse.status).toBe(500);
    expect(retryResponse.status).toBe(409);
    await expect(retryResponse.json()).resolves.toMatchObject({
      code: 'SHIPMENT_BOOKING_IN_PROGRESS',
    });
    expect(mockBookShipment).toHaveBeenCalledOnce();
  });
});
