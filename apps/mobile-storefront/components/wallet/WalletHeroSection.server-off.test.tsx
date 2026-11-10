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
