import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  order: vi.fn(),
  merchant: vi.fn(),
  from: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mocks.auth },
    from: mocks.from,
  }),
}));
vi.mock('@/components/payments/oxygen/OxygenProviderFlow', () => ({
  OxygenProviderFlow: () => <p>Sign in to resume Oxygen</p>,
}));

import { OxygenPaymentContent } from './oxygen-payment-content';

const id = '6974e8cc-4e90-4ca9-b2cf-aa2abaf461df';
const props = { params: Promise.resolve({ orderId: id }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    data: { user: { id: 'customer' } },
    error: null,
  });
  mocks.order.mockResolvedValue({
    data: { merchant_id: 'merchant' },
    error: null,
  });
  mocks.merchant.mockResolvedValue({ data: { slug: 'shop' }, error: null });
  mocks.from.mockImplementation((table: string) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: table === 'orders' ? mocks.order : mocks.merchant,
  }));
});
it('redirects an existing handoff to the merchant checkout on the same order', async () => {
  await expect(OxygenPaymentContent(props)).rejects.toThrow(
    `redirect:/shop/checkout?oxygenOrderId=${id}`
  );
});
it('keeps sign-in available before reading order information', async () => {
  mocks.auth.mockResolvedValue({ data: { user: null }, error: null });
  render(await OxygenPaymentContent(props));
  expect(screen.getByText('Sign in to resume Oxygen')).toBeVisible();
  expect(mocks.from).not.toHaveBeenCalled();
});
it('does not redirect when caller RLS does not expose the order', async () => {
  mocks.order.mockResolvedValue({ data: null, error: null });
  await expect(OxygenPaymentContent(props)).rejects.toThrow('not found');
  expect(mocks.merchant).not.toHaveBeenCalled();
});
