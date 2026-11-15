import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletSavingsContributionFlow } from './WalletSavingsContributionFlow';

function createProps() {
  return {
    addAmount: '',
    colors: Colors.dark,
    isAdding: false,
    isFundPending: false,
    onAddAmountChange: jest.fn(),
    onAddSavings: jest.fn(),
    onFundWallet: jest.fn(),
    remainingAmount: 1000,
    walletBalance: 0,
  };
}

describe('WalletSavingsContributionFlow: amount limits and pending states', () => {
  it('waits for an amount and rejects one above the remaining goal', () => {
    const props = { ...createProps(), walletBalance: 1000 };
    const { rerender } = render(<WalletSavingsContributionFlow {...props} />);

    expect(
      screen.getByRole('button', { name: 'Confirm savings top-up' })
    ).toHaveAccessibilityState({ disabled: true });
    fireEvent.changeText(
      screen.getByLabelText('Savings top-up amount'),
      '1200'
    );
    expect(props.onAddAmountChange).toHaveBeenCalledWith('1200');

    rerender(<WalletSavingsContributionFlow {...props} addAmount="1200" />);
    expect(screen.getByText(/only needs ₦1,000 more/i)).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Confirm savings top-up' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: 'Continue to payment',
      })
    ).toBeNull();
  });

  it('disables funding and amount edits while a savings transfer is pending', () => {
    const props = {
      ...createProps(),
      addAmount: '500',
      isAdding: true,
      walletBalance: 100,
    };
    render(<WalletSavingsContributionFlow {...props} />);

    const fund = screen.getByRole('button', {
      name: 'Continue to payment',
    });
    expect(fund).toHaveAccessibilityState({ disabled: true });
    expect(screen.getByLabelText('Savings top-up amount').props.editable).toBe(
      false
    );
    fireEvent.press(fund);
    expect(props.onFundWallet).not.toHaveBeenCalled();
  });

  it('disables repeated payment starts while wallet funding is pending', () => {
    const props = { ...createProps(), addAmount: '500', isFundPending: true };
    render(<WalletSavingsContributionFlow {...props} />);

    const fund = screen.getByRole('button', {
      name: 'Continue to payment',
    });
    expect(fund).toHaveAccessibilityState({ disabled: true, busy: true });
    fireEvent.press(fund);
    expect(props.onFundWallet).not.toHaveBeenCalled();
  });
});
