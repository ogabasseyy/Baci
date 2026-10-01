import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { usePaymentReturnReset } from './use-payment-return-reset';

it('unlocks payment submission when Paystack return restores a frozen checkout', () => {
  const reset = vi.fn();
  renderHook(() => usePaymentReturnReset(reset));
  act(() =>
    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true })
    )
  );
  expect(reset).toHaveBeenCalledOnce();
});
it('does not clear an active submission during an ordinary page show', () => {
  const reset = vi.fn();
  const { unmount } = renderHook(() => usePaymentReturnReset(reset));
  act(() =>
    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: false })
    )
  );
  expect(reset).not.toHaveBeenCalled();
  unmount();
  act(() =>
    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true })
    )
  );
  expect(reset).not.toHaveBeenCalled();
});
