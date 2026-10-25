import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
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
    select: vi.fn().mockReturnThis(),
    eq: mocks.eq,
    maybeSingle: mocks.one,
  };
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
});
it('resumes the merchant-scoped order and displays persisted totals and checkout contact', async () => {
  render(
    await OxygenStorefrontCheckout({
      orderId: id,
      merchantId: 'merchant',
      merchantSlug: 'shop',
    })
  );
  expect(mocks.eq).toHaveBeenCalledWith('merchant_id', 'merchant');
  expect(mocks.eq).toHaveBeenCalledWith('id', id);
  expect(screen.getByText('Saved phone × 1')).toBeVisible();
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
  mocks.one.mockResolvedValue({ data: null, error: null });
  await expect(
    OxygenStorefrontCheckout({
      orderId: id,
      merchantId: 'other',
      merchantSlug: 'other',
    })
  ).rejects.toThrow('not found');
});
it('keeps sign-in inside checkout without reading private order data', async () => {
  mocks.auth.mockResolvedValue({ data: { user: null }, error: null });
  render(
    await OxygenStorefrontCheckout({
      orderId: id,
      merchantId: 'merchant',
      merchantSlug: 'shop',
    })
  );
  expect(screen.getByText(`Verify ${id} for`)).toBeVisible();
  expect(mocks.from).not.toHaveBeenCalled();
});

it('refuses a missing order total rather than displaying it as zero', async () => {
  const result = await mocks.one();
  mocks.one.mockResolvedValue({
    ...result,
    data: { ...result.data, total: null },
  });
  await expect(
    OxygenStorefrontCheckout({
      orderId: id,
      merchantId: 'merchant',
      merchantSlug: 'shop',
    })
  ).rejects.toThrow('not found');
});
