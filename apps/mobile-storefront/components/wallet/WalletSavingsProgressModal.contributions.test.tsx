import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';
import { setWalletTestCustomer } from './wallet-auth.test-support';
import { createWalletContentProps } from './wallet-content.test-utils';

jest.mock('expo-image', () => ({ Image: () => null }));
let restoreCustomer: () => void;
beforeEach(() => {
  restoreCustomer = setWalletTestCustomer();
});
afterEach(() => restoreCustomer());
const goal = {
  ...createWalletContentProps().activeSavingsGoal,
  product_variant_label: 'Color: Black · Storage: 256GB',
};

describe('savings contribution actions', () => {
  it('renders progress and wires manual contribution actions', () => {
    const onAddAmountChange = jest.fn();
    const onAddSavings = jest.fn();
    const onChangeDevice = jest.fn();
    const onClose = jest.fn();
    const onFundWallet = jest.fn();

    render(
      <WalletSavingsProgressModal
        addAmount="500"
        colors={Colors.light}
        goal={goal}
        isAdding={false}
        onAddAmountChange={onAddAmountChange}
        onAddSavings={onAddSavings}
        onChangeDevice={onChangeDevice}
        onClose={onClose}
        onFundWallet={onFundWallet}
        visible
        walletBalance={125000}
      />
    );

    expect(screen.getAllByText('Add to savings').length).toBeGreaterThan(0);
    expect(screen.getByText('50%')).toBeOnTheScreen();
    expect(screen.getByText('₦50,000 left')).toBeOnTheScreen();
    expect(screen.getByLabelText('Device condition: Used')).toBeOnTheScreen();
    expect(screen.getByText('256GB')).toBeOnTheScreen();
    expect(
      screen.getByRole('image', { name: 'Device colour: Black' })
    ).toBeOnTheScreen();

    fireEvent.changeText(screen.getByLabelText('Savings top-up amount'), '500');
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm savings top-up' })
    );
    expect(
      screen.queryByRole('button', {
        name: 'Continue to wallet payment for savings',
      })
    ).toBeNull();
    fireEvent.press(
      screen.getByRole('button', { name: 'Change savings device' })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Close savings progress' })
    );
    expect(onClose).not.toHaveBeenCalled();
    fireEvent(screen.getByTestId('gorhom-bottom-sheet'), 'close');

    expect(onAddAmountChange).toHaveBeenCalledWith('500');
    expect(onAddSavings).toHaveBeenCalledTimes(1);
    expect(onFundWallet).not.toHaveBeenCalled();
    expect(onChangeDevice).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables the confirm action while a contribution is pending', () => {
    render(
      <WalletSavingsProgressModal
        addAmount="500"
        colors={Colors.light}
        goal={goal}
        isAdding
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={jest.fn()}
        onClose={jest.fn()}
        onFundWallet={jest.fn()}
        visible
        walletBalance={125000}
      />
    );

    // The progress cover is announced; the busy button under it is hidden
    // from screen readers but still disabled.
    expect(screen.getByText('Adding ₦500 to your plan…')).toBeOnTheScreen();
    expect(
      screen.getByText('Adding...', { includeHiddenElements: true })
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Confirm savings top-up', {
        includeHiddenElements: true,
      })
    ).toHaveAccessibilityState({ disabled: true, busy: true });
  });
});
