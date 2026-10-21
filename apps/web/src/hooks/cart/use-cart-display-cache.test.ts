import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { getCartFromStorage, saveCartToStorage } from './cart-storage';
import { cartItem } from './shared-cart-provisioning.test-support';
import { useCartDisplayCache } from './use-cart-display-cache';
import { useSharedCartRuntime } from './use-shared-cart-runtime';

beforeEach(() => localStorage.clear());
it('preserves the import source until confirmed and strips voucher credentials on save', () => {
  saveCartToStorage([cartItem({ name: 'Saved' })], 'shop');
  const { rerender } = renderHook(
    ({ done }) => {
      const runtime = useSharedCartRuntime({
        merchantId: 'merchant',
        merchantSlug: 'shop',
        sessionGeneration: 1,
      });
      useCartDisplayCache({
        ...runtime,
        state: {
          ...runtime.state,
          generation: 1,
          importStatus: done ? 'done' : 'pending',
          display: [
            cartItem({
              name: 'Confirmed',
              quizVoucherToken: 'secret-test',
              quizAwardId: 'test-award',
            }),
          ],
        },
      });
    },
    { initialProps: { done: false } }
  );
  expect(getCartFromStorage('shop')[0].name).toBe('Saved');
  rerender({ done: true });
  expect(getCartFromStorage('shop')[0].name).toBe('Confirmed');
  expect(getCartFromStorage('shop')[0].quizVoucherToken).toBeUndefined();
  expect(getCartFromStorage('shop')[0].quizAwardId).toBeUndefined();
});
it('does not persist the old generation into a newly selected merchant', () => {
  saveCartToStorage([cartItem({ name: 'Other merchant' })], 'other');
  renderHook(() => {
    const runtime = useSharedCartRuntime({
      merchantId: 'other',
      merchantSlug: 'other',
      sessionGeneration: 2,
    });
    useCartDisplayCache({
      ...runtime,
      state: {
        ...runtime.state,
        generation: 1,
        importStatus: 'done',
        display: [cartItem({ name: 'Old merchant' })],
      },
    });
  });
  expect(getCartFromStorage('other')[0].name).toBe('Other merchant');
});
