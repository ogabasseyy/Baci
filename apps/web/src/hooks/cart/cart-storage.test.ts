import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bumpCartSessionGeneration,
  clearSharedCartImportReceipt,
  generateCartItemId,
  getCartFromStorage,
  getCartSessionGeneration,
  getCartWideNegotiationFromStorage,
  getMerchantSlugFromStorage,
  getSharedCartImportReceipt,
  getStorefrontCartStorageKey,
  saveCartToStorage,
  saveCartWideNegotiationToStorage,
  saveMerchantSlugToStorage,
  saveSharedCartImportReceipt,
  stripUnconfirmedDisplayLines,
  subscribeCartSessionGeneration,
} from './cart-storage';
import type { CartItem, SharedCartDisplayItem } from './cart-types';

const logger = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger,
}));

function makeCartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'cart-item-1',
    cartItemId: 'cart-item-1',
    name: 'iPhone 16',
    description: '',
    status: 'active',
    price: 1200000,
    manage_stock: true,
    stock: 1,
    image: '/iphone-16.png',
    imageLarge: '/iphone-16.png',
    imageHint: 'iphone 16',
    brand: 'Apple',
    gtin: '',
    mpn: '',
    quantity: 1,
    ...overrides,
  };
}

describe('cart-storage', () => {
  beforeEach(() => {
    localStorage.clear();
    logger.error.mockReset();
  });

  it('builds the guest cart storage key from the merchant slug', () => {
    expect(getStorefrontCartStorageKey('ogabassey')).toBe(
      'baci-cart-ogabassey-guest'
    );
    expect(getStorefrontCartStorageKey()).toBe('baci-cart-guest');
  });

  it('creates stable cart item identifiers from options', () => {
    expect(
      generateCartItemId('product-1', {
        variantId: 'variant-1',
        color: 'Black',
        condition: 'new',
        secondaryColor: 'Silver',
        storage: '256GB',
      })
    ).toBe(
      'product-1::variant=variant-1::color=Black::secondaryColor=Silver::condition=new::storage=256GB'
    );
  });

  it('filters invalid storage entries and coerces price and quantity values', () => {
    localStorage.setItem(
      'baci-cart-ogabassey-guest',
      JSON.stringify([
        {
          id: 'cart-item-1',
          name: 'iPhone 16',
          price: '1200000',
          quantity: '2',
        },
        { id: 1, name: 'Broken item' },
      ])
    );

    expect(getCartFromStorage('ogabassey')).toEqual([
      expect.objectContaining({
        id: 'cart-item-1',
        name: 'iPhone 16',
        price: 1200000,
        quantity: 2,
      }),
    ]);
  });

  it('returns an empty cart and logs when stored JSON is invalid', () => {
    localStorage.setItem('baci-cart-guest', '{bad json');

    expect(getCartFromStorage()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to read cart from localStorage',
      })
    );
  });

  it('persists the cart and merchant slug values', () => {
    saveCartToStorage([makeCartItem()], 'ogabassey');
    saveMerchantSlugToStorage('ogabassey');

    expect(
      JSON.parse(localStorage.getItem('baci-cart-ogabassey-guest') || '[]')
    ).toEqual([
      expect.objectContaining({ id: 'cart-item-1', name: 'iPhone 16' }),
    ]);
    expect(getMerchantSlugFromStorage()).toBe('ogabassey');

    saveMerchantSlugToStorage(null);

    expect(getMerchantSlugFromStorage()).toBeNull();
  });

  it('persists and clears the cart-wide negotiation flag per merchant', () => {
    expect(getCartWideNegotiationFromStorage('ogabassey')).toBe(false);

    saveCartWideNegotiationToStorage(true, 'ogabassey');
    expect(getCartWideNegotiationFromStorage('ogabassey')).toBe(true);
    // Scoped per merchant — a different slug is unaffected.
    expect(getCartWideNegotiationFromStorage('other')).toBe(false);

    saveCartWideNegotiationToStorage(false, 'ogabassey');
    expect(getCartWideNegotiationFromStorage('ogabassey')).toBe(false);
  });

  it('logs and stays safe when persisting the group flag throws', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota exceeded');
      });

    expect(() =>
      saveCartWideNegotiationToStorage(true, 'ogabassey')
    ).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to save cart-wide negotiation flag',
      })
    );

    setItem.mockRestore();
  });

  it('returns false when reading the group flag throws', () => {
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('storage unavailable');
      });

    expect(getCartWideNegotiationFromStorage('ogabassey')).toBe(false);

    getItem.mockRestore();
  });

  it('round-trips the legacy import receipt per merchant slug', () => {
    expect(getSharedCartImportReceipt('ogabassey')).toBeNull();

    saveSharedCartImportReceipt('ogabassey', {
      cartId: '22222222-2222-4222-8222-222222222222',
      importedAt: '2026-10-12T08:00:00.000Z',
      lineCount: 2,
    });

    expect(getSharedCartImportReceipt('ogabassey')).toEqual({
      cartId: '22222222-2222-4222-8222-222222222222',
      importedAt: '2026-10-12T08:00:00.000Z',
      lineCount: 2,
    });
    // A different merchant slug keeps its own receipt.
    expect(getSharedCartImportReceipt('other')).toBeNull();

    clearSharedCartImportReceipt('ogabassey');
    expect(getSharedCartImportReceipt('ogabassey')).toBeNull();
  });

  it('never persists voucher credentials in the display cache', () => {
    const persistable = stripUnconfirmedDisplayLines([
      {
        cartItemId: 'line-2',
        id: 'prod-2',
        name: 'Voucher phone',
        pendingTempId: null,
        price: 0,
        quantity: 1,
        quizAwardId: 'award-secret',
        quizVoucherToken: 'token-secret',
        serverLineId: 'line-2',
      },
    ] as SharedCartDisplayItem[]);

    expect(persistable).toHaveLength(1);
    expect(JSON.stringify(persistable)).not.toContain('token-secret');
    expect(JSON.stringify(persistable)).not.toContain('award-secret');
    expect(persistable[0]).not.toHaveProperty('quizVoucherToken');
    expect(persistable[0]).not.toHaveProperty('quizAwardId');
  });

  it('strips unconfirmed temp lines before persisting the display', () => {
    const persistable = stripUnconfirmedDisplayLines([
      {
        cartItemId: 'line-1',
        id: 'prod-1',
        name: 'Phone',
        pendingTempId: null,
        price: 100,
        quantity: 1,
        serverLineId: 'line-1',
      },
      {
        cartItemId: 'temp:temp-1',
        hydrationFailed: true,
        id: 'prod-9',
        name: 'Camera',
        pendingTempId: 'temp-1',
        price: 250,
        quantity: 1,
        serverLineId: null,
      },
    ] as SharedCartDisplayItem[]);

    expect(persistable).toHaveLength(1);
    expect(persistable[0]).toMatchObject({ id: 'prod-1' });
    expect(persistable[0]).not.toHaveProperty('pendingTempId');
    expect(persistable[0]).not.toHaveProperty('hydrationFailed');
  });

  it('rejects malformed import receipts instead of importing twice', () => {
    localStorage.setItem('baci-cart-ogabassey-shared-import', '{bad json');
    expect(getSharedCartImportReceipt('ogabassey')).toBeNull();

    localStorage.setItem(
      'baci-cart-ogabassey-shared-import',
      JSON.stringify({ cartId: 42 })
    );
    expect(getSharedCartImportReceipt('ogabassey')).toBeNull();
  });

  it('drops temp optimistic markers when reading stored lines', () => {
    localStorage.setItem(
      'baci-cart-ogabassey-guest',
      JSON.stringify([
        {
          id: 'cart-item-1',
          name: 'iPhone 16',
          price: 1200000,
          quantity: 1,
          pendingTempId: 'temp-1',
          hydrationFailed: true,
          serverLineId: 'line-1',
        },
      ])
    );

    const [line] = getCartFromStorage('ogabassey') as SharedCartDisplayItem[];
    expect(line.pendingTempId).toBeUndefined();
    expect(line.hydrationFailed).toBeUndefined();
    expect(line.serverLineId).toBe('line-1');
  });

  it('bumps the session generation and notifies subscribers', () => {
    const start = getCartSessionGeneration();
    const listener = vi.fn();
    const unsubscribe = subscribeCartSessionGeneration(listener);

    expect(bumpCartSessionGeneration()).toBe(start + 1);
    expect(getCartSessionGeneration()).toBe(start + 1);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    bumpCartSessionGeneration();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
