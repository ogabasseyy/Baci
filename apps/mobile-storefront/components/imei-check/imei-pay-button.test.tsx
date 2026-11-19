import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ImeiPayButton } from './imei-pay-button';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

describe('ImeiPayButton', () => {
  it('shows its label and runs onPress when enabled', () => {
    const onPress = jest.fn();
    render(
      <ImeiPayButton
        busy={false}
        disabled={false}
        icon="shield-checkmark-outline"
        label="Verify Now - ₦700"
        onPress={onPress}
      />
    );
    fireEvent.press(screen.getByRole('button'));
    expect(screen.getByText('Verify Now - ₦700')).toBeOnTheScreen();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('ignores taps while disabled', () => {
    const onPress = jest.fn();
    render(
      <ImeiPayButton
        busy={false}
        disabled
        icon="hand-left-outline"
        label="Choose a check"
        onPress={onPress}
      />
    );
    fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('swaps the label for a spinner while busy', () => {
    render(
      <ImeiPayButton
        busy
        disabled
        icon="shield-checkmark-outline"
        label="Verify Now - ₦700"
        onPress={jest.fn()}
      />
    );
    expect(screen.queryByText('Verify Now - ₦700')).toBeNull();
    expect(screen.getByRole('button')).toHaveAccessibilityState({
      busy: true,
    });
  });
});
