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

import { WalletPrimaryContext } from './WalletPrimaryContext';

describe('WalletSavingsContributionFlow with PiggyVest', () => {
  describe('PiggyVest main wallet ready', () => {
    function renderPrimary(overrides: Record<string, unknown> = {}) {
      const props = { ...createProps(), addAmount: '500', ...overrides };
      render(
        <WalletPrimaryContext.Provider value>
          <WalletSavingsContributionFlow {...props} />
        </WalletPrimaryContext.Provider>
      );
      return props;
    }

    it('offers Add money, never a card payment, when the balance is too low', () => {
      const props = renderPrimary({ walletBalance: 100 });

      expect(
        screen.getByText('₦100 available in savings wallet')
      ).toBeOnTheScreen();
      expect(
        screen.getByText(
          'Add money to your savings wallet to save this amount.'
        )
      ).toBeOnTheScreen();
      expect(screen.queryByText(/Continue to payment/)).toBeNull();
      expect(screen.queryByText(/Opening payment/)).toBeNull();
      fireEvent.press(
        screen.getByRole('button', { name: 'Add money to wallet' })
      );
      expect(screen.getByText('Add money')).toBeOnTheScreen();
      expect(props.onFundWallet).toHaveBeenCalledTimes(1);
    });

    it('also offers Add money for an empty wallet', () => {
      renderPrimary({ walletBalance: 0 });

      expect(
        screen.getByRole('button', { name: 'Add money to wallet' })
      ).toBeOnTheScreen();
    });

    it('keeps the contribution button when the balance covers the amount', () => {
      renderPrimary({ walletBalance: 1000 });

      expect(
        screen.queryByRole('button', { name: 'Add money to wallet' })
      ).toBeNull();
      expect(screen.queryByText(/Continue to payment/)).toBeNull();
    });
  });

  it('renders the legacy payment button when no PiggyVest verdict is provided', () => {
    render(
      <WalletSavingsContributionFlow
        {...createProps()}
        addAmount="500"
        walletBalance={100}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toBeOnTheScreen();
    expect(screen.queryByText('Add money')).toBeNull();
  });
});
