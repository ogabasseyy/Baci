import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CheckoutPageHeading } from './CheckoutPageHeading';

describe('CheckoutPageHeading', () => {
  it('renders the accessible checkout heading and encryption status', () => {
    render(<CheckoutPageHeading />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Secure Checkout' })
    ).toBeInTheDocument();
    expect(screen.getByText('SSL Encrypted')).toBeInTheDocument();
  });
});
