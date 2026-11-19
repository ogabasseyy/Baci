import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CheckoutSuccessLoading } from './checkout-success-loading';

describe('CheckoutSuccessLoading', () => {
  it('tells the shopper the order confirmation is loading', () => {
    render(<CheckoutSuccessLoading />);

    expect(screen.getByText(/loading order confirmation/i)).toBeInTheDocument();
  });
});
