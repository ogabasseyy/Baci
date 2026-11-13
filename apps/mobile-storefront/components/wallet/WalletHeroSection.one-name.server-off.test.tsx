import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
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
jest.mock('@/lib/clipboard', () => ({
  setClipboardString: () => Promise.resolve(true),
}));
jest.mock('@/hooks/use-haptics', () => ({ triggerHaptic: () => undefined }));

const account = {
  accountName: 'Ada Obi',
  accountNumber: '3685660013',
  bankName: 'FAAS (SANDBOX)',
  provider: 'piggyvest',
};

function renderHero(primaryReady: boolean, onOpenFundPanel = jest.fn()) {
  render(
    <WalletPrimaryContext.Provider value={primaryReady}>
      <WalletHeroSection
        earningsAvailable={false}
        earningsBalance={null}
        fundingAccount={account}
        loyaltyPoints={0}
        onOpenFundPanel={onOpenFundPanel}
        onOpenRedeemPanel={jest.fn()}
        savingsBalance={0}
        savingsWalletBalance={primaryReady ? 50_000 : undefined}
        storeCreditBalance={0}
        totalBalance={50_000}
      />
    </WalletPrimaryContext.Provider>
  );
  return onOpenFundPanel;
}

describe('bugfix: one ₦50,000 shown under three names on the wallet card', () => {
  it('calls the main balance the savings wallet and goal money "In goals"', () => {
    // Arrange + Act: ₦50,000 in the PiggyVest main wallet, ₦0 in goals.
    renderHero(true);

    // Assert: no "Total savings ₦50,000" next to "Savings ₦0".
    expect(screen.getByText('Savings wallet · NGN')).toBeOnTheScreen();
    expect(screen.getByText('₦50,000')).toBeOnTheScreen();
    expect(screen.getByText('In goals')).toBeOnTheScreen();
    expect(screen.queryByText('Total savings · NGN')).toBeNull();
    expect(screen.queryByText('Savings')).toBeNull();
  });
});

describe('bugfix: no Add money entry and no copy feedback on the wallet card', () => {
  it('opens the transfer instructions from a visible Add money button', () => {
    const onOpenFundPanel = renderHero(true);

    fireEvent.press(screen.getByRole('button', { name: 'Add money' }));

    expect(onOpenFundPanel).toHaveBeenCalledTimes(1);
  });

  it('says "Copied" after the account number is copied', async () => {
    renderHero(true);

    await act(async () => {
      fireEvent.press(
        screen.getByRole('button', { name: 'Copy funding account number' })
      );
    });

    expect(screen.getByText('Copied')).toBeOnTheScreen();
  });
});

describe('server keeps PiggyVest off', () => {
  it('keeps the card exactly as today: no Add money, the old copy message', async () => {
    renderHero(false);

    await act(async () => {
      fireEvent.press(
        screen.getByRole('button', { name: 'Copy funding account number' })
      );
    });

    expect(screen.getByText('Total Balance · NGN')).toBeOnTheScreen();
    expect(screen.getByText('Savings')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Add money' })).toBeNull();
    expect(
      screen.getByText('Account number copied to clipboard.')
    ).toBeOnTheScreen();
  });
});
