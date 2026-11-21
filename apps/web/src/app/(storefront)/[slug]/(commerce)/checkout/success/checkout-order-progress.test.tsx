import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CheckoutOrderProgress } from './checkout-order-progress';

it('labels receipt of an invoice separately from a product order', () => {
  const { rerender } = render(<CheckoutOrderProgress isConfirmed isInvoice />);
  expect(screen.getByText('Invoice Generated')).toBeInTheDocument();
  rerender(<CheckoutOrderProgress isConfirmed={false} isInvoice={false} />);
  expect(screen.getByText('Order Received')).toBeInTheDocument();
});
