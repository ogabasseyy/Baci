import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DvaModalData } from './use-checkout-dva-session';
import { useCheckoutDvaSession } from './use-checkout-dva-session';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
const mockCaptureCheckoutPaymentCompleted = vi.fn();
vi.mock('../capture-checkout-payment-completed', () => ({
  captureCheckoutPaymentCompleted: (...args: Record<string, unknown>[]) =>
    mockCaptureCheckoutPaymentCompleted(...args),
}));
const mockClearCheckoutIdempotencyKey = vi.fn();
vi.mock('../checkout-idempotency', () => ({
  clearCheckoutIdempotencyKey: (...args: unknown[]) =>
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
  overrides: Partial<Parameters<typeof useCheckoutDvaSession>[0]> = {}
) {
  return {
    checkoutCart: [],
    clearCart: vi.fn(),
    clearCheckoutSession: vi.fn(),
    clearPendingCheckoutOrder: vi.fn(),
    currencyCode: 'NGN',
    getHref: (path: string) => `https://store.example.com${path}`,
    merchantSlug: 'demo',
    ...overrides,
  };
}

function mockPaidTrackOrder(orderId = 'order-123') {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ order: { id: orderId, payment_status: 'paid' } }),
  });
}

function renderSession(deps = baseDeps()) {
  const rendered = renderHook(() => useCheckoutDvaSession(deps));
  act(() => rendered.result.current.setDvaData(dvaData));
  return rendered;
}

describe('useCheckoutDvaSession retired attempts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    global.fetch = vi.fn();
    mockClearCheckoutIdempotencyKey.mockResolvedValue(undefined);
  });

  afterEach(() => vi.useRealTimers());

  it('keeps replacement verification active when a retired request resolves late', async () => {
    let resolveOldFetch!: (value: {
      ok: boolean;
      json: () => Promise<unknown>;
    }) => void;
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOldFetch = resolve;
      })
    );
    let resolveNewFetch!: (value: {
      ok: boolean;
      json: () => Promise<unknown>;
    }) => void;
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNewFetch = resolve;
      })
    );
    const deps = baseDeps();
    const { result } = renderSession(deps);

    act(() => result.current.handleDvaConfirmTransfer());
    act(() =>
      result.current.setDvaData({
        ...dvaData,
        orderId: 'replacement-order',
        reference: 'REF-REPLACEMENT',
      })
    );
    expect(result.current.isVerifyingDva).toBe(false);
    act(() => result.current.handleDvaConfirmTransfer());
    expect(result.current.isVerifyingDva).toBe(true);

    await act(async () => {
      resolveOldFetch({
        ok: true,
        json: async () => ({
          order: { id: 'order-123', payment_status: 'paid' },
        }),
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.dvaData?.orderId).toBe('replacement-order');
    expect(result.current.isVerifyingDva).toBe(true);
    expect(mockCaptureCheckoutPaymentCompleted).not.toHaveBeenCalled();
    expect(deps.clearPendingCheckoutOrder).not.toHaveBeenCalled();
    expect(deps.clearCheckoutSession).not.toHaveBeenCalled();
    expect(deps.clearCart).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => {
      resolveNewFetch({
        ok: true,
        json: async () => ({ order: { payment_status: 'pending' } }),
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.dvaData?.orderId).toBe('replacement-order');
    expect(result.current.isVerifyingDva).toBe(false);
  });

  it('ignores a retired request rejection while replacement verification is pending', async () => {
    let rejectOldFetch!: (reason?: unknown) => void;
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectOldFetch = reject;
      })
    );
    let resolveNewFetch!: (value: {
      ok: boolean;
      json: () => Promise<unknown>;
    }) => void;
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNewFetch = resolve;
      })
    );
    const deps = baseDeps();
    const { result } = renderSession(deps);

    act(() => result.current.handleDvaConfirmTransfer());
    act(() =>
      result.current.setDvaData({
        ...dvaData,
        orderId: 'replacement-order',
        reference: 'REF-REPLACEMENT',
      })
    );
    act(() => result.current.handleDvaConfirmTransfer());
    expect(result.current.isVerifyingDva).toBe(true);

    await act(async () => {
      rejectOldFetch(new Error('Retired request failed'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Could not verify transfer' })
    );
    expect(result.current.dvaData?.orderId).toBe('replacement-order');
    expect(result.current.isVerifyingDva).toBe(true);
    expect(deps.clearPendingCheckoutOrder).not.toHaveBeenCalled();
    expect(deps.clearCheckoutSession).not.toHaveBeenCalled();
    expect(deps.clearCart).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => {
      resolveNewFetch({
        ok: true,
        json: async () => ({ order: { payment_status: 'pending' } }),
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Transfer not detected yet' })
    );
    expect(result.current.dvaData?.orderId).toBe('replacement-order');
    expect(result.current.isVerifyingDva).toBe(false);
  });

  it('skips routing and cart effects when the modal closes during idempotency cleanup', async () => {
    mockPaidTrackOrder();
    let resolveCleanup!: (value: undefined) => void;
    mockClearCheckoutIdempotencyKey.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveCleanup = resolve;
      })
    );
    const deps = baseDeps();
    const { result } = renderSession(deps);

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
      resolveCleanup(undefined);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockPush).not.toHaveBeenCalled();
    expect(deps.clearCheckoutSession).not.toHaveBeenCalled();
    expect(deps.clearCart).not.toHaveBeenCalled();
  });
});
