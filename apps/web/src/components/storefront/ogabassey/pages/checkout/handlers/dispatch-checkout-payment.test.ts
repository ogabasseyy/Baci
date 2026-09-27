import { beforeEach, describe, expect, it, vi } from 'vitest';
import { paymentDispatchContext } from './checkout-payment-dispatch-context.test-support';
import { completeCheckoutOrder } from './complete-checkout-order';
import { dispatchCheckoutPayment } from './dispatch-checkout-payment';
import { initializeCheckoutGateway } from './initialize-checkout-gateway';
import { openCheckoutCreditDirect } from './open-checkout-credit-direct';
import { openCheckoutCredpal } from './open-checkout-credpal';
import { startCheckoutBankTransfer } from './start-checkout-bank-transfer';
import { startCheckoutRedvault } from './start-checkout-redvault';

vi.mock('./initialize-checkout-gateway', () => ({
  initializeCheckoutGateway: vi.fn(),
}));
vi.mock('./open-checkout-credit-direct', () => ({
  openCheckoutCreditDirect: vi.fn(),
}));
vi.mock('./open-checkout-credpal', () => ({ openCheckoutCredpal: vi.fn() }));
vi.mock('./complete-checkout-order', () => ({
  completeCheckoutOrder: vi.fn(),
}));
vi.mock('./start-checkout-bank-transfer', () => ({
  startCheckoutBankTransfer: vi.fn(),
}));
vi.mock('./start-checkout-redvault', () => ({
  startCheckoutRedvault: vi.fn(),
}));

describe('dispatchCheckoutPayment', () => {
  beforeEach(() => vi.resetAllMocks());
  it.each([
    'paystack',
    'korapay',
    'klump',
  ] as const)('hands %s off without clearing the cart', async (paymentMethod) => {
    const context = { ...paymentDispatchContext(), paymentMethod };
    vi.mocked(initializeCheckoutGateway).mockResolvedValue({
      success: true,
      reference: 'ref',
      authorization_url: 'https://pay.example/checkout',
    });
    await dispatchCheckoutPayment(context);
    expect(initializeCheckoutGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        order: context.order,
        gateway: paymentMethod,
        currency: 'NGN',
      })
    );
    expect(context.redirect).toHaveBeenCalledWith(
      'https://pay.example/checkout'
    );
    expect(context.clearCart).not.toHaveBeenCalled();
    if (paymentMethod === 'klump')
      expect(context.capturePaymentStarted).not.toHaveBeenCalled();
    else expect(context.capturePaymentStarted).toHaveBeenCalledWith('ref');
  });
  it('opens crypto selection using the residual amount and canonical total without initializing a gateway', async () => {
    const context = paymentDispatchContext();
    context.paymentMethod = 'juicyway';
    await dispatchCheckoutPayment(context);
    expect(context.setPendingCryptoOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        amount: 800,
        total: 1000,
        trackingToken: 'token-1',
      })
    );
    expect(context.setShowCryptoSelector).toHaveBeenCalledWith(true);
    expect(context.isOrderInFlightRef.current).toBe(false);
    expect(initializeCheckoutGateway).not.toHaveBeenCalled();
  });
  it('shows initialized crypto details and releases the lock', async () => {
    const context = paymentDispatchContext();
    vi.mocked(initializeCheckoutGateway).mockResolvedValue({
      success: true,
      reference: 'ref',
      crypto_payment: {
        address: 'wallet',
        chain: 'TRX',
        currency: 'USDT',
        amount: 800,
        confirmation_time: 'now',
      },
    });
    await dispatchCheckoutPayment(context);
    expect(context.setCryptoPaymentData).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 8,
        orderId: 'order-1',
        reference: 'ref',
      })
    );
    expect(context.isOrderInFlightRef.current).toBe(false);
    expect(context.redirect).not.toHaveBeenCalled();
  });
  it('propagates gateway failure without redirect or clearing recovery state', async () => {
    const context = paymentDispatchContext();
    vi.mocked(initializeCheckoutGateway).mockRejectedValue(
      new Error('provider failed')
    );
    await expect(dispatchCheckoutPayment(context)).rejects.toThrow(
      'provider failed'
    );
    expect(context.redirect).not.toHaveBeenCalled();
    expect(context.clearPendingCheckoutOrder).not.toHaveBeenCalled();
  });
  it('rejects a successful response without a payment destination', async () => {
    vi.mocked(initializeCheckoutGateway).mockResolvedValue({
      success: true,
      reference: 'ref',
    });
    await expect(
      dispatchCheckoutPayment(paymentDispatchContext())
    ).rejects.toThrow('No auth URL');
  });
  it.each([
    'bank_transfer',
    'uba_redvault',
  ] as const)('dispatches %s only to its dedicated safety flow', async (paymentMethod) => {
    const context = { ...paymentDispatchContext(), paymentMethod };
    await dispatchCheckoutPayment(context);
    expect(
      paymentMethod === 'bank_transfer'
        ? startCheckoutBankTransfer
        : startCheckoutRedvault
    ).toHaveBeenCalledWith(context);
    expect(initializeCheckoutGateway).not.toHaveBeenCalled();
    expect(completeCheckoutOrder).not.toHaveBeenCalled();
  });
  it('preserves Credit Direct cancellation and reference callbacks', async () => {
    const context = paymentDispatchContext();
    context.paymentMethod = 'credit_direct';
    await dispatchCheckoutPayment(context);
    const options = vi.mocked(openCheckoutCreditDirect).mock.calls[0][0];
    options.onPaymentStarted('ref');
    options.onIdle();
    expect(context.setInitializedReference).toHaveBeenCalledWith('ref');
    expect(context.isOrderInFlightRef.current).toBe(false);
    expect(context.clearCart).not.toHaveBeenCalled();
  });
  it('preserves CredPal cancellation lock release without clearing an unpaid cart', async () => {
    const context = paymentDispatchContext();
    context.paymentMethod = 'credpal';
    await dispatchCheckoutPayment(context);
    vi.mocked(openCheckoutCredpal).mock.calls[0][0].releaseSubmitLock();
    expect(context.isOrderInFlightRef.current).toBe(false);
    expect(context.clearCart).not.toHaveBeenCalled();
  });
  it.each([
    'invoice',
    'payforme',
    'pod',
  ] as const)('finishes %s through the existing completion handler', async (paymentMethod) => {
    const context = { ...paymentDispatchContext(), paymentMethod };
    await dispatchCheckoutPayment(context);
    expect(completeCheckoutOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        order: context.order,
        completion:
          paymentMethod === 'payforme'
            ? { kind: 'payforme', payerName: 'Payer' }
            : { kind: paymentMethod === 'invoice' ? 'invoice' : 'standard' },
      })
    );
    expect(initializeCheckoutGateway).not.toHaveBeenCalled();
  });
});
