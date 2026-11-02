import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  }),
}));
vi.mock('@/lib/payments/oxygen/oxygen-hosted-origins', () => ({
  readOxygenHostedOrigins: () => ({
    hosted: ['https://payment.example.test'],
    selfie: ['https://selfie.example.test'],
  }),
}));
vi.mock('@/components/storefront/ogabassey/pages/checkout-page', () => ({
  CheckoutPage: ({ oxygenStep }: { oxygenStep: ReactNode }) => (
    <main>{oxygenStep}</main>
  ),
}));
vi.mock('./OxygenApplicationDialog', () => ({
  OxygenApplicationDialog: ({
    hostedOrigins,
    selfieOrigins,
  }: {
    hostedOrigins: string[];
    selfieOrigins: string[];
  }) => (
    <p>
      {hostedOrigins.join(',')} {selfieOrigins.join(',')}
    </p>
  ),
}));

import { OxygenStorefrontCheckout } from './OxygenStorefrontCheckout';

it('passes public payment and selfie origins to the resumed checkout before authentication', async () => {
  render(
    await OxygenStorefrontCheckout({
      orderId: 'order',
      merchantId: 'merchant',
      merchantSlug: 'shop',
    })
  );
  expect(
    screen.getByText('https://payment.example.test https://selfie.example.test')
  ).toBeVisible();
});
