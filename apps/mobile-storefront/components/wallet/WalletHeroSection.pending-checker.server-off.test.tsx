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
// The checker is switched on here so its visibility can be asserted.
jest.mock('@/constants/wallet-funding', () => ({
  ...(jest.requireActual('@/constants/wallet-funding') as object),
  WALLET_FUNDING_CHECKING_STATE_ENABLED: true,
}));

const CHECKER = "I've transferred — check for it";
const creditWatch = {
  armCheck: jest.fn(),
  creditedAmount: null,
  reset: jest.fn(),
  returnCtaHref: undefined,
  status: 'idle' as const,
};

function renderHero(provider: string) {
  render(
    <WalletPrimaryContext.Provider value={false}>
      <WalletHeroSection
        creditWatch={creditWatch}
        earningsAvailable={false}
        earningsBalance={null}
        fundingAccount={{
          accountName: 'Ada Obi',
          accountNumber: '3685660013',
          bankName: 'Provider Bank',
          provider,
        }}
        loyaltyPoints={0}
        onOpenFundPanel={jest.fn()}
        onOpenRedeemPanel={jest.fn()}
        savingsBalance={0}
        totalBalance={0}
      />
    </WalletPrimaryContext.Provider>
  );
}

describe('bugfix: store-credit checker shown for a pending PiggyVest account', () => {
  it('hides the checker when the account is PiggyVest but the balance is pending', () => {
    // Arrange + Act: PiggyVest account number, balance not ready yet.
    renderHero('piggyvest');

    // Assert: transfers there never reach the store-credit ledger.
    expect(screen.queryByText(CHECKER)).toBeNull();
  });
});

describe('server keeps PiggyVest off', () => {
  it('keeps the checker for a legacy funding account', () => {
    renderHero('paystack');

    expect(screen.getByText(CHECKER)).toBeOnTheScreen();
  });
});
