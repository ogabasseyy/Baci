import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertQuoteItemsMatchOrder } from '@/lib/shipping/international-quote-items-match';
import {
  assertShippableBookingItems,
  toDomesticBookingItems,
  toQuoteComparableOrderItems,
} from '@/lib/shipping/order-shipment-booking-utils';
import {
  recoveryContext as context,
  primeRecoveryMocks,
  recoveryQuote as quote,
  recoveryQuoteId as quoteId,
  postRecovery as request,
} from './route.test-support';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  access: vi.fn(),
  permission: vi.fn(),
  rpc: vi.fn(),
  quotes: vi.fn(),
  sender: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.auth,
  getUserAccess: mocks.access,
  hasPermission: mocks.permission,
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/shipping/resolve-booking-merchant-sender', () => ({
  resolveBookingMerchantSender: mocks.sender,
}));
vi.mock('@/lib/shipping', () => ({
  ShippingService: class {
    getProviderQuotes = mocks.quotes;
  },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));
describe('paid checkout shipping recovery quote building', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeRecoveryMocks(mocks);
  });
  it('quotes only surviving units after partial refunds', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        ...context,
        order: {
          ...context.order,
          order_items: [
            {
              ...context.order.order_items[0],
              quantity: 2,
              fulfillment_quantity: 0,
            },
            {
              ...context.order.order_items[0],
              quantity: 3,
              fulfillment_quantity: 1,
            },
          ],
        },
      },
      error: null,
    });
    const response = await request();
    expect(response.status).toBe(200);
    expect(mocks.quotes).toHaveBeenCalledTimes(1);
    const quoted = mocks.quotes.mock.calls[0][1] as {
      items: { quantity: number }[];
    };
    expect(quoted.items.map((item) => item.quantity)).toEqual([1]);
  });
  it.each([
    'pickup_station',
    'pickup',
    'airport',
  ])('rejects durable %s delivery after the old quote disappears', async (deliveryMethod) => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        ...context,
        quote_preference: null,
        order: { ...context.order, delivery_method: deliveryMethod },
      },
      error: null,
    });
    const response = await request();
    expect(response.status).toBe(409);
    expect(mocks.quotes).not.toHaveBeenCalled();
    expect(mocks.sender).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('books the surviving recovery quote line despite a fully refunded original-quantity collision', async () => {
    const rows = [
      {
        ...context.order.order_items[0],
        quantity: 2,
        fulfillment_quantity: 1,
        fulfillment_data: { fulfillmentQuantity: 1 },
      },
      {
        ...context.order.order_items[0],
        quantity: 1,
        fulfillment_quantity: 0,
        fulfillment_data: { fulfillmentQuantity: 0 },
      },
    ];
    mocks.rpc.mockResolvedValueOnce({
      data: { ...context, order: { ...context.order, order_items: rows } },
      error: null,
    });
    expect((await request()).status).toBe(200);
    const staged = mocks.rpc.mock.calls.find(
      ([name]) => name === 'prepare_customer_checkout_shipping_recovery'
    );
    const quoteRequest = staged?.[1].p_quote.quote_request;
    expect(quoteRequest.items).toHaveLength(1);
    expect(quoteRequest.items[0].quantity).toBe(1);
    expect(() =>
      assertQuoteItemsMatchOrder(
        quoteRequest,
        toQuoteComparableOrderItems(rows, { defaultWeight: 1 })
      )
    ).not.toThrow();
    const items = toDomesticBookingItems(rows, quoteRequest.items);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(1);
    expect(() => assertShippableBookingItems(items)).not.toThrow();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain(
      'confirm_customer_checkout_shipping_recovery'
    );
  });
  it('accepts a current GoStandard quote for a legacy standard label without changing the paid fee', async () => {
    mocks.quotes.mockResolvedValue([
      {
        ...quote,
        serviceTier: 'GoStandard',
        providerRateId: 'GIGL_30_0_1_0_0_4',
      },
    ]);
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      canConfirm: true,
      paidShippingFee: 110,
      quote: { price: 110 },
    });
  });
  it('uses verified rate identity despite obsolete tier and carrier labels', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        ...context,
        quote_preference: {
          ...context.quote_preference,
          service_tier: 'Legacy delivery',
          carrier_name: 'Old carrier label',
          provider_rate_id: 'GIGL_30_0_1',
        },
      },
      error: null,
    });
    mocks.quotes.mockResolvedValue([
      {
        ...quote,
        serviceTier: 'GoFaster',
        providerRateId: 'GIGL_30_0_1_0_1_4',
      },
      {
        ...quote,
        serviceTier: 'GoStandard',
        providerRateId: 'GIGL_30_0_1_0_0_4',
      },
    ]);
    const response = await request();
    expect(response.status).toBe(200);
    const staged = mocks.rpc.mock.calls.find(
      ([name]) => name === 'prepare_customer_checkout_shipping_recovery'
    );
    expect(staged?.[1].p_quote).toMatchObject({
      service_tier: 'GoStandard',
      price: 110,
    });
  });
  it('keeps the same-price gate for a matching renamed service', async () => {
    mocks.quotes.mockResolvedValue([
      { ...quote, serviceTier: 'GoStandard', price: 120 },
    ]);
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      canConfirm: false,
      previewId: null,
      paidShippingFee: 110,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('rejects a different service even when its fee matches', async () => {
    mocks.quotes.mockResolvedValue([
      {
        ...quote,
        serviceTier: 'GoFaster',
        providerRateId: 'GIGL_30_0_1_0_1_4',
      },
    ]);
    expect((await request()).status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('maps staging rejections to a structured JSON error', async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'get_customer_checkout_shipping_recovery_context')
        return { data: context, error: null };
      throw new Error('rate rpc failed');
    });
    const response = await request();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Unable to recover this shipping quote. Please try again.',
    });
  });
  it('rejects recovery when no shippable units remain', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        ...context,
        order: {
          ...context.order,
          order_items: [
            { ...context.order.order_items[0], fulfillment_quantity: 0 },
          ],
        },
      },
      error: null,
    });
    const response = await request();
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'No shippable units remain on this order.',
    });
    expect(mocks.quotes).not.toHaveBeenCalled();
  });
  it('carries a legacy snake_case postal code into the quote receiver', async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'get_customer_checkout_shipping_recovery_context'
        ? {
            data: {
              ...context,
              order: {
                ...context.order,
                shipping_address: {
                  ...context.order.shipping_address,
                  postal_code: '100001',
                },
              },
            },
            error: null,
          }
        : { data: quoteId, error: null }
    );
    const response = await request();
    expect(response.status).toBe(200);
    const quoted = mocks.quotes.mock.calls[0][1] as {
      receiver: { postalCode?: string };
    };
    expect(quoted.receiver.postalCode).toBe('100001');
  });
});
