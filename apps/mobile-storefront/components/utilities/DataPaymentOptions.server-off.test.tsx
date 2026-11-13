import { render, screen } from '@testing-library/react-native';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { DataPaymentOptions } from './DataPaymentOptions';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: jest.fn(() => 'light'),
}));

function payment(retained: boolean) {
  return {
    canFundByBankTransfer: false,
    getWalletBalance: () => 500,
    walletError: null,
    walletIsLoading: false,
    isWalletSettled: () => true,
    walletIsStoreCredit: false,
    walletPrimaryUnknown: false,
    hasRetainedVtuAttempt: jest.fn(() => retained),
  } as never;
}

// With the server keeping PiggyVest off the data payment section is the
// one shipped today; the retained check only ever hides a savings row.
describe('DataPaymentOptions with the server keeping PiggyVest off', () => {
  it('shows the wallet as before and asks about this exact bundle', () => {
    useVtuWalletPayStore.setState({
      covers: () => false,
      balanceKobo: null,
      pending: null,
    });
    const p = payment(false);
    render(
      <DataPaymentOptions
        payment={p}
        planAmount={300}
        selectedPlan="MTN-1GB"
        selectedProvider="mtn"
        phoneNumber="08031234567"
        returnToHref={'/utilities/data' as WalletReturnHref}
      />
    );
    expect(screen.getByText('Pay with wallet')).toBeTruthy();
    expect(
      (p as { hasRetainedVtuAttempt: jest.Mock }).hasRetainedVtuAttempt
    ).toHaveBeenCalledWith(
      expect.objectContaining({ dataPlanCode: 'MTN-1GB', type: 'data' })
    );
  });
});
