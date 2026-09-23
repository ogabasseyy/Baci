import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  merchantId,
  mocks,
  orderId,
  receiver,
  sender,
  setup,
  subject,
} from './admin-order-gigl-quote.test-support';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticateApiRequest,
  getUserAccess: mocks.getUserAccess,
  hasPermission: mocks.hasPermission,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock('@/lib/shipping/persist-admin-gigl-quote', () => ({
  persistAdminGiglQuote: mocks.persistAdminGiglQuote,
}));
vi.mock('@/lib/shipping/build-order-gigl-quote-request', () => ({
  buildOrderGiglQuoteRequest: mocks.buildOrderGiglQuoteRequest,
}));
vi.mock('@/lib/shipping/resolve-booking-merchant-sender', () => ({
  resolveBookingMerchantSender: mocks.resolveBookingMerchantSender,
}));
vi.mock('@/lib/shipping', () => ({
  ShippingService: class MockShippingService {
    getProviderQuotes(...args: unknown[]) {
      return mocks.getProviderQuotes(...args);
    }
  },
}));

describe('Admin GIGL edge auth and order validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });

  it('authenticates before parsing malformed input or creating an admin client', async () => {
    const json = vi.fn().mockRejectedValue(new SyntaxError('malformed'));
    const unauthenticated = { headers: new Headers(), method: 'POST', json };
    mocks.authenticateApiRequest.mockResolvedValue({
      user: null,
      supabase: null,
    });
    const { postAdminOrderGiglQuote } = await import(
      './admin-order-gigl-quote'
    );
    const response = await postAdminOrderGiglQuote(unauthenticated as never);
    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects failed CSRF before access checks and privileged client creation', async () => {
    mocks.checkCsrfProtection.mockResolvedValue({
      valid: false,
      response: new Response('csrf', { status: 403 }),
    });
    const response = await subject({ receiver });
    expect(response.status).toBe(403);
    expect(mocks.getUserAccess).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects a non-owner', async () => {
    mocks.getUserAccess.mockResolvedValue({
      isOwner: false,
      merchantId,
      permissions: {},
    });
    const response = await subject({ receiver });
    expect(response.status).toBe(403);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects a caller without orders.fulfill permission', async () => {
    mocks.hasPermission.mockReturnValue(false);
    const response = await subject({ receiver });
    expect(response.status).toBe(403);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects missing merchant access', async () => {
    mocks.getUserAccess.mockResolvedValue(null);
    const response = await subject({ receiver });
    expect(response.status).toBe(403);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects an invalid receiver body before merchant access lookup', async () => {
    const response = await subject({ receiver: { city: 'Ikeja' } });
    expect(response.status).toBe(400);
    expect(mocks.getUserAccess).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects an invalid order id before creating a privileged client', async () => {
    const response = await subject(
      { receiver },
      { 'x-baci-admin-order-id': 'not-a-uuid' }
    );
    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('loads the order scoped to the authorized merchant', async () => {
    const { supabase } = setup();
    const response = await subject({ receiver });
    expect(response.status).toBe(200);
    expect(supabase.from).toHaveBeenCalledWith('orders');
    expect(supabase.from('orders').eq).toHaveBeenCalledWith(
      'merchant_id',
      merchantId
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('disambiguates the order-item product relationship in the order query', async () => {
    const { supabase, order } = setup();
    order.select.mockImplementation((selection: string) => {
      if (!selection.includes('product:products!order_items_product_id_fkey')) {
        order.maybeSingle.mockResolvedValueOnce({
          data: null,
          error: { message: 'PGRST201 ambiguous relationship' },
        });
      }
      return order;
    });
    const response = await subject({ receiver });
    expect(response.status).toBe(200);
    expect(supabase.from('orders').select).toHaveBeenCalledWith(
      expect.stringContaining(
        'product:products!order_items_product_id_fkey(weight_value, weight_unit, dimensions, commodity_code)'
      )
    );
  });

  it('returns 404 when the order does not exist', async () => {
    setup({ order: null });
    const response = await subject({ receiver });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Order not found' });
  });

  it('returns 500 when the order lookup fails', async () => {
    setup({ orderError: { message: 'database unavailable' } });
    const response = await subject({ receiver });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to load order' });
  });

  it.each([
    ['shipment id', { id: orderId, shipment_id: 'shipment-1' }],
    ['tracking number', { id: orderId, tracking_number: 'TRK-1' }],
    ['booked status', { id: orderId, shipping_status: 'booked' }],
    ['shipped status', { id: orderId, shipping_status: 'shipped' }],
    ['in transit status', { id: orderId, shipping_status: 'in_transit' }],
  ])('rejects an order with %s already set', async (_label, order) => {
    setup({ order });
    const response = await subject({ receiver });
    expect(response.status).toBe(409);
    expect(mocks.getProviderQuotes).not.toHaveBeenCalled();
  });

  it('rejects a pending order before invoking the provider or persistence RPC', async () => {
    setup({
      order: { id: orderId, shipping_status: 'pending' },
    });
    const response = await subject({ receiver });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Order must be processing before shipping',
    });
    expect(mocks.getProviderQuotes).not.toHaveBeenCalled();
    expect(mocks.persistAdminGiglQuote).not.toHaveBeenCalled();
  });

  it('returns sender resolution failures without calling the provider', async () => {
    mocks.resolveBookingMerchantSender.mockResolvedValue({
      ok: false,
      error: 'Merchant details not found',
      status: 404,
    });
    const response = await subject({ receiver });
    expect(response.status).toBe(404);
    expect(mocks.getProviderQuotes).not.toHaveBeenCalled();
  });

  it('returns an incomplete sender configuration error', async () => {
    mocks.resolveBookingMerchantSender.mockResolvedValue({
      ok: false,
      error: 'Merchant shipping origin is not configured',
      status: 400,
    });
    const response = await subject({ receiver });
    expect(response.status).toBe(400);
    expect(mocks.getProviderQuotes).not.toHaveBeenCalled();
  });

  it.each([
    [
      'missing address',
      {
        ok: false,
        code: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE',
        missing: ['address'],
        status: 422,
      },
    ],
    [
      'empty items',
      { ok: false, code: 'ORDER_SHIPPING_ITEMS_EMPTY', status: 400 },
    ],
    [
      'invalid item',
      { ok: false, code: 'ORDER_SHIPPING_ITEM_INVALID', status: 400 },
    ],
  ])('returns order build validation for %s', async (_label, result) => {
    mocks.buildOrderGiglQuoteRequest.mockResolvedValue(result);
    const response = await subject({ receiver });
    expect(response.status).toBe(result.status);
    expect(mocks.getProviderQuotes).not.toHaveBeenCalled();
    expect((await response.json()).code).toBe(result.code);
  });

  it('uses the authoritative order request and sender, with only a receiver override', async () => {
    const { supabase } = setup();
    const response = await subject({ receiver });
    expect(response.status).toBe(200);
    expect(mocks.buildOrderGiglQuoteRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: orderId }),
      sender,
      expect.any(Function),
      receiver
    );
    expect(mocks.resolveBookingMerchantSender).toHaveBeenCalledWith(
      supabase,
      merchantId
    );
  });
});
