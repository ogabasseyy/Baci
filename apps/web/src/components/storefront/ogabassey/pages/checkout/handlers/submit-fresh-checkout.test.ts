import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCheckoutOrderLifecycleOptions } from '../build-checkout-order-lifecycle-options';
import { submitRedvaultPreparedOrder } from './redvault-prepared-order-submit';
import { runCheckoutOrderLifecycle } from './checkout-order-lifecycle';
import { continueCheckoutPayment } from './continue-checkout-payment';
import { submitFreshCheckout } from './submit-fresh-checkout';

vi.mock('../build-checkout-order-lifecycle-options', () => ({
  buildCheckoutOrderLifecycleOptions: vi.fn(),
}));
vi.mock('./redvault-prepared-order-submit', () => ({
  submitRedvaultPreparedOrder: vi.fn(),
}));
vi.mock('./checkout-order-lifecycle', () => ({
  runCheckoutOrderLifecycle: vi.fn(),
}));
vi.mock('./continue-checkout-payment', () => ({
  continueCheckoutPayment: vi.fn(),
}));

const lifecycleOptions = {
  onOrderCreated: vi.fn(),
};
const paymentReady = {
  kind: 'payment_ready',
  order: { id: 'order-123' },
  wallet: null,
  amountDueToGateway: 100,
  createdOrderNumber: 'BC-123',
  orderChargeCurrency: 'NGN',
  billingAddress: {},
} as const;

function options(overrides: Partial<Parameters<typeof submitFreshCheckout>[0]> = {}) {
  return {
    redvaultPrepared: {} as never,
    onRedvaultPaymentStarted: vi.fn(),
    lifecycle: {
      state: { currency: 'NGN', paymentMethod: 'paystack' },
      actions: { onOrderCreated: vi.fn() },
    } as never,
    createPaymentOptions: vi.fn(() => ({
      capturePaymentStarted: vi.fn(),
      hasPaymentStarted: vi.fn(() => false),
      setInitializedReference: vi.fn(),
    })) as never,
    handleError: vi.fn(),
    ...overrides,
  };
}

describe('submitFreshCheckout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildCheckoutOrderLifecycleOptions).mockReturnValue(
      lifecycleOptions as never
    );
    vi.mocked(submitRedvaultPreparedOrder).mockResolvedValue(false);
  });

  it('stops after a prepared REDVAULT order handles the submit', async () => {
    vi.mocked(submitRedvaultPreparedOrder).mockResolvedValue(true);

    const input = options();
    await submitFreshCheckout(input);

    expect(buildCheckoutOrderLifecycleOptions).not.toHaveBeenCalled();
    expect(runCheckoutOrderLifecycle).not.toHaveBeenCalled();
    expect(continueCheckoutPayment).not.toHaveBeenCalled();
    expect(input.handleError).not.toHaveBeenCalled();
  });

  it('forwards prepared REDVAULT payment starts before returning', async () => {
    vi.mocked(submitRedvaultPreparedOrder).mockImplementation(async (input) => {
      input.onPaymentStarted?.({
        orderId: 'prepared-order',
        currency: 'NGN',
        reference: 'redvault-ref',
        orderNumber: 'BC-PREPARED',
      });
      return true;
    });
    const input = options();

    await submitFreshCheckout(input);

    expect(input.onRedvaultPaymentStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'prepared-order',
        reference: 'redvault-ref',
      })
    );
    expect(buildCheckoutOrderLifecycleOptions).not.toHaveBeenCalled();
  });

  it('keeps pre-payment errors unattributed to a payment attempt', async () => {
    vi.mocked(runCheckoutOrderLifecycle).mockRejectedValue(
      new Error('order persistence failed')
    );
    const input = options();

    await submitFreshCheckout(input);

    expect(input.handleError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        createdOrderId: undefined,
        paymentStarted: false,
      })
    );
    expect(continueCheckoutPayment).not.toHaveBeenCalled();
  });

  it('attributes post-start payment failures to the created order and reference', async () => {
    vi.mocked(runCheckoutOrderLifecycle).mockImplementation(async (input) => {
      input.onOrderCreated({
        orderId: 'order-123',
        orderNumber: 'BC-123',
        currency: 'NGN',
      });
      return paymentReady as never;
    });
    vi.mocked(continueCheckoutPayment).mockImplementation(async (input) => {
      input.capturePaymentStarted('provider-ref');
      throw new Error('provider handoff failed');
    });
    const input = options();

    await submitFreshCheckout(input);

    expect(input.handleError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        createdOrderId: 'order-123',
        paymentStarted: true,
        payment: expect.objectContaining({
          currency: 'NGN',
          orderNumber: 'BC-123',
          reference: 'provider-ref',
        }),
      })
    );
  });

  it('does not continue when recovery already handled the order', async () => {
    vi.mocked(runCheckoutOrderLifecycle).mockResolvedValue({ kind: 'handled' });

    await submitFreshCheckout(options());

    expect(continueCheckoutPayment).not.toHaveBeenCalled();
  });
});
