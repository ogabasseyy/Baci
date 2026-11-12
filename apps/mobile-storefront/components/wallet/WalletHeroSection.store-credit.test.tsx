import { render, screen } from '@testing-library/react-native';
import { WalletHeroSection } from './WalletHeroSection';
import { WalletPrimaryContext } from './WalletPrimaryContext';

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

const baseProps = {
  earningsAvailable: false,
  earningsBalance: null,
  loyaltyPoints: 0,
  onOpenFundPanel: jest.fn(),
  onOpenRedeemPanel: jest.fn(),
  savingsBalance: 0,
  totalBalance: 5000,
};

function renderHero(primaryReady: boolean, storeCreditBalance?: number) {
  render(
    <WalletPrimaryContext.Provider value={primaryReady}>
      <WalletHeroSection
        {...baseProps}
        storeCreditBalance={storeCreditBalance}
      />
    </WalletPrimaryContext.Provider>
  );
}

describe('bugfix: PiggyVest balance shown as a spendable total', () => {
  it('labels ₦5,000 PiggyVest money a savings wallet with no store credit line at ₦0', () => {
    renderHero(true, 0);

    expect(screen.getByText('Total savings · NGN')).toBeOnTheScreen();
    expect(screen.getByText('₦5,000')).toBeOnTheScreen();
    expect(screen.queryByText('Total Balance · NGN')).toBeNull();
    expect(screen.queryByText('Store credit')).toBeNull();
  });

  it('shows the store credit line when the older balance is above zero', () => {
    renderHero(true, 1200);

    expect(screen.getByText('Store credit')).toBeOnTheScreen();
    expect(screen.getByText('₦1,200')).toBeOnTheScreen();
  });
});

describe('merchants without PiggyVest', () => {
  it('render exactly as before: total balance, no store credit line', () => {
    renderHero(false, 1200);

    expect(screen.getByText('Total Balance · NGN')).toBeOnTheScreen();
    expect(screen.queryByText('Total savings · NGN')).toBeNull();
    expect(screen.queryByText('Store credit')).toBeNull();
  });
});

describe('wallet card utility shortcuts', () => {
  it('are hidden for a PiggyVest customer with ₦0 store credit (₦5,000 PiggyVest)', () => {
    renderHero(true, 0);

    expect(screen.queryByRole('button', { name: 'Buy Airtime' })).toBeNull();
    expect(screen.queryByText('Airtime')).toBeNull();
  });

  it('show for a PiggyVest customer with store credit above zero', () => {
    renderHero(true, 500);

    expect(
      screen.getByRole('button', { name: 'Buy Airtime' })
    ).toBeOnTheScreen();
  });

  it('always show for merchants without PiggyVest, even at ₦0', () => {
    renderHero(false, undefined);

    expect(
      screen.getByRole('button', { name: 'Buy Airtime' })
    ).toBeOnTheScreen();
  });
});
