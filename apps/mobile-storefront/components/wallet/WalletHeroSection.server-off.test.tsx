import { render, screen } from '@testing-library/react-native';
import { SERVER_OFF_ACCOUNT_NUMBER } from '@/test-support/piggyvest-server-off.test-support';
import { WalletHeroSection } from './WalletHeroSection';

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

// The hero takes no savings goal: with no funding account it offers the
// regular account creation and never a plan account number.
describe('server keeps PiggyVest off', () => {
  it('offers account creation and shows no plan account', () => {
    render(
      <WalletHeroSection
        earningsAvailable
        earningsBalance={1000}
        loyaltyPoints={0}
        loyaltyTier={undefined}
        onOpenFundPanel={jest.fn()}
        onOpenRedeemPanel={jest.fn()}
        savingsBalance={0}
        totalBalance={1000}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Create account number' })
    ).toBeOnTheScreen();
    expect(screen.queryByText(SERVER_OFF_ACCOUNT_NUMBER)).toBeNull();
  });
});

describe('bugfix: server unreachable showed the goals total as the balance (walk 10)', () => {
  function renderUnknown() {
    render(
      <WalletHeroSection
        canCreateFundingAccount
        earningsAvailable={false}
        earningsBalance={null}
        loyaltyPoints={0}
        onOpenFundPanel={jest.fn()}
        onOpenRedeemPanel={jest.fn()}
        primaryUnknown
        savingsBalance={800_000}
        savingsWalletBalance={0}
        totalBalance={800_000}
      />
    );
  }

  it('shows no balance and says it cannot check, never the goals total', () => {
    renderUnknown();

    expect(screen.getByText('Savings wallet · NGN')).toBeOnTheScreen();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Can’t check your savings balance right now.')
    ).toBeOnTheScreen();
    expect(screen.queryByText('Total Balance · NGN')).toBeNull();
    // The goals total stays a goals figure, never the headline balance.
    expect(screen.getByText('In goals')).toBeOnTheScreen();
  });

  it('never offers to create an account while the account state is unknown', () => {
    renderUnknown();

    expect(
      screen.queryByRole('button', { name: 'Create account number' })
    ).toBeNull();
    expect(
      screen.getByText('Can’t check your account right now.')
    ).toBeOnTheScreen();
  });
});

describe('bugfix: known PiggyVest customer looked new with the server unreachable (walk 11)', () => {
  it('keeps the last-known account and Add money, with no balance figure', () => {
    render(
      <WalletHeroSection
        canCreateFundingAccount
        earningsAvailable={false}
        earningsBalance={null}
        fundingAccount={{
          accountName: 'OGB / ADA',
          accountNumber: '9814644749',
          bankName: 'Provider Bank',
          provider: 'piggyvest',
        }}
        loyaltyPoints={0}
        onOpenFundPanel={jest.fn()}
        onOpenRedeemPanel={jest.fn()}
        primaryUnknown
        savingsBalance={800_000}
        savingsWalletBalance={0}
        totalBalance={800_000}
      />
    );

    expect(screen.getByText('9814644749')).toBeOnTheScreen();
    // Walk 12: shown, not "Checking your account…", and marked as last known.
    expect(screen.queryByText('Checking your account…')).toBeNull();
    expect(
      screen.getByText('Last known account. It may be out of date.')
    ).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Create account number' })
    ).toBeNull();
    expect(screen.getByRole('button', { name: /Add money/ })).toBeOnTheScreen();
    expect(screen.queryByText('Total Balance · NGN')).toBeNull();
  });
});

const mockAccountUnconfirmed = jest.fn(() => false);
jest.mock('./use-piggyvest-account-unconfirmed', () => ({
  usePiggyvestAccountUnconfirmed: () => mockAccountUnconfirmed(),
}));

describe('bugfix: cold launch with the server down stuck on "Checking your account…" (walk 14)', () => {
  const piggyvestAccount = {
    accountName: 'OGB / ADA',
    accountNumber: '9814644749',
    bankName: 'Provider Bank',
    provider: 'piggyvest',
  };
  function renderSaved(extra: { primaryStale?: boolean } = {}) {
    render(
      <WalletHeroSection
        earningsAvailable={false}
        earningsBalance={null}
        fundingAccount={piggyvestAccount}
        loyaltyPoints={0}
        onOpenFundPanel={jest.fn()}
        onOpenRedeemPanel={jest.fn()}
        savingsBalance={0}
        savingsWalletBalance={5000}
        totalBalance={5000}
        {...extra}
      />
    );
  }

  it('shows the last-known account while the PiggyVest status is unknown', () => {
    mockAccountUnconfirmed.mockReturnValue(true);
    renderSaved();

    expect(screen.queryByText('Checking your account…')).toBeNull();
    expect(screen.getByText('9814644749')).toBeOnTheScreen();
    expect(
      screen.getByText('Last known account. It may be out of date.')
    ).toBeOnTheScreen();
  });

  it('marks the account as last known while the balance is a recalled one', () => {
    mockAccountUnconfirmed.mockReturnValue(false);
    renderSaved({ primaryStale: true });

    expect(screen.getByText('9814644749')).toBeOnTheScreen();
    expect(
      screen.getByText('Last known account. It may be out of date.')
    ).toBeOnTheScreen();
  });
});
