import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useOxygenPaymentReturn } from './use-oxygen-payment-return';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('checks once when the payment view closes and never just because the plan rendered', () => {
  const check = vi.fn();
  const { rerender } = renderHook(
    ({ open }) => useOxygenPaymentReturn(open, false, check),
    { initialProps: { open: false } }
  );
  expect(check).not.toHaveBeenCalled();
  rerender({ open: true });
  expect(check).not.toHaveBeenCalled();
  rerender({ open: false });
  expect(check).toHaveBeenCalledTimes(1);
  rerender({ open: false });
  expect(check).toHaveBeenCalledTimes(1);
});
it('checks on return from another tab during payment, with no check for repeated visible events', () => {
  const check = vi.fn();
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible');
  renderHook(() => useOxygenPaymentReturn(true, false, check));
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(check).not.toHaveBeenCalled();
  visibility.mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  visibility.mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(check).toHaveBeenCalledTimes(1);
});
it('does not check outside a payment session or after both steps are confirmed', () => {
  const check = vi.fn();
  const { rerender } = renderHook(
    ({ open, complete }) => useOxygenPaymentReturn(open, complete, check),
    { initialProps: { open: false, complete: false } }
  );
  act(() => window.dispatchEvent(new Event('pageshow')));
  expect(check).not.toHaveBeenCalled();
  rerender({ open: true, complete: true });
  rerender({ open: false, complete: true });
  expect(check).not.toHaveBeenCalled();
});
