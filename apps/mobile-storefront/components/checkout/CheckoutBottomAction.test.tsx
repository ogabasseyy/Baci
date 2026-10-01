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
});
