import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PaymentInstallmentDetails } from './PaymentInstallmentDetails';

describe('PaymentInstallmentDetails', () => {
  it('renders the selected provider guidance', () => {
    render(<PaymentInstallmentDetails paymentMethod="credit_direct" />);

    expect(screen.getByText('How Credit Direct works')).toBeInTheDocument();
    expect(screen.getByText('- Instant approval decision')).toBeInTheDocument();
  });

  it('renders no guidance for retired CredPal', () => {
    const { container } = render(<PaymentInstallmentDetails paymentMethod="credpal" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders no guidance for a non-installment method', () => {
    const { container } = render(
      <PaymentInstallmentDetails paymentMethod="paystack" />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
