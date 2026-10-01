import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepairPickupPaymentReady } from './RepairPickupPaymentReady';

describe('RepairPickupPaymentReady', () => {
  it('shows the exact pickup fee and secure Paystack payment link', () => {
    render(
      <RepairPickupPaymentReady
        amount={8250}
        authorizationUrl="https://checkout.paystack.com/access-code"
        ticketNumber={42}
      />
    );

    expect(screen.getByText('Ticket #42')).toBeInTheDocument();
    expect(screen.getByText('₦8,250')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Pay securely with Paystack' })
    ).toHaveAttribute('href', 'https://checkout.paystack.com/access-code');
  });
});
