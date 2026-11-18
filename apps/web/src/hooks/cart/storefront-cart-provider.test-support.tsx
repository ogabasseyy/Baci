import type { CartLine, CartSnapshot } from '@baci/shared/cart';
import { vi } from 'vitest';
import type { Product } from '@/lib/products';
import {
  resetCartSessionHintForTests,
  writeCartSessionHint,
} from './cart-session-hint';
import { fetchSharedCartSnapshot } from './shared-cart-client';

export { resetCartSessionHintForTests, writeCartSessionHint };

export const PROVIDER_MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
export const PROVIDER_MERCHANT_B_ID = '33333333-3333-4333-8333-333333333333';
export const PROVIDER_SLUG = 'ogabassey';
export const PROVIDER_CART_ID = '22222222-2222-4222-8222-222222222222';

export function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
}

export function makeProviderProduct(
  overrides: Record<string, unknown> = {}
): Product {
  return {
    brand: 'Brand',
    description: '',
    gtin: '',
    id: 'prod-1',
    image: '/prod-1.png',
    imageHint: 'product',
    imageLarge: '/prod-1-large.png',
    manage_stock: false,
    merchant_id: PROVIDER_MERCHANT_ID,
    mpn: '',
    name: 'Phone',
    price: 100,
    slug: 'phone',
    status: 'active',
    stock: 10,
    ...overrides,
  } as Product;
}

export function makeProviderCartLine(
  overrides: Record<string, unknown> = {}
): CartLine {
  return {
    id: 'line-1',
    item: { productId: 'prod-1' },
    lineTotalMinor: 10000,
    quantity: 1,
    unitPriceMinor: 10000,
    ...overrides,
  } as CartLine;
}

export function makeProviderSnapshot(
  overrides: Record<string, unknown> = {}
): CartSnapshot {
  const lines = (overrides.lines as CartLine[] | undefined) ?? [
    makeProviderCartLine(),
  ];
  const subtotalMinor = lines.reduce(
    (sum, line) => sum + line.lineTotalMinor,
    0
  );
  return {
    cartId: PROVIDER_CART_ID,
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: '2026-10-19T04:00:00.000Z',
    lines,
    merchantId: PROVIDER_MERCHANT_ID,
    state: 'active',
    subtotalMinor,
    totalMinor: subtotalMinor,
    version: 3,
    ...overrides,
  } as CartSnapshot;
}

export function mockAdoptedProviderCart(
  lines: CartLine[] = [makeProviderCartLine()],
  version = 3
) {
  writeCartSessionHint(PROVIDER_MERCHANT_ID, '1');
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: makeProviderSnapshot({ lines, version }),
    warnings: [],
  });
}
