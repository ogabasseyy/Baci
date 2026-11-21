import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { CheckoutBottomAction } from './CheckoutBottomAction';

const commonProps = {
  animatedCtaArrowStyle: undefined,
  canContinue: true,
  colors: Colors.light,
  displayTotal: 0,
  insetsBottom: 0,
  isProcessing: false,
  itemCount: 1,
  onContinue: jest.fn(),
  onPlaceOrder: jest.fn(),
  step: 'review' as const,
  total: 0,
};

describe('CheckoutBottomAction', () => {
  it('begins the instalment application instead of implying the order is confirmed', () => {
    render(
      <CheckoutBottomAction
        {...commonProps}
        displayTotal={45000}
        selectedPayment="oxygen"
        total={45000}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Begin process for ₦45,000' })
    ).toBeTruthy();
    expect(screen.getByText('Begin process')).toBeTruthy();
    expect(screen.queryByText('Place Order')).toBeNull();
  });
  it.each([
    'credit_direct',
    'klump',
  ] as const)('preserves the standard order action for %s', (selectedPayment) => {
    render(
      <CheckoutBottomAction
        {...commonProps}
        selectedPayment={selectedPayment}
      />
    );
    expect(screen.getByText('Place Order')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Place order for ₦0' })
    ).toBeTruthy();
  });

  it('enables the simulated completion action without a payment selection', () => {
    render(
      <CheckoutBottomAction
        {...commonProps}
        prizeSimulation
        selectedPayment={null}
      />
    );

    const action = screen.getByRole('button', {
      name: 'Complete test prize checkout',
    });
    expect(screen.getByText('Complete test checkout')).toBeTruthy();
    expect(action.props.accessibilityState.disabled).toBe(false);
  });

  it('keeps normal order submission disabled without a payment selection', () => {
    render(<CheckoutBottomAction {...commonProps} selectedPayment={null} />);

    const action = screen.getByRole('button', {
      name: 'Place order for ₦0',
    });
    expect(screen.getByText('Place Order')).toBeTruthy();
    expect(action.props.accessibilityState.disabled).toBe(true);
  });

  it('bugfix: a prize checkout shows a zero total, not the delivery fee', () => {
    render(
      <CheckoutBottomAction
        {...commonProps}
        displayTotal={3500}
        prizeCheckout
        selectedPayment="paystack"
        total={3500}
      />
    );

    expect(screen.getByText('₦0')).toBeTruthy();
    expect(screen.queryByText('₦3,500')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Claim prize, nothing to pay' })
    ).toBeTruthy();
    expect(screen.getByText('Claim Prize')).toBeTruthy();
  });
});
