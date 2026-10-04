import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeCheckoutOrder } from './complete-checkout-order';
import { dispatchCheckoutPayment } from './dispatch-checkout-payment';
import { paymentDispatchContext } from './checkout-payment-dispatch-context.test-support';
import { continueCheckoutPayment } from './continue-checkout-payment';

vi.mock('./complete-checkout-order', () => ({
  completeCheckoutOrder: vi.fn(async () => undefined),
}));
vi.mock('./dispatch-checkout-payment', () => ({
  dispatchCheckoutPayment: vi.fn(async () => undefined),
}));

describe('continueCheckoutPayment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('completes a zero-due order without starting a payment provider', async () => {
    const context = paymentDispatchContext();
    const {
      order,
      paymentAmount: _paymentAmount,
      createdOrderNumber: _createdOrderNumber,
      orderChargeCurrency: _orderChargeCurrency,
      capturePaymentStarted: _capturePaymentStarted,
      hasPaymentStarted: _hasPaymentStarted,
      setInitializedReference: _setInitializedReference,
      completeSignup: _completeSignup,
      ...dispatch
    } = context;

    await continueCheckoutPayment({
      dispatch,
      order,
      wallet: { amountUsed: 1000, newBalance: 0 },
      amountDueToGateway: 0,
      createdOrderNumber: 'ORD-1',
      orderChargeCurrency: 'NGN',
      checkoutFingerprint: 'fingerprint',
      paymentMethod: 'paystack',
      setWalletBalance: vi.fn(),
      capturePaymentStarted: vi.fn(),
      hasPaymentStarted: vi.fn(() => false),
      setInitializedReference: vi.fn(),
      completeSignup: vi.fn(async () => undefined),
      releaseSubmission: vi.fn(),
    });

    expect(completeCheckoutOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        order,
        checkoutFingerprint: 'fingerprint',
        completion: expect.objectContaining({
          kind: 'zero_due',
          paymentMethod: 'paystack',
          total: 1000,
        }),
      })
    );
    expect(dispatchCheckoutPayment).not.toHaveBeenCalled();
  });

  it('forwards the server amount due after signup and wallet balance update', async () => {
    const context = paymentDispatchContext();
    const {
      order,
      paymentAmount: _paymentAmount,
      createdOrderNumber: _createdOrderNumber,
      orderChargeCurrency: _orderChargeCurrency,
      capturePaymentStarted: _capturePaymentStarted,
      hasPaymentStarted: _hasPaymentStarted,
      setInitializedReference: _setInitializedReference,
      completeSignup: _completeSignup,
      ...dispatch
    } = context;
    const events: string[] = [];

    await continueCheckoutPayment({
      dispatch,
      order,
      wallet: { amountUsed: 250, newBalance: 750 },
      amountDueToGateway: 750,
      createdOrderNumber: 'ORD-1',
      orderChargeCurrency: 'EUR',
      checkoutFingerprint: 'fingerprint',
      paymentMethod: 'paystack',
      setWalletBalance: (balance) => events.push(`balance:${balance}`),
      capturePaymentStarted: vi.fn(),
      hasPaymentStarted: vi.fn(() => false),
      setInitializedReference: vi.fn(),
      completeSignup: vi.fn(async () => undefined),
      signupBeforePayment: async () => {
        events.push('signup');
      },
      releaseSubmission: vi.fn(),
    });

    expect(events).toEqual(['signup', 'balance:750']);
    expect(dispatchCheckoutPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        order,
        paymentAmount: 750,
        orderChargeCurrency: 'EUR',
      })
    );
    expect(completeCheckoutOrder).not.toHaveBeenCalled();
  });

  it('rejects a reduced Klump amount before attempting optional signup', async () => {
    const context = paymentDispatchContext();
    const {
      order,
      paymentAmount: _paymentAmount,
      createdOrderNumber: _createdOrderNumber,
      orderChargeCurrency: _orderChargeCurrency,
      capturePaymentStarted: _capturePaymentStarted,
      hasPaymentStarted: _hasPaymentStarted,
      setInitializedReference: _setInitializedReference,
      completeSignup: _completeSignup,
      ...dispatch
    } = context;
    const signupBeforePayment = vi.fn(async () => undefined);
    const releaseSubmission = vi.fn();

    await continueCheckoutPayment({
      dispatch,
      order,
      wallet: { amountUsed: 250, newBalance: 750 },
      amountDueToGateway: 750,
      createdOrderNumber: 'ORD-1',
      orderChargeCurrency: 'NGN',
      checkoutFingerprint: 'fingerprint',
      paymentMethod: 'klump',
      setWalletBalance: vi.fn(),
      capturePaymentStarted: vi.fn(),
      hasPaymentStarted: vi.fn(() => false),
      setInitializedReference: vi.fn(),
      completeSignup: vi.fn(async () => undefined),
      signupBeforePayment,
      releaseSubmission,
    });

    expect(signupBeforePayment).not.toHaveBeenCalled();
    expect(releaseSubmission).toHaveBeenCalledOnce();
    expect(dispatchCheckoutPayment).not.toHaveBeenCalled();
  });
});
