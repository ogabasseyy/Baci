import { jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useSavingsNoticeStore } from './savings/savings-notice-store';
import { WalletFundModal } from './WalletFundModal';
import { createWalletContentProps } from './wallet-content.test-utils';

jest.mock('@/hooks/use-copy-to-clipboard', () => ({
  useCopyToClipboard: () => ({ copyToClipboard: jest.fn(), feedback: null }),
}));
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: () => false,
}));

// With the server keeping PiggyVest off there is no primary verdict: the
// modal is today's legacy funding sheet, card option included.
describe('WalletFundModal with the server off', () => {
  it('shows the legacy account and keeps the card option', () => {
    render(
      <WalletFundModal
        {...createWalletContentProps()}
        creditWatch={{
          armCheck: jest.fn(),
          creditedAmount: null,
          reset: jest.fn(),
          returnCtaHref: undefined,
          status: 'idle',
        }}
        fundingAccount={{
          accountName: 'OGB / JOHN DOE',
          accountNumber: '9814644749',
          bankName: 'Wema Bank',
          provider: 'paystack',
        }}
        showFundPanel
      />
    );
    expect(screen.getByText('9814644749')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Fund with card instead' })
    ).toBeOnTheScreen();
  });
});

describe('bugfix: Add money outcomes were iOS alerts', () => {
  it('shows an amount check inline in the open sheet, not as an alert', () => {
    const iosAlert = jest.spyOn(Alert, 'alert');
    render(
      <WalletFundModal
        {...createWalletContentProps()}
        creditWatch={{
          armCheck: jest.fn(),
          creditedAmount: null,
          reset: jest.fn(),
          returnCtaHref: undefined,
          status: 'idle',
        }}
        fundingAccount={null}
        showFundPanel
      />
    );
    act(() => {
      useSavingsNoticeStore.setState({
        // Signed out in this render: the notice scope is ':'.
        notice: {
          title: 'Check the amount',
          message: 'Enter at least ₦100.',
          tone: 'warning',
          scope: ':',
        },
      });
    });

    expect(screen.getByText('Check the amount')).toBeOnTheScreen();
    expect(screen.getByText('Enter at least ₦100.')).toBeOnTheScreen();
    expect(iosAlert).not.toHaveBeenCalled();
  });
});

describe('Add money title is scoped to the PiggyVest account', () => {
  const watch = {
    armCheck: jest.fn(),
    creditedAmount: null,
    reset: jest.fn(),
    returnCtaHref: undefined,
    status: 'idle' as const,
  };

  it('keeps "Add Money" for another store’s account', () => {
    render(
      <WalletFundModal
        {...createWalletContentProps()}
        creditWatch={watch}
        fundingAccount={{
          accountName: 'OGB / JOHN DOE',
          accountNumber: '9814644749',
          bankName: 'Wema Bank',
          provider: 'paystack',
        }}
        showFundPanel
      />
    );
    expect(screen.getByText('Add Money')).toBeOnTheScreen();
  });

  it('uses sentence case "Add money" for the PiggyVest account', () => {
    render(
      <WalletFundModal
        {...createWalletContentProps()}
        creditWatch={watch}
        fundingAccount={{
          accountName: 'Default Wallet',
          accountNumber: '9000002044',
          bankName: 'FAAS (SANDBOX)',
          provider: 'piggyvest',
        }}
        showFundPanel
      />
    );
    expect(screen.getByText('Add money')).toBeOnTheScreen();
  });
});
