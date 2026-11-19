import { describe, expect, it, jest } from '@jest/globals';
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
// IMEI wallet pay switched on; utilities still can't spend the savings wallet.
jest.mock('@/lib/savings-wallet-can-pay', () => ({
  SAVINGS_WALLET_CAN_PAY: true,
}));

function renderHero(
  storeCreditBalance: number | undefined,
  savingsWalletBalance: number
) {
  render(
    <WalletPrimaryContext.Provider value={true}>
      <WalletHeroSection
        earningsAvailable={false}
        earningsBalance={null}
        loyaltyPoints={0}
        onOpenFundPanel={jest.fn()}
        onOpenRedeemPanel={jest.fn()}
        savingsBalance={0}
        savingsWalletBalance={savingsWalletBalance}
        storeCreditBalance={storeCreditBalance}
        totalBalance={savingsWalletBalance}
      />
    </WalletPrimaryContext.Provider>
  );
}

describe('bugfix: utility shortcuts shown once IMEI can pay from savings', () => {
  it('hides the shortcuts for ₦5,000 savings and ₦0 store credit', () => {
    renderHero(0, 5000);

    expect(screen.queryByRole('button', { name: 'Buy Airtime' })).toBeNull();
  });

  it('still shows them when there is store credit to pay with', () => {
    renderHero(500, 5000);

    expect(
      screen.getByRole('button', { name: 'Buy Airtime' })
    ).toBeOnTheScreen();
  });
});

describe('bugfix: utility shortcuts hidden while store credit is unread', () => {
  it('keeps the shortcuts until the store credit balance has loaded', () => {
    renderHero(undefined, 5000);

    expect(
      screen.getByRole('button', { name: 'Buy Airtime' })
    ).toBeOnTheScreen();
  });
});
