import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCartStorage,
  generateCartItemId,
  getCartFromStorage,
  getMerchantSlugFromStorage,
  saveCartToStorage,
  saveMerchantSlugToStorage,
} from './cart-persistence';
import {
  getCartSessionGeneration,
  getSharedCartImportReceipt,
  saveSharedCartImportReceipt,
} from './cart-storage';
import type { CartItem, SharedCartDisplayItem } from './cart-types';

function makeLine(overrides: Record<string, unknown> = {}): CartItem {
  return {
    cartItemId: 'line-1',
    id: 'prod-1',
    name: 'Test Product',
    price: 1000,
    quantity: 2,
    ...overrides,
  } as unknown as CartItem;
}

describe('cart-persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe('generateCartItemId', () => {
    it('returns the product id when no options are given', () => {
      expect(generateCartItemId('prod-1')).toBe('prod-1');
    });

    it('includes variant, color, and condition deterministically', () => {
      expect(
        generateCartItemId('prod-1', {
          variantId: 'v1',
          color: 'red',
          condition: 'new',
        })
      ).toBe('prod-1::variant=v1::color=red::condition=new');
    });

    it('sorts extra attributes for stable ids', () => {
      const first = generateCartItemId('prod-1', {
        storage: '256GB',
        color: 'red',
      } as never);
      const second = generateCartItemId('prod-1', {
        color: 'red',
        storage: '256GB',
      } as never);
      expect(first).toBe(second);
      expect(first).toContain('storage=256GB');
    });
  });

  describe('saveCartToStorage / getCartFromStorage', () => {
    it('round-trips carts namespaced by merchant and user', () => {
      saveCartToStorage([makeLine()], 'acme', 'user-1');

      expect(
        window.localStorage.getItem('baci-cart-acme-user-1')
      ).not.toBeNull();
      expect(getCartFromStorage('acme', 'user-1')).toHaveLength(1);
      // Other namespaces are isolated.
      expect(getCartFromStorage('acme', 'user-2')).toHaveLength(0);
      expect(getCartFromStorage('other', 'user-1')).toHaveLength(0);
    });

    it('falls back to the guest namespace without a user', () => {
      saveCartToStorage([makeLine()], 'acme');

      expect(
        window.localStorage.getItem('baci-cart-acme-guest')
      ).not.toBeNull();
      expect(getCartFromStorage('acme')).toHaveLength(1);
    });

    it('drops malformed lines and normalizes numbers', () => {
      window.localStorage.setItem(
        'baci-cart-acme-guest',
        JSON.stringify([
          null,
          { id: 'no-name' },
          {
            id: 'prod-1',
            name: 'Priced as string',
            price: '1500',
            quantity: '3',
          },
          {
            id: 'prod-2',
            name: 'NaN price',
            price: Number.NaN,
            quantity: Number.NaN,
          },
        ])
      );

      const lines = getCartFromStorage('acme');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({ price: 1500, quantity: 3 });
      expect(lines[0].cartItemId).toContain('prod-1');
      expect(lines[1]).toMatchObject({ price: 0, quantity: 1 });
    });

    it('returns an empty cart for invalid JSON', () => {
      window.localStorage.setItem('baci-cart-acme-guest', 'not-json{');
      expect(getCartFromStorage('acme')).toEqual([]);
    });
  });

  describe('clearCartStorage', () => {
    it('clears the merchant user cart, guest cart, and legacy keys', () => {
      saveCartToStorage([makeLine()], 'acme', 'user-1');
      saveCartToStorage([makeLine()], 'acme');
      window.localStorage.setItem('baci-cart', '[]');
      window.localStorage.setItem('baci-cart-guest', '[]');
      saveCartToStorage([makeLine()], 'other', 'user-1');

      clearCartStorage('acme', 'user-1');

      expect(window.localStorage.getItem('baci-cart-acme-user-1')).toBeNull();
      expect(window.localStorage.getItem('baci-cart-acme-guest')).toBeNull();
      expect(window.localStorage.getItem('baci-cart')).toBeNull();
      expect(window.localStorage.getItem('baci-cart-guest')).toBeNull();
      // Unrelated merchants keep their carts.
      expect(
        window.localStorage.getItem('baci-cart-other-user-1')
      ).not.toBeNull();
    });

    it('clears the import receipt and fences the session generation', () => {
      saveSharedCartImportReceipt('acme', {
        cartId: '22222222-2222-4222-8222-222222222222',
        importedAt: '2026-10-12T08:00:00.000Z',
        lineCount: 1,
      });
      const start = getCartSessionGeneration();

      clearCartStorage('acme', 'user-1');

      expect(getSharedCartImportReceipt('acme')).toBeNull();
      expect(getCartSessionGeneration()).toBe(start + 1);
    });

    it('scopes the generation fence to the cleared merchant', () => {
      const otherBefore = getCartSessionGeneration('other');
      const acmeBefore = getCartSessionGeneration('acme');
      clearCartStorage('acme', 'user-1');
      expect(getCartSessionGeneration('other')).toBe(otherBefore);
      expect(getCartSessionGeneration('acme')).toBeGreaterThan(acmeBefore);
    });
  });

  describe('shared-cart markers', () => {
    it('drops temp optimistic markers when normalizing stored lines', () => {
      window.localStorage.setItem(
        'baci-cart-acme-guest',
        JSON.stringify([
          {
            id: 'prod-1',
            name: 'Temp line',
            price: 1000,
            quantity: 1,
            pendingTempId: 'temp-1',
            hydrationFailed: true,
            serverLineId: 'line-1',
          },
        ])
      );

      const [line] = getCartFromStorage('acme') as SharedCartDisplayItem[];
      expect(line.pendingTempId).toBeUndefined();
      expect(line.hydrationFailed).toBeUndefined();
      expect(line.serverLineId).toBe('line-1');
    });
  });

  describe('merchant slug storage', () => {
    it('round-trips the slug and removes it on null', () => {
      expect(getMerchantSlugFromStorage()).toBeNull();

      saveMerchantSlugToStorage('acme');
      expect(getMerchantSlugFromStorage()).toBe('acme');

      saveMerchantSlugToStorage(null);
      expect(getMerchantSlugFromStorage()).toBeNull();
    });
  });
});
