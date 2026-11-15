import { fireEvent, render, screen } from '@testing-library/react-native';
import { CheckoutStepPill } from './CheckoutStepPill';

const colors = {
  background: '#f9fafb',
  border: '#e5e7eb',
  card: '#ffffff',
  text: '#111827',
  textSecondary: '#6b7280',
} as Parameters<typeof CheckoutStepPill>[0]['colors'];

const baseProps = {
  colors,
  isDark: false,
  label: 'Address',
  number: 1,
  stepKey: 'address',
};

describe('CheckoutStepPill', () => {
  it('makes a completed step a button that navigates back', () => {
    const onPress = jest.fn();
    render(
      <CheckoutStepPill {...baseProps} onPress={onPress} status="completed" />
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Go to Address step, completed' })
    );

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('announces the current step as current, not as a button', () => {
    render(<CheckoutStepPill {...baseProps} status="current" />);

    expect(screen.getByLabelText('Address step, current')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('announces an upcoming step as not yet available, with a dashed outline', () => {
    render(<CheckoutStepPill {...baseProps} status="upcoming" />);

    const pill = screen.getByLabelText('Address step, not yet available');
    expect(pill).toHaveStyle({ borderStyle: 'dashed' });
    expect(pill).toHaveAccessibilityState({ disabled: true });
    expect(pill.props.accessibilityRole).toBe('text');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a completed step without a handler as a disabled button', () => {
    render(<CheckoutStepPill {...baseProps} status="completed" />);

    const pill = screen.getByRole('button', {
      name: 'Address step, completed',
    });
    expect(pill).toBeDisabled();
    expect(screen.queryByLabelText(/not yet available/)).toBeNull();
  });

  it('keeps the same testID when a step becomes completed', () => {
    const { rerender } = render(
      <CheckoutStepPill {...baseProps} status="current" />
    );
    expect(screen.getByTestId('checkout-step-pill-address')).toBeTruthy();

    rerender(
      <CheckoutStepPill {...baseProps} onPress={jest.fn()} status="completed" />
    );
    expect(screen.getByTestId('checkout-step-pill-address')).toBeTruthy();
  });

  it('keys each testID on the step, not its position', () => {
    render(
      <>
        <CheckoutStepPill
          {...baseProps}
          label="Payment"
          number={2}
          status="upcoming"
          stepKey="payment"
        />
        <CheckoutStepPill
          {...baseProps}
          label="Review"
          number={2}
          status="upcoming"
          stepKey="review"
        />
      </>
    );

    expect(screen.getByTestId('checkout-step-pill-payment')).toBeTruthy();
    expect(screen.getByTestId('checkout-step-pill-review')).toBeTruthy();
  });
});
