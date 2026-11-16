import { render, screen } from '@testing-library/react-native';
import { UtilityPaymentOptions } from '@/components/utilities/UtilityPaymentOptions';
import Colors from '@/constants/Colors';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import {
  SAVINGS_WALLET_LABEL,
  UtilityPiggyvestPayRow,
} from './UtilityPiggyvestPayRow';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: jest.fn(() => 'light'),
}));

// With the server keeping PiggyVest off no host covers anything, so the
// savings wallet row never appears and the utility payment section is the
// one shipped today.
describe('UtilityPiggyvestPayRow with the server keeping PiggyVest off', () => {
  it('never shows the savings wallet row', () => {
    useVtuWalletPayStore.setState({
      covers: () => false,
      balanceKobo: null,
      pending: null,
    });
    render(
      <UtilityPaymentOptions
        amount={100}
        returnToHref={'/utilities/airtime' as WalletReturnHref}
        walletBalance={500}
        walletIsLoading={false}
        walletIsSettled
      />
    );
    expect(screen.queryByText('Savings wallet · NGN')).toBeNull();
    expect(screen.getByText('Pay with wallet')).toBeTruthy();
  });

  it('names the wallet as the wallet screen does when it is shown', () => {
    render(
      <UtilityPiggyvestPayRow balanceKobo={54_970_000} colors={Colors.light} />
    );
    expect(screen.getByText(SAVINGS_WALLET_LABEL)).toBeTruthy();
    expect(
      screen.getByText('₦549,700 available · covers this purchase')
    ).toBeTruthy();
  });
});
