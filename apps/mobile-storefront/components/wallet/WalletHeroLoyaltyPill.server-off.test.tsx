import { render, screen } from '@testing-library/react-native';
import { WalletHeroLoyaltyPill } from './WalletHeroLoyaltyPill';

describe('WalletHeroLoyaltyPill (server off)', () => {
  it('renders points without any network dependency', () => {
    render(
      <WalletHeroLoyaltyPill
        loyaltyPoints={0}
        visibleTier={null}
        onOpenRedeemPanel={jest.fn()}
      />
    );
    expect(screen.getByText('0 pts')).toBeOnTheScreen();
  });
});
