import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recoveryContext as context,
  primeRecoveryMocks,
  recoveryQuoteId as quoteId,
  recoveryReceiver as receiver,
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
