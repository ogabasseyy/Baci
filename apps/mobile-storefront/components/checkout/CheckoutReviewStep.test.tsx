import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { CheckoutReviewStep } from './CheckoutReviewStep';

const commonProps = {
  address: {
    address: '2 Olaide Tomori Street',
    city: 'Ikeja',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'Winner',
    phone: '08000000000',
    state: 'Lagos',
  },
  assuranceFee: 0,
  colors: Colors.light,
  deliveryFee: 0,
  deliveryMethod: 'door' as const,
  formContentPaddingBottom: 0,
  isDark: false,
  items: [
    {
      id: 'prize-1',
      name: 'iPhone XR',
      price: 0,
      product_id: 'product-1',
      quantity: 1,
      slug: 'iphone-xr',
    },
  ],
  onEditAddress: jest.fn(),
  onEditPayment: jest.fn(),
  subtotal: 0,
  taxAmount: null,
  taxRate: 0,
  total: 0,
};

describe('CheckoutReviewStep', () => {
  it('shows the no-payment message and hides payment editing in simulation', () => {
    render(
      <CheckoutReviewStep
        {...commonProps}
        prizeSimulation
        selectedPayment={null}
      />
    );

    expect(screen.getByText('Quiz prize · no payment required')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Edit payment method' })
    ).toBeNull();
  });

  it('shows the selected payment and edit action in normal checkout', () => {
    render(<CheckoutReviewStep {...commonProps} selectedPayment="paystack" />);

    // Matches the Payment step's label instead of naming the gateway.
    expect(screen.getByText('Pay with Card')).toBeTruthy();
    expect(screen.queryByText('Card Payment (Paystack)')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Edit payment method' })
    ).toBeTruthy();
  });

  it('shows the full door-delivery address with an Edit action', () => {
    const onEditAddress = jest.fn();
    render(
      <CheckoutReviewStep
        {...commonProps}
        onEditAddress={onEditAddress}
        selectedPayment="paystack"
      />
    );

    expect(
      screen.getByText('2 Olaide Tomori Street\nIkeja, Lagos')
    ).toBeTruthy();
    fireEvent.press(
      screen.getByRole('button', { name: 'Edit delivery address' })
    );
    expect(onEditAddress).toHaveBeenCalledTimes(1);
  });
});
