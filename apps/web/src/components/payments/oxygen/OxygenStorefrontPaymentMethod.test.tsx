import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  one: vi.fn(),
  from: vi.fn(),
  prefill: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user' } }, error: null }),
    },
    from: mocks.from,
  }),
}));
vi.mock('@/lib/payments/oxygen/customer-prefill', () => ({
  readOxygenCustomerPrefill: mocks.prefill,
}));

import { OxygenStorefrontCheckout } from './OxygenStorefrontCheckout';

const id = '6974e8cc-4e90-4ca9-b2cf-aa2abaf461df';
const args = { orderId: id, merchantId: 'merchant', merchantSlug: 'shop' };
const identity = {
  id,
  customer_id: 'customer-row',
  merchant_id: 'merchant',
  payment_method: 'oxygen',
};
const customer = {
  id: 'customer-row',
  merchant_id: 'merchant',
  user_id: 'user',
};
const detail = {
  ...identity,
  customers: customer,
  customer_name: 'Buyer',
  customer_email: 'buyer@example.test',
  currency: 'NGN',
  subtotal: 1,
  shipping_fee: 0,
  tax_amount: 0,
  total: 1,
  order_items: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: mocks.one,
  };
  mocks.from.mockReturnValue(query);
  mocks.one.mockReset();
});

it('rejects an owned non-Oxygen order before reading customer or contact data, even with permissive RLS', async () => {
  mocks.one.mockResolvedValueOnce({
    data: { ...identity, payment_method: 'card' },
    error: null,
  });
  await expect(OxygenStorefrontCheckout(args)).rejects.toThrow('not found');
  expect(mocks.from).toHaveBeenCalledTimes(1);
  expect(mocks.prefill).not.toHaveBeenCalled();
});

it('rechecks the payment method on the detailed read before displaying an order', async () => {
  mocks.one
    .mockResolvedValueOnce({ data: identity, error: null })
    .mockResolvedValueOnce({ data: customer, error: null })
    .mockResolvedValueOnce({
      data: { ...detail, payment_method: 'card' },
      error: null,
    });
  await expect(OxygenStorefrontCheckout(args)).rejects.toThrow('not found');
  expect(mocks.prefill).not.toHaveBeenCalled();
});

it('refuses a missing order total instead of treating it as zero', async () => {
  mocks.one
    .mockResolvedValueOnce({ data: identity, error: null })
    .mockResolvedValueOnce({ data: customer, error: null })
    .mockResolvedValueOnce({ data: { ...detail, total: null }, error: null });
  await expect(OxygenStorefrontCheckout(args)).rejects.toThrow('not found');
  expect(mocks.prefill).not.toHaveBeenCalled();
});
