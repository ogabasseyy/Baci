import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CheckoutOrderDocuments } from './checkout-order-documents';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

it('links invoices to receipts and standard orders to account documents', () => {
  const getHref = (path: string) => `/store${path}`;
  const { rerender } = render(
    <CheckoutOrderDocuments isInvoice getHref={getHref} />
  );
  expect(
    screen.getByRole('link', { name: 'Download Proforma Invoice PDF' })
  ).toHaveAttribute('href', '/store/receipts');
  rerender(<CheckoutOrderDocuments isInvoice={false} getHref={getHref} />);
  expect(
    screen.getByRole('link', { name: 'View Order Documents' })
  ).toHaveAttribute('href', '/store/account/orders');
});
