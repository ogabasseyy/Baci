import { beforeEach, expect, it } from 'vitest';
import {
  getCartFromStorage,
  getSharedCartImportReceipt,
  saveCartToStorage,
  saveSharedCartImportReceipt,
} from './cart-storage';
import { cartItem, snapshot } from './shared-cart-provisioning.test-support';
import { adoptTerminalSnapshotCache } from './shared-cart-terminal-adoption';

beforeEach(() => {
  window.localStorage.clear();
});

it('provisions preserved lines when the receipt belongs to a different cart', () => {
  const item = cartItem({ cartItemId: 'prod-1', quantity: 2 });
  saveCartToStorage([item], 'shop');
  saveSharedCartImportReceipt('shop', {
    cartId: 'cart-a',
    importedAt: '2026-10-26T00:00:00.000Z',
    lineCount: 1,
    consumedCartItemIds: ['prod-1'],
    consumedQuantities: { 'prod-1': 1 },
  });
  const outcome = adoptTerminalSnapshotCache(
    'shop',
    snapshot({ cartId: 'cart-b', state: 'completed' })
  );
  expect(outcome.kind).toBe('provision');
  // The mismatched receipt is left untouched and the preserved lines
  // are not rolled back.
  expect(getCartFromStorage('shop')).toHaveLength(1);
  expect(getSharedCartImportReceipt('shop')?.cartId).toBe('cart-a');
});

it('retains the remainder and checkpoints a matching receipt', () => {
  const item = cartItem({ cartItemId: 'prod-1', quantity: 3 });
  saveCartToStorage([item], 'shop');
  saveSharedCartImportReceipt('shop', {
    cartId: 'cart-b',
    importedAt: '2026-10-26T00:00:00.000Z',
    lineCount: 1,
    consumedCartItemIds: ['prod-1'],
    consumedQuantities: { 'prod-1': 1 },
  });
  const outcome = adoptTerminalSnapshotCache(
    'shop',
    snapshot({ cartId: 'cart-b', state: 'completed' })
  );
  expect(outcome.kind).toBe('provision');
  expect(getCartFromStorage('shop')[0].quantity).toBe(2);
  expect(getSharedCartImportReceipt('shop')?.consumedQuantities).toEqual({
    'prod-1': 0,
  });
});
