import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import CheckoutLoading from './loading';

it('exposes a busy checkout status while hiding the skeleton from assistive technology', () => {
  render(<CheckoutLoading />);
  expect(
    screen.getByRole('status', { name: 'Loading checkout' })
  ).toHaveAttribute('aria-busy', 'true');
  expect(
    screen.getByText('Secure Checkout').closest('[aria-hidden]')
  ).toHaveAttribute('aria-hidden', 'true');
});
