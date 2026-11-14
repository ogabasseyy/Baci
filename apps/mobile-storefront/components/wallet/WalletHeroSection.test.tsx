import { fireEvent, render, screen } from '@testing-library/react-native';
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

const baseProps = {
  earningsAvailable: true,
  earningsBalance: 125000,
  loyaltyPoints: 2000,
  loyaltyTier: 'silver',
  onOpenFundPanel: jest.fn(),
  onOpenRedeemPanel: jest.fn(),
  savingsBalance: 35000,
  totalBalance: 160000,
};

describe('WalletHeroSection', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows all three balances without claiming a savings-plan balance as earnings', () => {
    render(<WalletHeroSection {...baseProps} />);

    expect(
      screen.getByRole('button', { name: 'Create account number' })
    ).toBeOnTheScreen();
    expect(screen.getByText('Total Balance · NGN')).toBeOnTheScreen();
    expect(screen.getByText('₦160,000')).toBeOnTheScreen();
    expect(screen.getByText('₦125,000')).toBeOnTheScreen();
    expect(screen.getByText('₦35,000')).toBeOnTheScreen();
    expect(screen.getByText('2,000 pts')).toBeOnTheScreen();
    // With points to spend the pill shows Redeem instead of the tier.
    expect(screen.getByText('Redeem')).toBeOnTheScreen();
    expect(screen.queryByText('Silver')).toBeNull();
  });

  it('shows the loyalty tier in the pill when there are no points to redeem', () => {
    render(<WalletHeroSection {...baseProps} loyaltyPoints={0} />);
    expect(screen.getByText('0 pts')).toBeOnTheScreen();
    expect(screen.getByText('Silver')).toBeOnTheScreen();
  });

  it('shows an earnings dash when the hosted earnings contract is unavailable', () => {
    render(
      <WalletHeroSection
        {...baseProps}
        earningsAvailable={false}
        earningsBalance={null}
      />
    );

    expect(screen.getByText('—')).toBeOnTheScreen();
    expect(screen.queryByText('₦125,000')).toBeNull();
  });

  it('does not invent a Bronze membership for a missing or historical Bronze tier', () => {
    const { rerender } = render(
      <WalletHeroSection
        {...baseProps}
        loyaltyPoints={0}
        loyaltyTier={undefined}
      />
    );
    expect(screen.getByText('0 pts')).toBeOnTheScreen();
    expect(screen.queryByText(/bronze/i)).toBeNull();

    rerender(
      <WalletHeroSection
        {...baseProps}
        loyaltyPoints={0}
        loyaltyTier="bronze"
      />
    );
    expect(screen.getByText('0 pts')).toBeOnTheScreen();
    expect(screen.queryByText(/bronze/i)).toBeNull();
  });

  it('has no Add Money button; loyalty points open redemption from the card header', () => {
    render(<WalletHeroSection {...baseProps} />);

    expect(screen.queryByRole('button', { name: 'Add money' })).toBeNull();
    fireEvent.press(
      screen.getByRole('button', { name: 'Redeem loyalty points' })
    );

    expect(baseProps.onOpenRedeemPanel).toHaveBeenCalledTimes(1);
    expect(baseProps.onOpenFundPanel).not.toHaveBeenCalled();
  });

  it('shows Start Savings inside the card only when a handler is given', () => {
    const onStartSavings = jest.fn();
    const { rerender } = render(<WalletHeroSection {...baseProps} />);
    expect(screen.queryByRole('button', { name: 'Start Savings' })).toBeNull();

    rerender(
      <WalletHeroSection {...baseProps} onStartSavings={onStartSavings} />
    );
    fireEvent.press(screen.getByRole('button', { name: 'Start Savings' }));
    expect(onStartSavings).toHaveBeenCalledTimes(1);
  });

  it('shows only Earnings and Savings boxes under the balance', () => {
    render(<WalletHeroSection {...baseProps} />);

    expect(screen.getByText('Earnings')).toBeOnTheScreen();
    expect(screen.getByText('Savings')).toBeOnTheScreen();
    expect(screen.queryByText('Loyalty')).toBeNull();
  });

  it('shows the real funding account beside the balance without inventing one', () => {
    render(
      <WalletHeroSection
        {...baseProps}
        fundingAccount={{
          accountName: 'OGABASSEY TEST',
          accountNumber: '1234567890',
          bankName: 'Test Bank',
          provider: 'paystack',
        }}
      />
    );

    expect(screen.getByText('₦160,000')).toBeOnTheScreen();
    expect(screen.getByText('1234567890')).toBeOnTheScreen();
    expect(screen.getByText('Test Bank')).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Create account number' })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Copy funding account number' })
    ).toBeOnTheScreen();
  });

  it('never shows the synthetic account in a release build', () => {
    const originalDev = __DEV__;
    Object.defineProperty(globalThis, '__DEV__', { value: false });
    try {
      render(<WalletHeroSection {...baseProps} />);
      expect(screen.queryByText('0000000000')).toBeNull();
    } finally {
      Object.defineProperty(globalThis, '__DEV__', { value: originalDev });
    }
  });

  it('swaps the account slot from create to the assigned number', () => {
    const onCreateFundingAccount = jest.fn();
    const { rerender } = render(
      <WalletHeroSection
        {...baseProps}
        canCreateFundingAccount
        onCreateFundingAccount={onCreateFundingAccount}
      />
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Create account number' })
    );
    expect(onCreateFundingAccount).toHaveBeenCalledTimes(1);

    rerender(
      <WalletHeroSection
        {...baseProps}
        fundingAccount={{
          accountName: 'OGABASSEY TEST',
          accountNumber: '1234567890',
          bankName: 'Test Bank',
          provider: 'paystack',
        }}
      />
    );
    expect(
      screen.queryByRole('button', { name: 'Create account number' })
    ).toBeNull();
    expect(screen.getByText('1234567890')).toBeOnTheScreen();
  });

  it('shows Redeem by the star only when points exist', () => {
    const { rerender } = render(
      <WalletHeroSection {...baseProps} loyaltyPoints={0} />
    );
    expect(
      screen.queryByRole('button', { name: 'Redeem loyalty points' })
    ).toBeNull();
    rerender(<WalletHeroSection {...baseProps} loyaltyPoints={2000} />);
    expect(
      screen.getByRole('button', { name: 'Redeem loyalty points' })
    ).toBeOnTheScreen();
  });
});
