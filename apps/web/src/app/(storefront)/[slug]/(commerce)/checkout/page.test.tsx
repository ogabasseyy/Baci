import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('./checkout-content', () => ({
  CheckoutContent: () => {
    throw new Promise(() => {});
  },
}));

import CheckoutPage from './page';

it('streams a loading placeholder while checkout route data is pending', () => {
  render(<CheckoutPage params={new Promise(() => {})} />);
  const status = screen.getByRole('status', { name: 'Loading checkout' });
  expect(status).toHaveClass('ogabassey-checkout-page');
  expect(screen.getByText('Secure Checkout')).toBeInTheDocument();
  expect(screen.getByText('Contact Information')).toBeInTheDocument();
  expect(screen.getByText('Delivery Method')).toBeInTheDocument();
  expect(screen.getByText('Order Summary')).toBeInTheDocument();
  expect(screen.queryByText('Loading checkout…')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
