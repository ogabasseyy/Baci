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
