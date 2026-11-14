import { render, screen } from '@testing-library/react-native';
import { WalletHeroStoreCredit } from './WalletHeroStoreCredit';

describe('store credit line', () => {
  it('renders nothing with the server off (no PiggyVest, no balance passed)', () => {
    render(<WalletHeroStoreCredit balance={undefined} />);
    expect(screen.queryByText('Store credit')).toBeNull();
  });

  it('hides at zero', () => {
    render(<WalletHeroStoreCredit balance={0} />);
    expect(screen.queryByText('Store credit')).toBeNull();
  });

  it('shows the older balance as store credit above zero', () => {
    render(<WalletHeroStoreCredit balance={2500} />);
    expect(screen.getByText('Store credit')).toBeOnTheScreen();
    expect(screen.getByText('₦2,500')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Store credit ₦2,500. Use it on purchases.')
    ).toBeOnTheScreen();
  });
});
