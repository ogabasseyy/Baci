import { fireEvent, render, screen } from '@testing-library/react-native';
import { BRAND, palette } from '@/constants/Colors';
import { UtilityPayButton } from './UtilityPayButton';

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
});
