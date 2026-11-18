import type { CreateOrderRequest } from '@/services/orders';
import { submitOxygenCheckout } from './checkout-oxygen-submit';

const request = {
  payment_method: 'oxygen',
  items: [{ id: 'a', quantity: 1, price: 20000 }],
} as CreateOrderRequest;
jest.mock('@/services/orders', () => ({ createOrder: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
describe('native Oxygen order admission', () => {
  const createOrder = jest.fn();
  const admit = jest.fn();
  const navigate = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    admit.mockResolvedValue(undefined);
    createOrder.mockResolvedValue({
      order: { id: 'aebdc237-5363-4e2b-b0ee-5be12ea9edab' },
    });
  });
  it('creates Oxygen initially using the unchanged durable checkout generation', async () => {
    await submitOxygenCheckout(
      {
        request,
        checkoutGeneration: 'generation-1',
        isAuthenticated: true,
        hasVoucher: false,
        hasCredits: false,
      },
      { admit, createOrder, navigate }
    );
    expect(admit).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith(request, {
      checkoutGeneration: 'generation-1',
      analyticsPaymentMethod: 'oxygen',
    });
    expect(navigate).toHaveBeenCalledWith(
      'aebdc237-5363-4e2b-b0ee-5be12ea9edab'
    );
  });
  it.each([
    { isAuthenticated: false, hasVoucher: false, hasCredits: false },
    { isAuthenticated: true, hasVoucher: true, hasCredits: false },
    { isAuthenticated: true, hasVoucher: false, hasCredits: true },
  ])('blocks unsupported checkout before creating an order: %p', async (flags) => {
    await expect(
      submitOxygenCheckout(
        { request, checkoutGeneration: 'g', ...flags },
        { admit, createOrder, navigate }
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
        { admit, createOrder, navigate }
      )
    ).rejects.toThrow('capability');
    expect(createOrder).not.toHaveBeenCalled();
  });
  it('captures committed identity before a route failure', async () => {
    const capture = jest.fn();
    navigate.mockImplementationOnce(() => {
      throw new Error('route failed');
    });
    await expect(
      submitOxygenCheckout(
        {
          request,
          checkoutGeneration: 'g',
          isAuthenticated: true,
          hasVoucher: false,
          hasCredits: false,
          onOrderCreated: capture,
        },
        { admit, createOrder, navigate }
      )
    ).rejects.toThrow();
    expect(capture).toHaveBeenCalledWith(
      'aebdc237-5363-4e2b-b0ee-5be12ea9edab'
    );
  });
});
