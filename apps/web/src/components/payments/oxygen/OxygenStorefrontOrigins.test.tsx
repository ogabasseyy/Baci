import { AuthSessionMissingError } from '@supabase/supabase-js';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  origins: vi.fn(),
  auth: vi.fn(),
  from: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mocks.auth },
    from: mocks.from,
  }),
}));
vi.mock('@/lib/payments/oxygen/oxygen-hosted-origins', () => ({
  readOxygenHostedOrigins: mocks.origins,
}));
vi.mock('./OxygenRecoverySignIn', () => ({
  OxygenRecoverySignIn: ({ merchantSlug }: { merchantSlug: string }) => (
    <p>Sign in for {merchantSlug}</p>
  ),
}));

import { OxygenStorefrontCheckout } from './OxygenStorefrontCheckout';

it('offers sign-in without loading hosted origins or private order data', async () => {
  mocks.auth.mockResolvedValue({ data: { user: null }, error: null });
  render(
    await OxygenStorefrontCheckout({
      orderId: 'order',
      merchantId: 'merchant',
      merchantSlug: 'shop',
    })
  );
  expect(screen.getByText('Sign in for shop')).toBeVisible();
  expect(mocks.origins).not.toHaveBeenCalled();
});

it.each([
  null,
  { id: 'customer' },
])('shows a manual retry instead of auto-reloading sign-in when auth fails with user %s', async (user) => {
  mocks.from.mockClear();
  mocks.auth.mockResolvedValue({
    data: { user },
    error: new Error('auth service unavailable'),
  });
  render(
    await OxygenStorefrontCheckout({
      orderId: 'order',
      merchantId: 'merchant',
      merchantSlug: 'shop',
    })
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'couldn’t confirm your sign-in'
  );
  expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
    'href',
    '/shop/checkout?oxygenOrderId=order'
  );
  expect(screen.queryByText('Sign in for shop')).toBeNull();
  expect(mocks.from).not.toHaveBeenCalled();
});

it('shows the normal store sign-in for a genuinely missing session', async () => {
  mocks.from.mockClear();
  mocks.auth.mockResolvedValue({
    data: { user: null },
    error: new AuthSessionMissingError(),
  });
  render(
    await OxygenStorefrontCheckout({
      orderId: 'order',
      merchantId: 'merchant',
      merchantSlug: 'shop',
    })
  );
  expect(screen.getByText('Sign in for shop')).toBeVisible();
  expect(mocks.from).not.toHaveBeenCalled();
});

it('does not trust a user returned alongside a missing-session error', async () => {
  mocks.from.mockClear();
  mocks.auth.mockResolvedValue({
    data: { user: { id: 'customer' } },
    error: new AuthSessionMissingError(),
  });
  render(
    await OxygenStorefrontCheckout({
      orderId: 'order',
      merchantId: 'merchant',
      merchantSlug: 'shop',
    })
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'couldn’t confirm your sign-in'
  );
  expect(screen.queryByText('Sign in for shop')).toBeNull();
  expect(mocks.from).not.toHaveBeenCalled();
});
