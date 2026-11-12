import { render, screen } from '@testing-library/react-native';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { UtilityPaymentOptions } from './UtilityPaymentOptions';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'intent-1' }));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

const RETURN_TO = '/utilities/data?repeatAmount=1000' as WalletReturnHref;

describe('utility payment row', () => {
  it('keeps "Pay with wallet" when the server keeps PiggyVest off', () => {
    render(
      <UtilityPaymentOptions
        amount={500}
        returnToHref={RETURN_TO}
        walletBalance={2000}
        walletIsSettled
      />
    );

    expect(screen.getByText('Pay with wallet')).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        'Pay with wallet. ₦2,000 available. Covers this purchase'
      )
    ).toBeOnTheScreen();
  });

  it('pays a PiggyVest customer from store credit, showing ₦0 when empty', () => {
    render(
      <UtilityPaymentOptions
        amount={500}
        returnToHref={RETURN_TO}
        walletBalance={0}
        walletIsSettled
        walletIsStoreCredit
      />
    );

    expect(screen.getByText('Pay with store credit')).toBeOnTheScreen();
    expect(
      screen.getByText('₦0 available · ₦500 more needed')
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Add store credit' })
    ).toBeOnTheScreen();
  });

  it('names store credit when a PiggyVest balance fails to load', () => {
    render(
      <UtilityPaymentOptions
        amount={500}
        returnToHref={RETURN_TO}
        walletError={new Error('offline')}
        walletIsSettled
        walletIsStoreCredit
      />
    );

    expect(screen.getByText('Store credit unavailable')).toBeOnTheScreen();
    expect(screen.queryByText('Wallet unavailable')).toBeNull();
  });
});
