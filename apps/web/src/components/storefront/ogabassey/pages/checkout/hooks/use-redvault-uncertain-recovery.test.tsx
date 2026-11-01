import { renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { recoverRedvaultUncertainAttempt } from '../handlers/recover-redvault-uncertain-attempt';
import { useRedvaultUncertainRecovery } from './use-redvault-uncertain-recovery';

const state = vi.hoisted(() => ({ generation: 1, retiring: false }));
vi.mock('../redvault-uncertain-attempt', () => ({
  readRedvaultUncertainAttempt: vi.fn(() => ({ kind: 'pending' })),
}));
vi.mock('../handlers/recover-redvault-uncertain-attempt', () => ({
  recoverRedvaultUncertainAttempt: vi.fn(),
}));
vi.mock('@/hooks/cart/cart-session-write-fence', () => ({
  isCartSessionRetiring: () => state.retiring,
}));
vi.mock('@/hooks/cart/shared-cart-storage', () => ({
  getCartSessionGeneration: () => state.generation,
}));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  state.generation = 1;
  state.retiring = false;
});

it('restores the review after reload without starting a payment', async () => {
  const snapshot = { orderId: 'existing-order' } as never;
  vi.mocked(recoverRedvaultUncertainAttempt).mockResolvedValue({
    kind: 'recovered',
    snapshot,
  });
  const options = {
    merchantId: 'merchant-1',
    merchantSlug: 'store',
    isHydrated: true,
    pendingOrder: null,
    setPendingOrder: vi.fn(),
    setIsProcessing: vi.fn(),
    setCurrentStep: vi.fn(),
  };
  renderHook(() => useRedvaultUncertainRecovery(options), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    ),
  });
  await waitFor(() =>
    expect(options.setPendingOrder).toHaveBeenCalledWith(snapshot)
  );
  expect(options.setCurrentStep).toHaveBeenCalledWith('payment');
  expect(recoverRedvaultUncertainAttempt).toHaveBeenCalledOnce();
});

it('does not show a recovered order after the cart session changes', async () => {
  let finish!: (
    value: Awaited<ReturnType<typeof recoverRedvaultUncertainAttempt>>
  ) => void;
  vi.mocked(recoverRedvaultUncertainAttempt).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const options = {
    merchantId: 'merchant-1',
    merchantSlug: 'store',
    isHydrated: true,
    pendingOrder: null,
    setPendingOrder: vi.fn(),
    setIsProcessing: vi.fn(),
    setCurrentStep: vi.fn(),
  };
  renderHook(() => useRedvaultUncertainRecovery(options));
  state.generation = 2;
  finish({ kind: 'recovered', snapshot: { orderId: 'old-order' } as never });
  await waitFor(() =>
    expect(options.setIsProcessing).toHaveBeenLastCalledWith(false)
  );
  expect(options.setPendingOrder).not.toHaveBeenCalled();
});
