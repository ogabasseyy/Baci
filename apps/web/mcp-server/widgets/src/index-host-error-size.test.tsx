import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const cartState = vi.hoisted(() => ({
  cart: [],
  canReviewCart: false,
  cartError: null,
  cartNotice: null,
  isSavingCart: false,
  handleAddToCart: vi.fn(),
  handleRemoveItem: vi.fn(),
  handleViewCart: vi.fn(),
}));
vi.mock('./hooks/use-cart-handoff', () => ({
  useCartHandoff: () => cartState,
}));
import { App } from './index';
const products = [{ id: 'phone', name: 'Phone', price: 100 }];
afterEach(() => {
  delete window.openai;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('resizes when host errors appear and clear without ResizeObserver', () => {
  vi.stubGlobal('ResizeObserver', undefined);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return {
        height: this.querySelector('[role="alert"]') ? 240 : 200,
      } as DOMRect;
    },
  );
  const notifyIntrinsicHeight = vi.fn();
  window.openai = {
    toolOutput: { products },
    displayMode: 'inline',
    notifyIntrinsicHeight,
  };
  render(<App />);
  expect(notifyIntrinsicHeight).toHaveBeenLastCalledWith(200);
  for (const hostError of ['Could not open Ogabassey.', null]) {
    act(() => {
      if (window.openai) window.openai.hostError = hostError;
      window.dispatchEvent(
        new CustomEvent('openai:set_globals', {
          detail: { globals: { hostError } },
        }),
      );
    });
    expect(notifyIntrinsicHeight).toHaveBeenLastCalledWith(
      hostError ? 240 : 200,
    );
  }
});
