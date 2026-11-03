import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ origins: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
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
