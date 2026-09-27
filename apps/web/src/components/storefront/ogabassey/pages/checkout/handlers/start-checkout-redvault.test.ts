import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeRedvaultPayment } from '../redvault-payment-response';
import { paymentDispatchContext } from './checkout-payment-dispatch-context.test-support';
import { startCheckoutRedvault } from './start-checkout-redvault';

vi.mock('../redvault-payment-response', () => ({
  initializeRedvaultPayment: vi.fn(),
}));

describe('startCheckoutRedvault', () => {
  beforeEach(() => vi.resetAllMocks());
  it.each([
    'pending_reconciliation',
    'captured_held',
  ] as const)('retains the order and avoids redirect for %s', async (kind) => {
    const context = paymentDispatchContext();
    vi.mocked(initializeRedvaultPayment).mockResolvedValue({ kind });
    await startCheckoutRedvault(context);
    expect(context.isOrderInFlightRef.current).toBe(false);
    expect(context.redirect).not.toHaveBeenCalled();
    expect(context.clearPendingCheckoutOrder).not.toHaveBeenCalled();
    expect(context.capturePaymentStarted).not.toHaveBeenCalled();
    if (kind === 'captured_held')
      expect(context.setRedvaultStatus).toHaveBeenCalledWith('held');
  });
  it('records the attempt and finishes optional signup before redirecting', async () => {
    const context = paymentDispatchContext();
    vi.mocked(initializeRedvaultPayment).mockResolvedValue({
      kind: 'authorization_url',
      reference: 'ref',
      authorizationUrl: 'https://pay.example/uba',
    });
    context.completeSignup = vi.fn(async () => {
      expect(context.capturePaymentStarted).toHaveBeenCalledWith('ref');
      expect(context.redirect).not.toHaveBeenCalled();
    });
    await startCheckoutRedvault(context);
    expect(context.completeSignup).toHaveBeenCalledOnce();
    expect(context.redirect).toHaveBeenCalledWith('https://pay.example/uba');
    expect(context.clearCart).not.toHaveBeenCalled();
  });
  it('marks initialization failure and propagates it to the checkout error handler', async () => {
    const context = paymentDispatchContext();
    vi.mocked(initializeRedvaultPayment).mockRejectedValue(
      new Error('provider failed')
    );
    await expect(startCheckoutRedvault(context)).rejects.toThrow(
      'provider failed'
    );
    expect(context.setRedvaultStatus).toHaveBeenCalledWith('error');
    expect(context.redirect).not.toHaveBeenCalled();
  });
});
