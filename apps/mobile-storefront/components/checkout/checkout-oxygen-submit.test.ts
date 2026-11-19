import type { CreateOrderRequest } from '@/services/orders';
import { submitOxygenCheckout } from './checkout-oxygen-submit';

const request = {
  payment_method: 'oxygen',
  items: [{ id: 'a', quantity: 1, price: 20000 }],
} as CreateOrderRequest;
jest.mock('@/services/orders', () => ({ createOrder: jest.fn() }));
describe('native Oxygen order admission', () => {
  const createOrder = jest.fn();
  const admit = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    admit.mockResolvedValue({ merchant: { id: 'merchant-one' } });
    createOrder.mockResolvedValue({
      order: { id: 'aebdc237-5363-4e2b-b0ee-5be12ea9edab' },
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
      { admit, createOrder }
    );
    expect(admit).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith(request, {
      checkoutGeneration: 'generation-1',
      analyticsPaymentMethod: 'oxygen',
      expectedMerchantId: 'merchant-one',
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
        { admit, createOrder }
      )
    ).rejects.toThrow();
    expect(createOrder).not.toHaveBeenCalled();
  });
  it('does not create without freshly verified capability', async () => {
    admit.mockRejectedValue(new Error('capability unavailable'));
    await expect(
      submitOxygenCheckout(
        {
          request,
          checkoutGeneration: 'g',
          isAuthenticated: true,
          hasVoucher: false,
          hasCredits: false,
        },
        { admit, createOrder }
      )
    ).rejects.toThrow('capability');
    expect(createOrder).not.toHaveBeenCalled();
  });
  it.each([
    'voucherToken',
    'voucherAwardId',
  ])('rejects an unnormalized %s before sending the order', async (key) => {
    await expect(
      submitOxygenCheckout(
        {
          request: {
            ...request,
            items: request.items.map((item) => ({ ...item, [key]: 'id' })),
          },
          checkoutGeneration: 'g',
          isAuthenticated: true,
          hasVoucher: false,
          hasCredits: false,
        },
        { admit, createOrder }
      )
    ).rejects.toThrow(/without vouchers/);
    expect(admit).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
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
      { admit, createOrder }
    );
    expect(createOrder).toHaveBeenCalledWith(
      discounted,
      expect.objectContaining({ checkoutGeneration: 'g' })
    );
  });
});
