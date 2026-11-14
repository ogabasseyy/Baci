import { expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import { applyStorefrontCartLineAdd } from './cart-line-add';

const product = {
  id: 'phone',
  merchant_id: 'm',
  name: 'Phone',
  price: 100,
} as Product;
const input = {
  product,
  productForCart: product,
  quantity: 1,
  caps: { cappedOfferAllocation: undefined, strictPool: undefined },
  assurance: {
    smartCartProEnabled: false,
    merchantSlug: 'shop',
    hasQuizVoucher: false,
  },
};
it('binds a fresh line to its add instance and retains that identity on merge', () => {
  const original = applyStorefrontCartLineAdd({
    ...input,
    previousCart: [],
    lineInstanceId: 'first',
  });
  const merged = applyStorefrontCartLineAdd({
    ...input,
    previousCart: original,
    lineInstanceId: 'second',
  });
  const readded = applyStorefrontCartLineAdd({
    ...input,
    previousCart: [],
    lineInstanceId: 'third',
  });
  expect(original[0].cartLineInstanceId).toBe('first');
  expect(merged[0].cartLineInstanceId).toBe('first');
  expect(merged[0].quantity).toBe(2);
  expect(readded[0].cartLineInstanceId).toBe('third');
});
it('preserves line instance identity across local cart storage', async () => {
  const { saveCartToStorage, getCartFromStorage } = await import(
    './cart-storage'
  );
  const original = applyStorefrontCartLineAdd({
    ...input,
    previousCart: [],
    lineInstanceId: 'first',
  });
  saveCartToStorage(original, 'identity-test');
  expect(getCartFromStorage('identity-test')[0].cartLineInstanceId).toBe(
    'first'
  );
  localStorage.removeItem('baci-cart-identity-test-guest');
});
