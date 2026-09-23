import { act, renderHook } from '@testing-library/react-native';
import { verifyOrderPaymentForCompletion } from '@/components/payment-gateway/verify-order-payment';
import { useParamReconciliationVerification } from './use-param-reconciliation-verification';

jest.mock('@/components/payment-gateway/verify-order-payment', () => ({
  verifyOrderPaymentForCompletion: jest.fn(),
}));

const mockedVerify = verifyOrderPaymentForCompletion as jest.Mock;

describe('useParamReconciliationVerification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
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
});
