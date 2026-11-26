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

it('uses the native expandable checkout summary with saved order amounts', () => {
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
        order_items: [{ id, name: 'Saved phone', price: 400000, quantity: 1 }],
      }}
    />
  );
  const toggle = screen.getByRole('button', { name: /show order summary/i });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).toHaveTextContent('₦400,000');
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

it('shows net remaining amount when store credit was pre-applied on the Oxygen order', () => {
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
        amount_paid: 100000,
        wallet_amount_used: 100000,
        order_items: [{ id, name: 'Saved phone', price: 400000, quantity: 1 }],
      }}
    />
  );
  const toggle = screen.getByRole('button', { name: /show order summary/i });
  expect(toggle).toHaveTextContent('₦300,000');
});

it('shows zero remaining amount when a credited Oxygen order is already paid', () => {
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
        payment_status: 'paid',
        amount_paid: 400000,
        wallet_amount_used: 100000,
        wallet_ledger_used: 100000,
        order_items: [{ id, name: 'Saved phone', price: 400000, quantity: 1 }],
      }}
    />
  );
  const toggle = screen.getByRole('button', { name: /show order summary/i });
  expect(toggle).toHaveTextContent('₦0');
});

it('shows zero remaining amount when a credited Oxygen order is bnpl_approved without double-counting store credit', () => {
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
        payment_status: 'bnpl_approved',
        amount_paid: 400000,
        wallet_amount_used: 100000,
        wallet_ledger_used: 100000,
        order_items: [{ id, name: 'Saved phone', price: 400000, quantity: 1 }],
      }}
    />
  );
  const toggle = screen.getByRole('button', { name: /show order summary/i });
  expect(toggle).toHaveTextContent('₦0');
  fireEvent.click(toggle);
  expect(screen.getByText('-₦100,000')).toBeInTheDocument();
});

it('shows remaining balance instead of zero for partially_paid Oxygen orders', () => {
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
        payment_status: 'partially_paid',
        amount_paid: 150000,
        wallet_amount_used: 50000,
        wallet_ledger_used: 50000,
        order_items: [{ id, name: 'Saved phone', price: 400000, quantity: 1 }],
      }}
    />
  );
  const toggle = screen.getByRole('button', { name: /show order summary/i });
  expect(toggle).toHaveTextContent('₦250,000');
});
