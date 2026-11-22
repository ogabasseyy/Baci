import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CheckoutOrderNextSteps } from './checkout-order-next-steps';

it('describes the email the buyer receives for the current checkout', () => {
  const { rerender } = render(<CheckoutOrderNextSteps isInvoice />);
  expect(screen.getByText('Invoice Sent to Email')).toBeInTheDocument();
  rerender(<CheckoutOrderNextSteps isInvoice={false} />);
  expect(screen.getByText('Order Confirmation Email')).toBeInTheDocument();
});
