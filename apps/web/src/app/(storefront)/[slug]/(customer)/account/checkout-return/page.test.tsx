import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import CheckoutReturnPage from './page';

vi.mock('../../../customer-auth-layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./checkout-return', () => ({
  CheckoutReturn: ({ slug, next }: { slug: string; next?: string }) => (
    <p>
      {slug}: {next}
    </p>
  ),
}));

it('passes the merchant and saved checkout destination to the reconciliation page', async () => {
  render(
    await CheckoutReturnPage({
      params: Promise.resolve({ slug: 'shop' }),
      searchParams: Promise.resolve({ next: '/checkout' }),
    })
  );
  expect(screen.getByText('shop: /checkout')).toBeInTheDocument();
});
