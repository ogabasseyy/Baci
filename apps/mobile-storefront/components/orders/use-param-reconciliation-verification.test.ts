import { act, renderHook } from '@testing-library/react-native';
import { verifyOrderPaymentForCompletion } from '@/components/payment-gateway/verify-order-payment';
import { deferredBankOfferCart } from '@/lib/deferred-bank-offer-cart';
import { logger } from '@/lib/logger';
import { useParamReconciliationVerification } from './use-param-reconciliation-verification';

jest.mock('@/components/payment-gateway/verify-order-payment', () => ({
  verifyOrderPaymentForCompletion: jest.fn(),
}));
jest.mock('@/lib/deferred-bank-offer-cart', () => ({
  deferredBankOfferCart: { clearIfUnchanged: jest.fn(async () => undefined) },
}));
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn() } }));

const mockedVerify = verifyOrderPaymentForCompletion as jest.Mock;

describe('useParamReconciliationVerification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('clears the saved basket only after verified bank-offer settlement', async () => {
    mockedVerify
      .mockResolvedValueOnce({ paid: false })
      .mockResolvedValueOnce({ paid: true });
    const reference = `BCO-${'d'.repeat(32)}`;
    const { result } = renderHook(() =>
      useParamReconciliationVerification({
        isParamReconciliation: true,
        requireVerifiedPayment: true,
        orderId: 'order-1',
        reference,
        retryDelayMs: 100,
      })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(deferredBankOfferCart.clearIfUnchanged).not.toHaveBeenCalled();
    expect(result.current.bankOfferPaid).toBe(false);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(deferredBankOfferCart.clearIfUnchanged).toHaveBeenCalledWith(
      'order-1',
      reference,
      expect.any(Function)
    );
    expect(result.current.verified).toBe(false);
    expect(result.current.bankOfferPaid).toBe(true);
  });

  it('logs the order when cart cleanup fails and still reports the verified payment', async () => {
    mockedVerify.mockResolvedValueOnce({ paid: true });
    jest
      .mocked(deferredBankOfferCart.clearIfUnchanged)
      .mockRejectedValueOnce(new Error('private storage details'));
    const { result } = renderHook(() =>
      useParamReconciliationVerification({
        isParamReconciliation: true,
        requireVerifiedPayment: true,
        orderId: 'order-1',
        reference: `BCO-${'d'.repeat(32)}`,
      })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.bankOfferPaid).toBe(true);
    expect(jest.mocked(logger.warn).mock.calls).toEqual([
      [
        'Bank card checkout',
        'Could not clear the verified cart',
        { orderId: 'order-1' },
      ],
    ]);
  });

  it('resolves true for a verified reconciliation arrival', async () => {
    mockedVerify.mockResolvedValue({
      paid: false,
      reconciliation: 'order_cancelled',
    });

    const { result } = renderHook(() =>
      useParamReconciliationVerification({
        isParamReconciliation: true,
        orderId: 'order-1',
        retryDelayMs: 100,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.verified).toBe(true);
    expect(result.current.exhausted).toBe(false);
    expect(mockedVerify).toHaveBeenCalledTimes(1);
  });

  it('resolves false for a verified-absent param', async () => {
    mockedVerify.mockResolvedValue({ paid: true });

    const { result } = renderHook(() =>
      useParamReconciliationVerification({
        isParamReconciliation: true,
        orderId: 'order-1',
        retryDelayMs: 100,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.verified).toBe(false);
    expect(result.current.exhausted).toBe(false);
    expect(result.current.bankOfferPaid).toBe(false);
  });

  it('leaves a bank offer pending until provider verification confirms a verdict', async () => {
    mockedVerify.mockResolvedValueOnce({ paid: false }).mockResolvedValueOnce({
      paid: false,
      reconciliation: 'payment_reversed',
    });
    const { result } = renderHook(() =>
      useParamReconciliationVerification({
        isParamReconciliation: true,
        requireVerifiedPayment: true,
        orderId: 'order-1',
        retryDelayMs: 100,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.verified).toBeUndefined();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(result.current.verified).toBe(true);
    expect(result.current.reconciliation).toBe('payment_reversed');
  });

  it.each([
    'failed',
    'cancelled',
    'abandoned',
  ])('stops retrying a definitively %s bank offer', async (terminalFailure) => {
    mockedVerify.mockResolvedValue({ paid: false, terminalFailure });
    const { result } = renderHook(() =>
      useParamReconciliationVerification({
        isParamReconciliation: true,
        requireVerifiedPayment: true,
        orderId: 'order-1',
        retryDelayMs: 100,
      })
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    expect(mockedVerify).toHaveBeenCalledTimes(1);
    expect(result.current.reconciliation).toBe('payment_failed');
    expect(result.current.exhausted).toBe(false);
  });

  it('recovers when a transient failure resolves before the retry budget', async () => {
    mockedVerify
      .mockResolvedValueOnce({ paid: false, inconclusive: true })
      .mockResolvedValueOnce({ paid: false, inconclusive: true })
      .mockResolvedValue({
        paid: false,
        reconciliation: 'order_skipped',
      });

    const { result } = renderHook(() =>
      useParamReconciliationVerification({
        isParamReconciliation: true,
        orderId: 'order-1',
        maxAttempts: 3,
        retryDelayMs: 100,
      })
    );

    // First attempt inconclusive: still pending, no verdict yet.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.verified).toBeUndefined();
    expect(result.current.exhausted).toBe(false);

    // Two bounded retries carry the transient failure to a verdict.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(result.current.verified).toBeUndefined();
    expect(result.current.exhausted).toBe(false);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(200);
    });
    expect(result.current.verified).toBe(true);
    expect(result.current.exhausted).toBe(false);
    expect(mockedVerify).toHaveBeenCalledTimes(3);
  });

  it('surfaces exhaustion without coercing a verdict', async () => {
    mockedVerify.mockResolvedValue({ paid: false, inconclusive: true });

    const { result } = renderHook(() =>
      useParamReconciliationVerification({
        isParamReconciliation: true,
        orderId: 'order-1',
        maxAttempts: 2,
        retryDelayMs: 100,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });

    // No verdict coerced; no further attempts scheduled — but exhaustion
    // is explicit so the screen can leave the blank pending state.
    expect(result.current.verified).toBeUndefined();
    expect(result.current.exhausted).toBe(true);
    expect(mockedVerify).toHaveBeenCalledTimes(2);
  });

  it('restarts bounded verification on retry after exhaustion', async () => {
    mockedVerify.mockResolvedValue({ paid: false, inconclusive: true });

    const { result } = renderHook(() =>
      useParamReconciliationVerification({
        isParamReconciliation: true,
        orderId: 'order-1',
        maxAttempts: 1,
        retryDelayMs: 100,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.exhausted).toBe(true);
    expect(mockedVerify).toHaveBeenCalledTimes(1);

    // Manual retry clears exhaustion and runs the budget again; a verdict
    // this time resolves instead of re-exhausting.
    mockedVerify.mockResolvedValue({
      paid: false,
      reconciliation: 'order_cancelled',
    });
    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });
    expect(result.current.exhausted).toBe(false);
    expect(result.current.verified).toBe(true);
    expect(mockedVerify).toHaveBeenCalledTimes(2);
  });

  it('does not verify without a reconciliation param or order', async () => {
    const { result } = renderHook(() =>
      useParamReconciliationVerification({
        isParamReconciliation: false,
        orderId: 'order-1',
        retryDelayMs: 100,
      })
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    expect(result.current.verified).toBeUndefined();
    expect(result.current.exhausted).toBe(false);
    expect(mockedVerify).not.toHaveBeenCalled();
  });

  it('exhausts immediately when the reconciliation param carries no order id', async () => {
    const { result } = renderHook(() =>
      useParamReconciliationVerification({
        isParamReconciliation: true,
        orderId: undefined,
        retryDelayMs: 100,
      })
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    // Nothing can verify, so the gate renders the explicit error state
    // (retry + continue-shopping) instead of stranding the screen blank.
    expect(result.current.verified).toBeUndefined();
    expect(result.current.exhausted).toBe(true);
    expect(mockedVerify).not.toHaveBeenCalled();
  });
});
