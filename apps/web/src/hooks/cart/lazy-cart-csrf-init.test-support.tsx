import type { ReactNode } from 'react';
import { resetCustomerSessionHintForTests } from '@/contexts/customer-session-hint';
import type { Product } from '@/lib/products';
import { resetCartSessionHintForTests } from './cart-session-hint';
import { StorefrontCartProvider } from './storefront-cart-provider';

export const MERCHANT_A_ID = '11111111-1111-4111-8111-111111111111';
export const MERCHANT_A_SLUG = 'store-a';
export const MERCHANT_B_ID = '22222222-2222-4222-8222-222222222222';
export const MERCHANT_B_SLUG = 'store-b';
export const CART_ID = '33333333-3333-4333-8333-333333333333';

export function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    brand: 'Brand',
    description: '',
    gtin: '',
    id: 'prod-1',
    image: '/prod-1.png',
    imageHint: 'product',
    imageLarge: '/prod-1-large.png',
    manage_stock: false,
    merchant_id: MERCHANT_A_ID,
    mpn: '',
    name: 'Phone',
    price: 100,
    slug: 'phone',
    status: 'active',
    stock: 10,
    ...overrides,
  } as Product;
}

export function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    cartId: CART_ID,
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    lines: [
      {
        id: 'line-1',
        item: { productId: 'prod-1' },
        lineTotalMinor: 10000,
        quantity: 1,
        unitPriceMinor: 10000,
      },
    ],
    merchantId: MERCHANT_A_ID,
    state: 'active',
    subtotalMinor: 10000,
    totalMinor: 10000,
    version: 1,
    ...overrides,
  };
}

export function clearAllCookies() {
  document.cookie = 'csrf-token=; Path=/; Max-Age=0';
  document.cookie = '__Host-csrf-token=; Path=/; Max-Age=0';
  resetCartSessionHintForTests();
  resetCustomerSessionHintForTests();
}

export function stubNavigatorLocks() {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (
        _name: string,
        optionsOrCb: unknown,
        maybeCb?: (lock: unknown) => Promise<unknown>
      ) => {
        const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
        return (cb as (lock: unknown) => Promise<unknown>)({});
      },
    },
  });
}

export function createWrapper(
  merchantId = MERCHANT_A_ID,
  merchantSlug = MERCHANT_A_SLUG
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StorefrontCartProvider
        merchantId={merchantId}
        merchantSlug={merchantSlug}
        sharedCartEnabled={true}
      >
        {children}
      </StorefrontCartProvider>
    );
  };
}
