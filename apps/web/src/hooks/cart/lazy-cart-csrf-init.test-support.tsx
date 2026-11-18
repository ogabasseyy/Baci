import type { CartSnapshot } from '@baci/shared/cart';
import type { ReactNode } from 'react';
import { resetCustomerSessionHintForTests } from '@/contexts/customer-session-hint';
import type { Product } from '@/lib/products';
import { resetCartSessionHintForTests } from './cart-session-hint';
import { StorefrontCartProvider } from './storefront-cart-provider';

const MERCHANT_A_ID = '11111111-1111-4111-8111-111111111111';
const MERCHANT_A_SLUG = 'store-a';
const MERCHANT_B_ID = '22222222-2222-4222-8222-222222222222';
const MERCHANT_B_SLUG = 'store-b';
const CART_ID = '33333333-3333-4333-8333-333333333333';

type MockLockCallback<T> = (lock: Lock | null) => Promise<T> | T;

function mockLockRequest<T>(
  name: string,
  callback: MockLockCallback<T>
): Promise<T>;
function mockLockRequest<T>(
  name: string,
  options: LockOptions,
  callback: MockLockCallback<T>
): Promise<T>;
function mockLockRequest<T>(
  _name: string,
  optionsOrCallback: LockOptions | MockLockCallback<T>,
  maybeCallback?: MockLockCallback<T>
): Promise<T> {
  const callback =
    typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
  if (typeof callback !== 'function') {
    throw new TypeError('navigator.locks.request requires a callback');
  }
  return Promise.resolve(callback(null));
}

function makeProduct(overrides: Partial<Product> = {}): Product {
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
  };
}

function makeSnapshot(overrides: Partial<CartSnapshot> = {}): CartSnapshot {
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

function clearAllCookies() {
  document.cookie = 'csrf-token=; Path=/; Max-Age=0';
  document.cookie = '__Host-csrf-token=; Path=/; Max-Age=0';
  resetCartSessionHintForTests();
  resetCustomerSessionHintForTests();
}

function stubNavigatorLocks() {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: mockLockRequest },
  });
}

function createWrapper(
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

export const lazyCartCsrfHarness = {
  CART_ID,
  MERCHANT_A_ID,
  MERCHANT_A_SLUG,
  MERCHANT_B_ID,
  MERCHANT_B_SLUG,
  clearAllCookies,
  createWrapper,
  makeProduct,
  makeSnapshot,
  stubNavigatorLocks,
} as const;
