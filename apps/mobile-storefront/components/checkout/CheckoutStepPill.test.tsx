import { fireEvent, render, screen } from '@testing-library/react-native';
import { CheckoutStepPill } from './CheckoutStepPill';

const colors = {
  background: '#f9fafb',
  border: '#e5e7eb',
  card: '#ffffff',
  text: '#111827',
  textSecondary: '#6b7280',
} as Parameters<typeof CheckoutStepPill>[0]['colors'];

const baseProps = { colors, isDark: false, label: 'Address', number: 1 };

describe('CheckoutStepPill', () => {
  it('makes a completed step a button that navigates back', () => {
    const onPress = jest.fn();
    render(
      <CheckoutStepPill {...baseProps} onPress={onPress} status="completed" />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Go to Address step' }));

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
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('still announces a completed step as completed when it has no handler', () => {
    render(<CheckoutStepPill {...baseProps} status="completed" />);

    expect(screen.getByLabelText('Address step, completed')).toBeTruthy();
    expect(screen.queryByLabelText(/not yet available/)).toBeNull();
  });

  it('gives each step its own testID', () => {
    render(
      <>
        <CheckoutStepPill
          {...baseProps}
          label="Payment"
          number={2}
          status="upcoming"
        />
        <CheckoutStepPill
          {...baseProps}
          label="Review"
          number={3}
          status="upcoming"
        />
      </>
    );

    expect(screen.getByTestId('checkout-step-pill-2')).toBeTruthy();
    expect(screen.getByTestId('checkout-step-pill-3')).toBeTruthy();
  });
});
