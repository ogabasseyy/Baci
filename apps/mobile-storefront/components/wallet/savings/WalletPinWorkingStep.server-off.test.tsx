import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletPinWorkingStep } from './WalletPinWorkingStep';

// Pure presentation: it never calls a server, so PiggyVest on or off is the same.
describe('WalletPinWorkingStep', () => {
  it('shows what is happening with a spinner and no number pad', () => {
    render(
      <WalletPinWorkingStep
        colors={Colors.light}
        title="Wallet PIN"
        message="Saving your PIN and approving ₦100…"
      />
    );
    expect(
      screen.getByText('Saving your PIN and approving ₦100…')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('wallet-pin-working')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('offers Close only when given one', () => {
    const onClose = jest.fn();
    render(
      <WalletPinWorkingStep
        colors={Colors.light}
        title="Wallet PIN"
        message="Checking your PIN..."
        onClose={onClose}
      />
    );
    fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
