import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  select: vi.fn(),
  one: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mocks.auth },
    from: mocks.from,
  }),
}));
vi.mock('@/lib/payments/oxygen/customer-prefill', () => ({
  readOxygenCustomerPrefill: async () => ({
    first_name: 'Saved',
    last_name: 'Profile',
  }),
}));
vi.mock('@/components/storefront/ogabassey/pages/checkout-page', () => ({
  CheckoutPage: ({
    oxygenStep,
    oxygenSummary,
  }: {
    oxygenStep: React.ReactNode;
    oxygenSummary: React.ReactNode;
  }) => (
    <main>
      {oxygenStep}
      {oxygenSummary}
    </main>
  ),
}));
vi.mock('./OxygenRecoverySignIn', () => ({
  OxygenRecoverySignIn: () => <p>Sign in to resume</p>,
}));
vi.mock('./OxygenProviderFlow', () => ({
  OxygenProviderFlow: ({
    orderId,
    prefill,
    productAmount,
    products,
  }: {
    orderId: string;
    productAmount?: number;
    products?: { name: string; imageUrl?: string | null }[];
    prefill?: { first_name?: string };
  }) => (
    <p>
      Verify {orderId} for {prefill?.first_name}
      <span>Plan amount: {productAmount}</span>
      <span>
        Financed product: {products?.[0]?.name} {products?.[0]?.imageUrl}
      </span>
    </p>
  ),
}));

import { OxygenStorefrontCheckout } from './OxygenStorefrontCheckout';

const id = '6974e8cc-4e90-4ca9-b2cf-aa2abaf461df';
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  vi.clearAllMocks();
  const query = {
    select: mocks.select,
    eq: mocks.eq,
    maybeSingle: mocks.one,
  };
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.from.mockReturnValue(query);
  mocks.auth.mockResolvedValue({
    data: { user: { id: 'customer' } },
    error: null,
  });
  mocks.one.mockResolvedValue({
    error: null,
    data: {
      id,
      merchant_id: 'merchant',
      customer_id: 'customer-row',
      payment_method: 'oxygen',
      customers: {
        id: 'customer-row',
        merchant_id: 'merchant',
        user_id: 'customer',
      },
      customer_name: 'Ada Buyer',
      customer_email: 'ada@example.com',
      currency: 'NGN',
      subtotal: 400000,
      shipping_fee: 0,
      tax_amount: 0,
      total: 400000,
      order_items: [
        {
          id,
          name: 'Saved phone',
          quantity: 1,
          price: 400000,
          image_url: null,
          products: { images: ['https://cdn.example.com/saved.jpg'] },
        },
      ],
    },
  });
  mocks.one.mockResolvedValueOnce({
    data: {
      id,
      customer_id: 'customer-row',
      merchant_id: 'merchant',
      payment_method: 'oxygen',
    },
    error: null,
  });
  mocks.one.mockResolvedValueOnce({
    data: { id: 'customer-row', merchant_id: 'merchant', user_id: 'customer' },
    error: null,
  });
});
it('rejects another customer even when database policies return the row', async () => {
  mocks.one.mockReset();
  mocks.one.mockResolvedValueOnce({
    data: {
      id,
      customer_id: 'other-customer',
      merchant_id: 'merchant',
      payment_method: 'oxygen',
      customer_name: 'Other Buyer',
      customer_email: 'other@example.com',
      currency: 'NGN',
      subtotal: 1,
      shipping_fee: 0,
      tax_amount: 0,
      total: 1,
      order_items: [],
    },
    error: null,
  });
  mocks.one.mockResolvedValueOnce({
    data: {
      id: 'other-customer',
      merchant_id: 'merchant',
      user_id: 'someone-else',
    },
    error: null,
  });
  await expect(
    OxygenStorefrontCheckout({
      orderId: id,
      merchantId: 'merchant',
      merchantSlug: 'shop',
    })
  ).rejects.toThrow('not found');
  expect(mocks.from).toHaveBeenCalledTimes(2);
  expect(mocks.select).toHaveBeenNthCalledWith(
    1,
    'id, customer_id, merchant_id, payment_method'
  );
  expect(mocks.select).toHaveBeenNthCalledWith(2, 'id, merchant_id, user_id');
});
it('rejects a changed customer binding on the detailed read', async () => {
  mocks.one
    .mockReset()
    .mockResolvedValueOnce({
      data: {
        id,
        customer_id: 'customer-row',
        merchant_id: 'merchant',
        payment_method: 'oxygen',
      },
      error: null,
    })
    .mockResolvedValueOnce({
      data: {
        id: 'customer-row',
        merchant_id: 'merchant',
        user_id: 'customer',
      },
      error: null,
    })
    .mockResolvedValueOnce({
      data: {
        id,
        customer_id: 'customer-row',
        merchant_id: 'merchant',
        payment_method: 'oxygen',
        customers: {
          id: 'customer-row',
          merchant_id: 'merchant',
          user_id: 'someone-else',
        },
        customer_name: 'Ada Buyer',
        customer_email: 'ada@example.com',
        currency: 'NGN',
        subtotal: 1,
        shipping_fee: 0,
        tax_amount: 0,
        total: 1,
        order_items: [],
      },
      error: null,
    });
  await expect(
    OxygenStorefrontCheckout({
      orderId: id,
      merchantId: 'merchant',
      merchantSlug: 'shop',
    })
  ).rejects.toThrow('not found');
});
it('resumes the merchant-scoped order and displays persisted totals and checkout contact', async () => {
  const checkout = await OxygenStorefrontCheckout({
    orderId: id,
    merchantId: 'merchant',
    merchantSlug: 'shop',
  });
  expect(checkout.props.verifiedOxygenOrderId).toBe(id);
  render(checkout);
  expect(mocks.eq).toHaveBeenCalledWith('merchant_id', 'merchant');
  expect(mocks.eq).toHaveBeenCalledWith('id', id);
  expect(mocks.eq).toHaveBeenCalledWith('payment_method', 'oxygen');
  expect(mocks.from.mock.calls.map(([table]) => table)).toEqual([
    'orders',
    'customers',
    'orders',
  ]);
  expect(screen.getByText('Saved phone')).toBeVisible();
  expect(screen.getByText('Qty: 1')).toBeVisible();
  expect(screen.getByRole('img', { name: 'Saved phone' })).toBeInTheDocument();
  expect(
    screen.getByRole('region', { name: 'Saved order summary' })
  ).toHaveTextContent('₦400,000.00');
  expect(screen.getByText(`Verify ${id} for Ada`)).toBeVisible();
  expect(screen.getByText('Plan amount: 400000')).toBeVisible();
  expect(
    screen.getByText(
      'Financed product: Saved phone https://cdn.example.com/saved.jpg'
    )
  ).toBeVisible();
});
it('refuses an order missing under caller RLS or belonging to a different merchant', async () => {
  mocks.one.mockReset().mockResolvedValue({ data: null, error: null });
  await expect(
    OxygenStorefrontCheckout({
      orderId: id,
      merchantId: 'other',
      merchantSlug: 'other',
    })
  ).rejects.toThrow('not found');
});
it('allows sign-in before checkout without reading private order data', async () => {
  mocks.auth.mockResolvedValue({ data: { user: null }, error: null });
  const checkout = await OxygenStorefrontCheckout({
    orderId: id,
    merchantId: 'merchant',
    merchantSlug: 'shop',
  });
  expect(checkout.props.verifiedOxygenOrderId).toBeUndefined();
  render(checkout);
  expect(screen.getByText('Sign in to resume')).toBeVisible();
  expect(mocks.from).not.toHaveBeenCalled();
});
