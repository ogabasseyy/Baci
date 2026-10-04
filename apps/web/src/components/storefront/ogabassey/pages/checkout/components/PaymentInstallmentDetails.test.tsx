import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PaymentInstallmentDetails } from './PaymentInstallmentDetails';

describe('PaymentInstallmentDetails', () => {
  it('renders the selected provider guidance', () => {
    render(<PaymentInstallmentDetails paymentMethod="credpal" />);

    expect(screen.getByText('How CredPal works')).toBeInTheDocument();
    expect(screen.getByText('- Quick approval in minutes')).toBeInTheDocument();
  });

  it('renders no guidance for a non-installment method', () => {
    const { container } = render(
      <PaymentInstallmentDetails paymentMethod="paystack" />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
