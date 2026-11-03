import { expect, it, vi } from 'vitest';
import { delegatedCartValue } from './storefront-cart-delegated-value';

const shared = {
  cartId: 'cart-1',
  discardLegacyImport: vi.fn(),
  importConflicts: [],
  importStatus: 'done',
  importWarnings: [],
  isTerminal: false,
  refreshSharedCart: vi.fn(),
  resolveImportConflicts: vi.fn(),
  retryPendingSync: vi.fn(),
  syncError: null,
  syncStatus: 'synced',
  version: 3,
} as never;

it('returns no delegated fields when not delegated', () => {
  expect(delegatedCartValue(false, shared)).toEqual({});
});

it('maps the shared result and builds the cart ref', () => {
  const value = delegatedCartValue(true, shared);
  expect(value.sharedCartRef).toEqual({ cartId: 'cart-1', version: 3 });
  expect(value.importStatus).toBe('done');
  expect(value.syncStatus).toBe('synced');
});

it('nulls the cart ref for a terminal cart', () => {
  const value = delegatedCartValue(true, {
    ...(shared as object),
    isTerminal: true,
  } as never);
  expect(value.sharedCartRef).toBeNull();
});
