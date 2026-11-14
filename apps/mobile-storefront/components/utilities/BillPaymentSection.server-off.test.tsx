import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { BillPaymentSection } from './BillPaymentSection';

jest.mock('./UtilityPaymentOptions', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    UtilityPaymentOptions: ({
      walletIsStoreCredit,
    }: {
      walletIsStoreCredit?: boolean;
    }) =>
      React.createElement(
        Text,
        null,
        walletIsStoreCredit ? 'Store credit options' : 'Wallet options'
      ),
  };
});

type PaymentState = ReturnType<typeof useUtilityPayment>;

function createPaymentState(): PaymentState {
  return {
    canFundByBankTransfer: false,
    isAuthenticated: true,
    refetchWallet: jest.fn(() => Promise.resolve(undefined)),
    getWalletBalance: () => 0,
    walletError: null,
    walletIsLoading: false,
    isWalletRefetching: () => false,
    isWalletSettled: () => true,
    getWalletError: () => null,
    getWalletIdempotencyKey: jest.fn(async () => 'test-key'),
    scopePendingVtuDescriptor: (d: string) => d,
    captureSubmittingOwner: () => 'test-owner',
    captureSubmittingUserId: () => 'test-user',
    invalidateWallets: jest.fn(),
    isSubmittingOwnerCurrent: () => true,
    resetWalletIdempotencyKey: jest.fn(),
    hasRetainedVtuAttempt: jest.fn(() => false),
  };
}

function renderSection(payment: PaymentState) {
  render(
    <BillPaymentSection
      colors={Colors.light}
      formattedAmount="1,000"
      handlePaymentLayout={jest.fn()}
      returnToHref={'/utilities/power?repeatAmount=1000' as WalletReturnHref}
      isFixedAmount={false}
      numericAmount={1000}
      payment={payment}
      setAmount={jest.fn()}
    />
  );
}

describe('bill payment section', () => {
  it('keeps wallet payment when the server keeps PiggyVest off', () => {
    renderSection(createPaymentState());

    expect(screen.getByText('Wallet options')).toBeOnTheScreen();
  });

  it('passes store credit through for a PiggyVest customer', () => {
    renderSection({ ...createPaymentState(), walletIsStoreCredit: true });

    expect(screen.getByText('Store credit options')).toBeOnTheScreen();
  });
});
