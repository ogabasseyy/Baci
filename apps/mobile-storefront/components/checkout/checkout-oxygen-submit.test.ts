import type { CreateOrderRequest } from '@/services/orders';
import { submitOxygenCheckout } from './checkout-oxygen-submit';

const request = {
  payment_method: 'oxygen',
  items: [{ id: 'a', quantity: 1, price: 20000 }],
} as CreateOrderRequest;
const receipt = {
  id: 'aebdc237-5363-4e2b-b0ee-5be12ea9edab',
  total: 20000,
  payment_method: 'oxygen',
  currency: 'NGN',
};
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
      amountDueToGateway: 20000,
      order: receipt,
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
  it('blocks unauthenticated checkout before creating an order', async () => {
    await expect(
      submitOxygenCheckout(
        {
          request,
          checkoutGeneration: 'g',
          isAuthenticated: false,
          hasVoucher: false,
          hasCredits: false,
        },
        { readOwner, createOrder }
      )
    ).rejects.toThrow();
    expect(createOrder).not.toHaveBeenCalled();
  });
  it.each([
    { hasVoucher: true, hasCredits: false },
    { hasVoucher: false, hasCredits: true },
  ])('allows vouchers and partial store credit when positive net payable remains: %p', async (flags) => {
    const creditedRequest = {
      ...request,
      use_wallet_credit: flags.hasCredits,
      wallet_amount: flags.hasCredits ? 5000 : 0,
    };
    createOrder.mockResolvedValueOnce({
      amountDueToGateway: 15000,
      order: receipt,
    });
    const result = await submitOxygenCheckout(
      {
        request: creditedRequest,
        checkoutGeneration: 'g',
        isAuthenticated: true,
        ...flags,
      },
      { readOwner, createOrder }
    );
    expect(createOrder).toHaveBeenCalledWith(
      creditedRequest,
      expect.anything()
    );
    expect(result.amountDueToGateway).toBe(15000);
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
  it('preserves voucher identifiers on mixed Oxygen cart items', async () => {
    const mixedRequest = {
      ...request,
      items: [
        ...request.items,
        {
          id: 'v',
          name: 'Prize Item',
          quantity: 1,
          price: 0,
          voucher_token: 'v-tok',
          voucher_award_id: 'v-award',
        },
      ],
    };
    await submitOxygenCheckout(
      {
        request: mixedRequest,
        checkoutGeneration: 'g',
        isAuthenticated: true,
        hasVoucher: true,
        hasCredits: false,
      },
      { readOwner, createOrder }
    );
    expect(createOrder).toHaveBeenCalledWith(mixedRequest, expect.anything());
  });
  it('keeps an old zero-balance or 100%-credit order out of the financing handoff', async () => {
    createOrder.mockResolvedValueOnce({
      amountDueToGateway: 0,
      order: { ...receipt, total: 0 },
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

    createOrder.mockResolvedValueOnce({
      amountDueToGateway: 0,
      order: receipt,
    });
    await expect(
      submitOxygenCheckout(
        {
          request,
          checkoutGeneration: 'g',
          isAuthenticated: true,
          hasVoucher: false,
          hasCredits: true,
        },
        { readOwner, createOrder }
      )
    ).rejects.toThrow('zero-balance order');
  });

  it.each([
    { id: 'malformed-id' },
    { total: Number.NaN },
    { total: '100' },
    { payment_method: 'paystack' },
    { currency: 'USD' },
    { payment_method: undefined },
    { currency: undefined },
  ])('rejects an unusable order receipt before the cart handoff: %j', async (patch) => {
    createOrder.mockResolvedValueOnce({ order: { ...receipt, ...patch } });
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
