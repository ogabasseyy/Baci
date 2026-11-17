import { fireEvent, render, screen } from '@testing-library/react-native';
import { BRAND, palette } from '@/constants/Colors';
import { UtilityPayButton } from './UtilityPayButton';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

function renderButton(amount: number, isBusy = false) {
  const onPress = jest.fn();
  render(
    <UtilityPayButton
      amount={amount}
      buttonStyle={{ height: 50 }}
      isBusy={isBusy}
      label={`Pay ₦${amount}`}
      onPress={onPress}
      textStyle={{ color: BRAND.onPrimary }}
    />
  );
  return { button: screen.getByRole('button'), onPress };
}

describe('UtilityPayButton', () => {
  // The walk found "Pay ₦0" in full brand red on an empty form.
  it.each([
    0,
    Number.NaN,
  ])('is disabled and grey with no payable amount (%p)', (amount) => {
    const { button, onPress } = renderButton(amount);

    expect(button).toBeDisabled();
    expect(button).toHaveStyle({ backgroundColor: palette.gray[300] });
    expect(button.props.accessibilityHint).toBe('Enter an amount to pay');
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('is enabled in brand red once there is an amount', () => {
    const { button, onPress } = renderButton(100);

    expect(button).toBeEnabled();
    expect(button).toHaveStyle({ backgroundColor: BRAND.primary });
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is disabled while a purchase is submitting', () => {
    const { button } = renderButton(100, true);

    expect(button).toBeDisabled();
  });

  // The walk found "Pay ₦100" red and enabled with ₦0 store credit.
  it('is disabled and muted with the reason when something blocks the purchase', () => {
    const onPress = jest.fn();
    render(
      <UtilityPayButton
        amount={100}
        blockedReason="Not enough store credit to pay this."
        buttonStyle={{ height: 50 }}
        isBusy={false}
        label="Pay ₦100"
        onPress={onPress}
        textStyle={{ color: BRAND.onPrimary }}
      />
    );
    const button = screen.getByRole('button', { name: 'Pay ₦100' });

    expect(button).toBeDisabled();
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    expect(button).toHaveStyle({ backgroundColor: palette.gray[300] });
    expect(button.props.accessibilityHint).toBe(
      'Not enough store credit to pay this.'
    );
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows its notice and link above the button', () => {
    const onTopUp = jest.fn();
    render(
      <UtilityPayButton
        amount={100}
        blockedReason="Not enough store credit to pay this."
        buttonStyle={{ height: 50 }}
        isBusy={false}
        label="Pay ₦100"
        notice={{
          action: { label: 'Add store credit', onPress: onTopUp },
          message: 'Not enough store credit to pay this.',
        }}
        onPress={jest.fn()}
        textStyle={{ color: BRAND.onPrimary }}
      />
    );

    expect(
      screen.getByText('Not enough store credit to pay this.')
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Add store credit' }));
    expect(onTopUp).toHaveBeenCalledTimes(1);
  });
});
