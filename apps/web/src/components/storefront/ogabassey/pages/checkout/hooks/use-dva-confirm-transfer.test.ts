import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDvaConfirmTransfer } from './use-dva-confirm-transfer';
import type { DvaModalData } from './use-dva-confirm-transfer';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

const mockCaptureCheckoutPaymentCompleted = vi.fn();
vi.mock('../capture-checkout-payment-completed', () => ({
  captureCheckoutPaymentCompleted: (
    ...args: Array<Record<string, unknown>>
  ) => mockCaptureCheckoutPaymentCompleted(...args),
}));

const mockClearCheckoutIdempotencyKey = vi.fn();
vi.mock('../checkout-idempotency', () => ({
  clearCheckoutIdempotencyKey: (...args: Array<unknown>) =>
    mockClearCheckoutIdempotencyKey(...args),
}));

const { toast } = await import('@/hooks/use-toast');

const dvaData: DvaModalData = {
  account_number: '0123456789',
  account_name: 'Baci / Ada',
  bank_name: 'Test Bank',
  bank_code: '011',
  amount: 4000,
  total: 5000,
  reference: 'REF-123',
  orderId: 'order-123',
  orderNumber: 'ORD-123',
  trackingToken: 'track-123',
  checkoutFingerprint: 'fp-123',
  orderCurrency: 'NGN',
};

function baseDeps(
  overrides: Partial<Parameters<typeof useDvaConfirmTransfer>[0]> = {}
) {
  return {
    checkoutCart: [],
    clearCart: vi.fn(),
    clearCheckoutSession: vi.fn(),
    clearPendingCheckoutOrder: vi.fn(),
    currencyCode: 'NGN',
    dvaData,
    getHref: (path: string) => `https://store.example.com${path}`,
    merchantSlug: 'demo',
    setDvaData: vi.fn(),
    ...overrides,
  };
}

function mockPaidTrackOrder(orderId = 'order-123') {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ order: { id: orderId, payment_status: 'paid' } }),
  });
}

// The confirm handler drives a promise chain (fetch, idempotency digest)
// that a bare async act would outrun: flush it inside act instead.
async function confirmAndFlush(handleDvaConfirmTransfer: () => void) {
  await act(async () => {
    handleDvaConfirmTransfer();
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useDvaConfirmTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    global.fetch = vi.fn();
    mockClearCheckoutIdempotencyKey.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts idle with close/confirm handlers', () => {
    const { result } = renderHook(() => useDvaConfirmTransfer(baseDeps()));

    expect(result.current.isVerifyingDva).toBe(false);
    expect(typeof result.current.closeDvaModal).toBe('function');
    expect(typeof result.current.handleDvaConfirmTransfer).toBe('function');
  });

  it('records the paid conversion with the stamped total and routes to success', async () => {
    mockPaidTrackOrder();
    const deps = baseDeps();
    const { result } = renderHook(() => useDvaConfirmTransfer(deps));

    await confirmAndFlush(result.current.handleDvaConfirmTransfer);

    // Canonical order total wins over the residual DVA amount.
    expect(mockCaptureCheckoutPaymentCompleted).toHaveBeenCalledTimes(1);
    expect(mockCaptureCheckoutPaymentCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'NGN',
        orderId: 'order-123',
        paymentMethod: 'bank_transfer',
        reference: 'REF-123',
        total: 5000,
      })
    );
    // Scoped idempotency cleanup uses this attempt's fingerprint.
    expect(mockClearCheckoutIdempotencyKey).toHaveBeenCalledWith('fp-123');
    expect(deps.clearPendingCheckoutOrder).toHaveBeenCalledTimes(1);
    expect(deps.clearCheckoutSession).toHaveBeenCalledTimes(1);
    expect(deps.setDvaData).toHaveBeenCalledWith(null);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0]?.[0])).toContain(
      '/order-success?type=standard&orderId=order-123'
    );
    expect(result.current.isVerifyingDva).toBe(false);
  });

  it('clears the completed cart synchronously before navigation', async () => {
    mockPaidTrackOrder();
    const deps = baseDeps();
    const { result } = renderHook(() => useDvaConfirmTransfer(deps));

    await confirmAndFlush(result.current.handleDvaConfirmTransfer);

    // No delayed timer: the completed cart clears inline, before the
    // success push, so no stale callback can erase a newer cart.
    expect(deps.clearCart).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(
      (deps.clearCart as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    ).toBeLessThan(mockPush.mock.invocationCallOrder[0]);
  });

  it('keeps the modal open with a retry toast when no transfer is found', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ order: { payment_status: 'pending' } }),
    });
    const deps = baseDeps();
    const { result } = renderHook(() => useDvaConfirmTransfer(deps));

    await confirmAndFlush(result.current.handleDvaConfirmTransfer);

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Transfer not detected yet' })
    );
    expect(mockCaptureCheckoutPaymentCompleted).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(deps.setDvaData).not.toHaveBeenCalled();
    expect(result.current.isVerifyingDva).toBe(false);
  });

  it('treats a paid verdict for a different order as unconfirmed', async () => {
    // A stale tracking token resolving an older paid order must not
    // confirm the modal's newer order: no conversion, no routing, and the
    // cart stays so the shopper can retry or check later.
    mockPaidTrackOrder('order-OLDER');
    const deps = baseDeps();
    const { result } = renderHook(() => useDvaConfirmTransfer(deps));

    await confirmAndFlush(result.current.handleDvaConfirmTransfer);

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Transfer not detected yet' })
    );
    expect(mockCaptureCheckoutPaymentCompleted).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(deps.setDvaData).not.toHaveBeenCalled();
    expect(deps.clearCart).not.toHaveBeenCalled();
    expect(result.current.isVerifyingDva).toBe(false);
  });

  it('keeps the modal open with an error toast when verification rejects', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Network error')
    );
    const deps = baseDeps();
    const { result } = renderHook(() => useDvaConfirmTransfer(deps));

    await confirmAndFlush(result.current.handleDvaConfirmTransfer);

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Could not verify transfer' })
    );
    expect(mockCaptureCheckoutPaymentCompleted).not.toHaveBeenCalled();
    expect(result.current.isVerifyingDva).toBe(false);
  });

  it('retires the attempt when the modal closes during verification', async () => {
    let resolveFetch!: (value: {
      ok: boolean;
      json: () => Promise<unknown>;
    }) => void;
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );
    const deps = baseDeps();
    const { result } = renderHook(() => useDvaConfirmTransfer(deps));

    act(() => {
      result.current.handleDvaConfirmTransfer();
    });
    expect(result.current.isVerifyingDva).toBe(true);
    // Close-and-check-later while the status request is pending.
    act(() => {
      result.current.closeDvaModal();
    });
    await act(async () => {
      resolveFetch({
        ok: true,
        json: async () => ({ order: { payment_status: 'paid' } }),
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    // The late confirmation records nothing, routes nowhere, and clears
    // no cart — only the explicit close took effect.
    expect(mockCaptureCheckoutPaymentCompleted).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(deps.clearCart).not.toHaveBeenCalled();
    expect(deps.setDvaData).toHaveBeenCalledTimes(1);
    expect(deps.setDvaData).toHaveBeenCalledWith(null);
  });

  it('skips routing and cart effects when the modal closes during idempotency cleanup', async () => {
    mockPaidTrackOrder();
    let resolveCleanup!: (value: void) => void;
    mockClearCheckoutIdempotencyKey.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveCleanup = resolve;
      })
    );
    const deps = baseDeps();
    const { result } = renderHook(() => useDvaConfirmTransfer(deps));

    await act(async () => {
      result.current.handleDvaConfirmTransfer();
      await vi.advanceTimersByTimeAsync(0);
    });
    // The conversion records before the cleanup await; closing in that
    // gap must still gate the routing and cart side effects below.
    expect(mockCaptureCheckoutPaymentCompleted).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.closeDvaModal();
    });
    await act(async () => {
      resolveCleanup();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockPush).not.toHaveBeenCalled();
    expect(deps.clearCheckoutSession).not.toHaveBeenCalled();
    expect(deps.clearCart).not.toHaveBeenCalled();
  });

  it('does nothing without DVA data or an order id', () => {
    const withoutData = renderHook(() =>
      useDvaConfirmTransfer(baseDeps({ dvaData: null }))
    );
    act(() => {
      withoutData.result.current.handleDvaConfirmTransfer();
    });
    expect(global.fetch).not.toHaveBeenCalled();

    const withoutOrder = renderHook(() =>
      useDvaConfirmTransfer(
        baseDeps({ dvaData: { ...dvaData, orderId: undefined } })
      )
    );
    act(() => {
      withoutOrder.result.current.handleDvaConfirmTransfer();
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCaptureCheckoutPaymentCompleted).not.toHaveBeenCalled();
  });
});
