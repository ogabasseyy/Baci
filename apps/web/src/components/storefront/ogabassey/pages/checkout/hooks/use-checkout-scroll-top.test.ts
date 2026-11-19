import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCheckoutScrollTop } from './use-checkout-scroll-top';

it('scrolls to the top once when checkout mounts', () => {
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const view = renderHook(() => useCheckoutScrollTop());
  expect(scroll).toHaveBeenCalledExactlyOnceWith(0, 0);
  view.rerender();
  expect(scroll).toHaveBeenCalledOnce();
  scroll.mockRestore();
});
