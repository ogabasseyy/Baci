import { fireEvent, render, screen } from '@testing-library/react-native';
import { WalletHeroLoyaltyPill } from './WalletHeroLoyaltyPill';

describe('WalletHeroLoyaltyPill', () => {
  it('opens redemption from the pill when points exist', () => {
    const onOpenRedeemPanel = jest.fn();
    render(
      <WalletHeroLoyaltyPill
        loyaltyPoints={2500}
        visibleTier="Silver"
        onOpenRedeemPanel={onOpenRedeemPanel}
      />
    );

    expect(screen.getByText('2,500 pts')).toBeOnTheScreen();
    expect(screen.getByText('Redeem')).toBeOnTheScreen();
    fireEvent.press(
      screen.getByRole('button', { name: 'Redeem loyalty points' })
    );
    expect(onOpenRedeemPanel).toHaveBeenCalledTimes(1);
  });

  it('is a read-only label with the tier when there are no points', () => {
    render(
      <WalletHeroLoyaltyPill
        loyaltyPoints={0}
        visibleTier="Gold"
        onOpenRedeemPanel={jest.fn()}
      />
    );

    expect(screen.getByText('0 pts')).toBeOnTheScreen();
    expect(screen.getByText('Gold')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByLabelText('Loyalty 0 pts, Gold')).toBeOnTheScreen();
  });

  it('omits the tier when none is shown', () => {
    render(
      <WalletHeroLoyaltyPill
        loyaltyPoints={0}
        visibleTier={null}
        onOpenRedeemPanel={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Loyalty 0 pts')).toBeOnTheScreen();
  });

  it('never shows negative or invalid points', () => {
    const { rerender } = render(
      <WalletHeroLoyaltyPill
        loyaltyPoints={-5}
        visibleTier={null}
        onOpenRedeemPanel={jest.fn()}
      />
    );
    expect(screen.getByText('0 pts')).toBeOnTheScreen();
    rerender(
      <WalletHeroLoyaltyPill
        loyaltyPoints={Number.NaN}
        visibleTier={null}
        onOpenRedeemPanel={jest.fn()}
      />
    );
    expect(screen.getByText('0 pts')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
