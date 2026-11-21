import type { CreateOrderRequest } from '@/services/orders';
import { submitOxygenCheckout } from './checkout-oxygen-submit';

const request = {
  payment_method: 'oxygen',
  items: [{ id: 'a', quantity: 1, price: 20000 }],
} as CreateOrderRequest;
jest.mock('@/services/orders', () => ({ createOrder: jest.fn() }));
describe('native Oxygen order admission', () => {
  const createOrder = jest.fn();
  const readOwner = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    readOwner.mockResolvedValue({
      merchantId: 'merchant-one',
      userId: 'buyer-one',
    });
    createOrder.mockResolvedValue({
      order: { id: 'aebdc237-5363-4e2b-b0ee-5be12ea9edab', total: 20000 },
    });
  });
  it('creates Oxygen initially using the unchanged durable checkout generation', async () => {
    const response = await submitOxygenCheckout(
      {
        request,
        checkoutGeneration: 'generation-1',
        isAuthenticated: true,
        hasVoucher: false,
        hasCredits: false,
      },
      { readOwner, createOrder }
    );
    expect(readOwner).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith(request, {
      checkoutGeneration: 'generation-1',
      analyticsPaymentMethod: 'oxygen',
      expectedMerchantId: 'merchant-one',
      expectedOwner: 'buyer-one',
    });
    expect(response.order.id).toBe('aebdc237-5363-4e2b-b0ee-5be12ea9edab');
  });
  it.each([
    { isAuthenticated: false, hasVoucher: false, hasCredits: false },
    { isAuthenticated: true, hasVoucher: true, hasCredits: false },
    { isAuthenticated: true, hasVoucher: false, hasCredits: true },
  ])('blocks unsupported checkout before creating an order: %p', async (flags) => {
    await expect(
      submitOxygenCheckout(
        { request, checkoutGeneration: 'g', ...flags },
        { readOwner, createOrder }
      )
    ).rejects.toThrow();
    expect(createOrder).not.toHaveBeenCalled();
  });
  it('does not create without a scoped owner', async () => {
    readOwner.mockRejectedValue(new Error('Owner unavailable'));
    await expect(
      submitOxygenCheckout(
        {
          request,
          checkoutGeneration: 'g',
          isAuthenticated: true,
          hasVoucher: false,
          hasCredits: false,
        },
        { readOwner, createOrder }
      )
    ).rejects.toThrow('Owner unavailable');
    expect(createOrder).not.toHaveBeenCalled();
  });
  it.each([
    ['voucherToken', ' id '],
    ['voucherAwardId', 'id'],
    ['voucher_token', 'id'],
    ['voucher_award_id', 'id'],
  ])('rejects voucher field %s with value %j before sending the order', async (key, value) => {
    await expect(
      submitOxygenCheckout(
        {
          request: {
            ...request,
            items: request.items.map((item) => ({ ...item, [key]: value })),
          },
          checkoutGeneration: 'g',
          isAuthenticated: true,
          hasVoucher: false,
          hasCredits: false,
        },
        { readOwner, createOrder }
      )
    ).rejects.toThrow(/without vouchers/);
    expect(readOwner).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });
  it.each([
    0,
    false,
    {},
  ])('rejects a malformed voucher identifier %j', async (voucherToken) => {
    await expect(
      submitOxygenCheckout(
        {
          request: {
            ...request,
            items: request.items.map((item) => ({ ...item, voucherToken })),
          },
          checkoutGeneration: 'g',
          isAuthenticated: true,
          hasVoucher: false,
          hasCredits: false,
        },
        { readOwner, createOrder }
      )
    ).rejects.toThrow('Invalid voucher identifier');
    expect(readOwner).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });
  it('omits whitespace-only voucher identifiers from the order request', async () => {
    const input = {
      ...request,
      items: request.items.map((item) => ({
        ...item,
        voucherToken: '  ',
        voucherAwardId: '\t',
        voucher_token: '\n',
        voucher_award_id: ' ',
      })),
    };
    await submitOxygenCheckout(
      {
        request: input,
        checkoutGeneration: 'g',
        isAuthenticated: true,
        hasVoucher: false,
        hasCredits: false,
      },
      { readOwner, createOrder }
    );
    expect(createOrder).toHaveBeenCalledWith(request, expect.anything());
  });
  it('keeps an old zero-balance order out of the financing handoff', async () => {
    createOrder.mockResolvedValueOnce({
      order: { id: 'aebdc237-5363-4e2b-b0ee-5be12ea9edab', total: 0 },
    });
    await expect(
      submitOxygenCheckout(
        {
          request,
          checkoutGeneration: 'g',
          isAuthenticated: true,
          hasVoucher: false,
          hasCredits: false,
        },
        { readOwner, createOrder }
      )
    ).rejects.toThrow('zero-balance order');
  });

  it.each([
    { id: 'malformed-id', total: 100 },
    { id: 'aebdc237-5363-4e2b-b0ee-5be12ea9edab', total: Number.NaN },
  ])('rejects an unusable order receipt before the cart handoff: %j', async (order) => {
    createOrder.mockResolvedValueOnce({ order });
    await expect(
      submitOxygenCheckout(
        {
          request,
          checkoutGeneration: 'g',
          isAuthenticated: true,
          hasVoucher: false,
          hasCredits: false,
        },
        { readOwner, createOrder }
      )
    ).rejects.toThrow('Could not confirm the saved Oxygen order');
  });

  it('preserves a promo code for the server to price before financing', async () => {
    const discounted = { ...request, discount_code: 'SAVE10' };
    await submitOxygenCheckout(
      {
        request: discounted,
        checkoutGeneration: 'g',
        isAuthenticated: true,
        hasVoucher: false,
        hasCredits: false,
      },
      { readOwner, createOrder }
    );
    expect(createOrder).toHaveBeenCalledWith(
      discounted,
      expect.objectContaining({ checkoutGeneration: 'g' })
    );
  });
});
