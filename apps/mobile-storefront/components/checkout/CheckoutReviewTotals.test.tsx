import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { CheckoutReviewTotals } from './CheckoutReviewTotals';

const commonProps = {
  assuranceFee: 0,
  colors: Colors.light,
  deliveryFee: 3500,
  isDark: false,
  subtotal: 0,
  taxAmount: 262.5,
  taxRate: 0.075,
  total: 3762.5,
};

describe('CheckoutReviewTotals', () => {
  it('bugfix: shows a winner free delivery, no VAT and a zero total', () => {
    render(<CheckoutReviewTotals {...commonProps} prizeCheckout />);

    expect(screen.getByTestId('review-delivery-fee')).toHaveTextContent('Free');
    expect(screen.getByTestId('review-total')).toHaveTextContent('₦0');
    expect(screen.queryByText(/VAT/)).toBeNull();
    expect(screen.queryByText('₦3,500')).toBeNull();
  });

  it('shows the delivery fee, VAT and total for a paid order', () => {
    render(<CheckoutReviewTotals {...commonProps} subtotal={10000} />);

    expect(screen.getByTestId('review-delivery-fee')).toHaveTextContent(
      '₦3,500'
    );
    expect(screen.getByText('VAT (7.5%)')).toBeOnTheScreen();
    expect(screen.getByTestId('review-total')).toHaveTextContent('₦3,763');
  });

  it('shows device assurance only when there is a fee', () => {
    const { rerender } = render(<CheckoutReviewTotals {...commonProps} />);
    expect(screen.queryByText('Device Assurance')).toBeNull();

    rerender(<CheckoutReviewTotals {...commonProps} assuranceFee={2000} />);
    expect(screen.getByText('Device Assurance')).toBeOnTheScreen();
  });
});
