import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavedPaymentMethodCard } from './start-savings-modal-parts';

const method = {
  id: 'card-1',
  label: 'Visa 4242',
  last4: '4242',
} as never;

describe('SavedPaymentMethodCard with PiggyVest off', () => {
  it('selects the card when pressed', () => {
    const onPress = jest.fn();
    render(
      <SavedPaymentMethodCard
        active={false}
        colors={Colors.light}
        method={method}
        onPress={onPress}
      />
    );
    fireEvent.press(screen.getByRole('button', { name: 'Select Visa 4242' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('ignores presses while disabled and says so', () => {
    const onPress = jest.fn();
    render(
      <SavedPaymentMethodCard
        active
        colors={Colors.light}
        disabled
        method={method}
        onPress={onPress}
      />
    );
    const button = screen.getByRole('button', { name: 'Select Visa 4242' });
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
  });
});
