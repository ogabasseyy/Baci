import { beforeEach, expect, it } from 'vitest';
import {
  bumpCartSessionGeneration,
  getCartSessionGeneration,
  getCartSessionGenerationChange,
  getSharedCartImportReceipt,
  saveSharedCartImportReceipt,
  subscribeCartSessionGeneration,
} from './shared-cart-storage';

beforeEach(() => localStorage.clear());
it('does not share migration receipts across merchants', () => {
  saveSharedCartImportReceipt('merchant-a', {
    cartId: 'a',
    importedAt: '2026-10-14',
    lineCount: 2,
  });
  expect(getSharedCartImportReceipt('merchant-a')?.cartId).toBe('a');
  expect(getSharedCartImportReceipt('merchant-b')).toBeNull();
});
it('notifies only subscribed generation observers', () => {
  let count = 0;
  const unsubscribe = subscribeCartSessionGeneration(() => {
    count += 1;
  });
  bumpCartSessionGeneration();
  unsubscribe();
  bumpCartSessionGeneration();
  expect(count).toBe(1);
});
it('keeps transition metadata per merchant', () => {
  bumpCartSessionGeneration({
    merchantSlug: 'merchant-a',
    operationId: 'selection-a',
  });
  bumpCartSessionGeneration({
    merchantSlug: 'merchant-b',
    operationId: 'selection-b',
  });
  expect(
    getCartSessionGenerationChange('merchant-a')?.transition?.operationId
  ).toBe('selection-a');
  expect(
    getCartSessionGenerationChange('merchant-b')?.transition?.operationId
  ).toBe('selection-b');
});
it('scopes a merchant generation bump to that merchant only', () => {
  const otherBefore = getCartSessionGeneration('other-shop');
  const shopBefore = getCartSessionGeneration('shop');
  bumpCartSessionGeneration({ merchantSlug: 'shop' });
  expect(getCartSessionGeneration('other-shop')).toBe(otherBefore);
  expect(getCartSessionGeneration('shop')).toBeGreaterThan(shopBefore);
});
