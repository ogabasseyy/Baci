import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { ImeiWalletBadge } from './imei-wallet-badge';
import { getImeiWalletCopy } from './imei-wallet-copy';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

// With the server keeping PiggyVest off there is no savings balance to pay
// from, so the badge is the store credit badge shipped today.
describe('ImeiWalletBadge with the server keeping PiggyVest off', () => {
  it('shows the wallet balance as today', () => {
    render(
      <ImeiWalletBadge
        colors={Colors.light as never}
        isWalletReady
        needsTopUp={false}
        savingsKobo={null}
        statusText={null}
        walletBalance={1500}
        walletCopy={getImeiWalletCopy(false)}
      />
    );
    expect(screen.getByLabelText('Wallet balance ₦1,500')).toBeOnTheScreen();
    expect(screen.queryByText(/Savings/)).toBeNull();
  });
});
