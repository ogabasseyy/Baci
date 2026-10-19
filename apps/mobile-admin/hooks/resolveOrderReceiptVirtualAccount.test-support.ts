import { vi } from 'vitest';
import type { OrderDetailsRecord } from '@/components/orders/order-details.types';
import { resolveOrderReceiptVirtualAccount } from './resolveOrderReceiptVirtualAccount';

export function resolveReceiptVirtualAccount(
  ...args: Parameters<typeof resolveOrderReceiptVirtualAccount>
) {
  return resolveOrderReceiptVirtualAccount(...args);
}

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getSession: vi.fn(),
}));

export const receiptResolverTestMocks = {
  fetch: mocks.fetch,
  getSession: mocks.getSession,
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
    },
  },
}));

vi.mock('@/lib/api-client', () => ({
  BASE_URL: 'https://example.com',
}));

export function makeOrder(
  overrides: Partial<OrderDetailsRecord> = {}
): OrderDetailsRecord {
  return {
    id: 'order-1',
    amount_paid: 0,
    balance: 10000,
    created_at: '',
    customer_email: 'customer@example.com',
    customer_name: 'Ada',
    customer_phone: null,
    discount_amount: 0,
    order_number: 'ORD-1',
    payment_status: 'pending',
    shipping_address: null,
    shipping_status: 'pending',
    total: 10000,
    updated_at: '',
    ...overrides,
  };
}

export function authenticate() {
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: 'token' } },
  });
}

export function okJson(payload: unknown) {
  return { json: async () => payload, ok: true };
}

export function setupReceiptResolverTest() {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
}

export function teardownReceiptResolverTest() {
  vi.unstubAllGlobals();
}
