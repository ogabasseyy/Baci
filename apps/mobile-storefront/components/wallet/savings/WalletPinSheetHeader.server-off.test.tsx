import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletPinSheetHeader } from './WalletPinSheetHeader';

// Pure UI: no server call, so it is the same whether PiggyVest is on or off.
describe('WalletPinSheetHeader', () => {
  it('shows the title and closes with its own label', () => {
    const onClose = jest.fn();
    render(
      <WalletPinSheetHeader
        colors={Colors.light}
        title="Confirm it's you"
        closeLabel="Cancel"
        onClose={onClose}
      />
    );
    expect(
      screen.getByRole('header', { name: "Confirm it's you" })
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('announces the back arrow as Back inside the savings sheet', () => {
    render(
      <WalletPinSheetHeader
        colors={Colors.light}
        title="Wallet PIN"
        embedded
        onClose={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });

  it('has no close button when there is nothing to close', () => {
    render(<WalletPinSheetHeader colors={Colors.light} title="Wallet PIN" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
