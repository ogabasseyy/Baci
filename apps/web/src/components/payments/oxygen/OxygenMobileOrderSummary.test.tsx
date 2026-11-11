import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-currency', () => ({
  useCurrency: () => ({
    currencyCode: 'NGN',
    formatCurrencyAuto: (n: number) => `₦${n.toLocaleString('en-NG')}`,
  }),
}));
vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: () => null,
}));

import { OxygenMobileOrderSummary } from './OxygenMobileOrderSummary';

it.each([
  0, 20000,
])('uses saved order amounts with %s wallet credit', (wallet_amount_used) => {
  const id = '6974e8cc-4e90-4ca9-b2cf-aa2abaf461df';
  render(
    <OxygenMobileOrderSummary
      order={{
        id,
        customer_name: 'Test buyer',
        customer_email: 'test@example.com',
        currency: 'NGN',
        subtotal: 400000,
        shipping_fee: 0,
        tax_amount: 0,
        total: 400000,
        wallet_amount_used,
        order_items: [{ id, name: 'Saved phone', price: 400000, quantity: 1 }],
      }}
    />
  );
  const toggle = screen.getByRole('button', { name: /show order summary/i });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).toHaveTextContent(
    wallet_amount_used > 0 ? '₦380,000' : '₦400,000'
  );
  expect(
    screen.getByText('Saved phone').closest('[aria-hidden]')
  ).toHaveAttribute('aria-hidden', 'true');
  fireEvent.click(toggle);
  expect(
    screen.getByRole('button', { name: /hide order summary/i })
  ).toHaveAttribute('aria-expanded', 'true');
  expect(
    screen.getByText('Saved phone').closest('[aria-hidden]')
  ).toHaveAttribute('aria-hidden', 'false');
});
