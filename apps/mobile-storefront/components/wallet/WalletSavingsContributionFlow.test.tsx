import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
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

describe('WalletSavingsContributionFlow', () => {
  it('shows naira and groups digits while preserving the raw contribution amount', () => {
    const props = {
      ...createProps(),
      addAmount: '1250000',
      remainingAmount: 2000000,
    };
    const { rerender } = render(<WalletSavingsContributionFlow {...props} />);

    expect(screen.getByText('₦')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('1,250,000')).toBeOnTheScreen();
    fireEvent.changeText(
      screen.getByLabelText('Savings top-up amount'),
      '₦ 25,000'
    );
    expect(props.onAddAmountChange).toHaveBeenCalledWith('25000');

    rerender(<WalletSavingsContributionFlow {...props} addAmount="25000" />);
    expect(screen.getByDisplayValue('25,000')).toBeOnTheScreen();
    fireEvent.changeText(screen.getByLabelText('Savings top-up amount'), '');
    expect(props.onAddAmountChange).toHaveBeenLastCalledWith('');
  });

  it('does not open another funding screen before an amount is entered for a ₦0 wallet', () => {
    const props = createProps();
    render(<WalletSavingsContributionFlow {...props} />);

    expect(screen.getByText('Available in wallet: ₦0')).toBeOnTheScreen();
    expect(
      screen.getByText(/Fund your wallet to add this amount to savings/i)
    ).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Confirm savings top-up' })
    ).toBeNull();
    const fund = screen.getByRole('button', {
      name: 'Continue to payment',
    });
    expect(StyleSheet.flatten(fund.props.style)).toEqual(
      expect.objectContaining({ backgroundColor: Colors.dark.primary })
    );
    expect(fund).toHaveAccessibilityState({ disabled: true });
    fireEvent.press(fund);
    expect(props.onFundWallet).not.toHaveBeenCalled();
    expect(props.onAddSavings).not.toHaveBeenCalled();
  });

  it('keeps an entered production savings amount on the payment flow', () => {
    const props = { ...createProps(), addAmount: '500' };
    render(<WalletSavingsContributionFlow {...props} />);

    expect(
      screen.getByText(/Fund your wallet to add this amount to savings/i)
    ).toBeOnTheScreen();
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Continue to payment',
      })
    );
    expect(props.onFundWallet).toHaveBeenCalledTimes(1);
  });

  it('keeps hosted staging card top-up disabled without test payment capability', () => {
    const previous = {
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
      hosted: process.env.EXPO_PUBLIC_HOSTED_STOREFRONT,
      payments: process.env.EXPO_PUBLIC_STAGING_TEST_PAYMENTS,
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    };
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
    try {
      const props = { ...createProps(), addAmount: '500' };
      render(<WalletSavingsContributionFlow {...props} />);

      expect(
        screen.getByText(
          /Wallet top-ups are disabled in this hosted staging preview/i
        )
      ).toBeOnTheScreen();
      const payment = screen.getByRole('button', {
        name: 'Continue to payment',
      });
      expect(payment).toHaveAccessibilityState({ disabled: true });
      fireEvent.press(payment);
      expect(props.onFundWallet).not.toHaveBeenCalled();
    } finally {
      if (previous.apiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
      else process.env.EXPO_PUBLIC_API_URL = previous.apiUrl;
      if (previous.hosted === undefined)
        delete process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
      else process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = previous.hosted;
      if (previous.payments === undefined)
        delete process.env.EXPO_PUBLIC_STAGING_TEST_PAYMENTS;
      else process.env.EXPO_PUBLIC_STAGING_TEST_PAYMENTS = previous.payments;
      if (previous.supabaseUrl === undefined)
        delete process.env.EXPO_PUBLIC_SUPABASE_URL;
      else process.env.EXPO_PUBLIC_SUPABASE_URL = previous.supabaseUrl;
    }
  });

  it('does not route pinned staging test payments through the wallet card shortcut', () => {
    const previous = {
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
      hosted: process.env.EXPO_PUBLIC_HOSTED_STOREFRONT,
      payments: process.env.EXPO_PUBLIC_STAGING_TEST_PAYMENTS,
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    };
    try {
      process.env.EXPO_PUBLIC_API_URL = 'https://staging.ogabassey.com';
      process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
      process.env.EXPO_PUBLIC_STAGING_TEST_PAYMENTS = '1';
      process.env.EXPO_PUBLIC_SUPABASE_URL =
        'https://staging-auth.ogabassey.com';
      const props = { ...createProps(), addAmount: '500' };
      render(<WalletSavingsContributionFlow {...props} />);

      expect(
        screen.getByText(/do not send a real bank transfer/i)
      ).toBeOnTheScreen();
      const payment = screen.getByRole('button', {
        name: 'Open savings bank transfer details',
      });
      expect(payment).toHaveAccessibilityState({ disabled: false });
      expect(payment).toHaveTextContent('View bank transfer details');
      fireEvent.press(payment);
      expect(props.onFundWallet).toHaveBeenCalledTimes(1);
    } finally {
      if (previous.apiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
      else process.env.EXPO_PUBLIC_API_URL = previous.apiUrl;
      if (previous.hosted === undefined)
        delete process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
      else process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = previous.hosted;
      if (previous.payments === undefined)
        delete process.env.EXPO_PUBLIC_STAGING_TEST_PAYMENTS;
      else process.env.EXPO_PUBLIC_STAGING_TEST_PAYMENTS = previous.payments;
      if (previous.supabaseUrl === undefined)
        delete process.env.EXPO_PUBLIC_SUPABASE_URL;
      else process.env.EXPO_PUBLIC_SUPABASE_URL = previous.supabaseUrl;
    }
  });

  it('offers plan bank transfer when the wallet has only part of the amount', () => {
    const props = { ...createProps(), addAmount: '500', walletBalance: 100 };
    render(<WalletSavingsContributionFlow {...props} />);

    expect(
      screen.getByText(/Fund your wallet to add this amount to savings/i)
    ).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Confirm savings top-up' })
    ).toBeNull();
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Continue to payment',
      })
    );
    expect(props.onFundWallet).toHaveBeenCalledTimes(1);
  });

  it('still allows an existing funded staging wallet to contribute to savings', () => {
    const previousMode = process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
    try {
      const props = { ...createProps(), addAmount: '500', walletBalance: 500 };
      render(<WalletSavingsContributionFlow {...props} />);

      const contribute = screen.getByRole('button', {
        name: 'Confirm savings top-up',
      });
      expect(contribute).toHaveAccessibilityState({ disabled: false });
      fireEvent.press(contribute);
      expect(props.onAddSavings).toHaveBeenCalledTimes(1);
      expect(props.onFundWallet).not.toHaveBeenCalled();
      expect(screen.queryByText('View bank transfer details')).toBeNull();
    } finally {
      if (previousMode === undefined)
        delete process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
      else process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = previousMode;
    }
  });

  it('offers only the savings transfer when the wallet covers the entered amount', () => {
    const props = { ...createProps(), addAmount: '500', walletBalance: 500 };
    render(<WalletSavingsContributionFlow {...props} />);

    expect(screen.getByText(/Move ₦500 from your wallet/i)).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', {
        name: 'Continue to payment',
      })
    ).toBeNull();
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm savings top-up' })
    );
    expect(props.onAddSavings).toHaveBeenCalledTimes(1);
    expect(props.onFundWallet).not.toHaveBeenCalled();
  });

  it('switches from wallet funding to savings transfer when the wallet credit arrives', () => {
    const props = { ...createProps(), addAmount: '500', walletBalance: 100 };
    const { rerender } = render(<WalletSavingsContributionFlow {...props} />);

    expect(
      screen.getByRole('button', {
        name: 'Continue to payment',
      })
    ).toBeOnTheScreen();
    rerender(<WalletSavingsContributionFlow {...props} walletBalance={500} />);

    expect(screen.getByLabelText('Savings top-up amount').props.value).toBe(
      '500'
    );
    expect(
      screen.getByRole('button', { name: 'Confirm savings top-up' })
    ).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', {
        name: 'Continue to payment',
      })
    ).toBeNull();
  });

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
