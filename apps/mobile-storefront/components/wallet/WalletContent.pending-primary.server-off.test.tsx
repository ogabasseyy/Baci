import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { WalletContent } from './WalletContent';
import { createWalletContentProps } from './wallet-content.test-utils';

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    __esModule: true,
    default: { View },
    FadeIn: { duration: () => ({ delay: () => ({}) }) },
  };
});
jest.mock('@/hooks/use-debounce', () => ({ useDebounce: (v: string) => v }));
jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({ isLoading: false, products: [] }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/hooks/use-legacy-funding-unconfirmed', () => ({
  useLegacyFundingUnconfirmed: () => false,
}));

const account = {
  accountName: 'Ada Obi',
  accountNumber: '3685660013',
  bankName: 'Provider Bank',
};

describe('bugfix: pending PiggyVest history labelled as the full history', () => {
  it('labels the list store credit activity while the PiggyVest balance is pending', () => {
    // Arrange: PiggyVest account, balance not ready (primaryReady false).
    render(
      <WalletContent
        {...createWalletContentProps()}
        fundingAccount={{ ...account, provider: 'piggyvest' }}
        primaryReady={false}
        transactions={[]}
      />
    );

    // Assert
    expect(screen.getByText('Store credit activity')).toBeOnTheScreen();
    expect(screen.queryByText('Recent Transactions')).toBeNull();
  });
});

describe('server keeps PiggyVest off', () => {
  it('keeps Recent Transactions for a legacy account', () => {
    render(
      <WalletContent
        {...createWalletContentProps()}
        fundingAccount={{ ...account, provider: 'paystack' }}
        primaryReady={false}
        transactions={[]}
      />
    );

    expect(screen.getByText('Recent Transactions')).toBeOnTheScreen();
  });
});

describe('bugfix: pending PiggyVest balance shown as an authoritative ₦0', () => {
  it('shows "—" for the savings wallet while its balance is pending', () => {
    // Arrange: confirmed PiggyVest, balance pending, no account yet.
    render(
      <WalletContent
        {...createWalletContentProps()}
        fundingAccount={null}
        primaryReady={false}
        savingsPrimary
        storeCreditBalance={1200}
        transactions={[]}
        walletBalance={0}
      />
    );

    // Assert: a savings wallet, balance unknown, older money as store credit.
    expect(screen.getByText('Savings wallet · NGN')).toBeOnTheScreen();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText('Store credit')).toBeOnTheScreen();
    expect(screen.getByText('Store credit activity')).toBeOnTheScreen();
  });
});
