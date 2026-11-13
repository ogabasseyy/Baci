import { Alert } from 'react-native';
import {
  releaseUtilityCheckout,
  tryAcquireUtilityCheckout,
} from '@/lib/utility-checkout-inflight';
import {
  clearVtuWalletPay,
  openVtuWalletPay,
  useVtuWalletPayStore,
} from './vtu-wallet-pay-store';

const request = {
  amount: 500,
  phoneNumber: '08031234567',
  networkProvider: 'mtn',
  type: 'airtime' as const,
  walletAmount: 500,
};

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  releaseUtilityCheckout();
  useVtuWalletPayStore.setState({ covers: () => true, pending: null });
});
afterEach(() => jest.restoreAllMocks());

describe('bugfix: PiggyVest purchases skipped the screen-wide checkout guard (Codex P2)', () => {
  it('holds the checkout slot while the sheet is open, then frees it', () => {
    expect(openVtuWalletPay(request, jest.fn())).toBe(true);
    // A sibling tab's store credit checkout is refused meanwhile.
    expect(tryAcquireUtilityCheckout()).toBe(false);
    clearVtuWalletPay();
    expect(tryAcquireUtilityCheckout()).toBe(true);
  });

  it('refuses (handled, with the alert) while another checkout runs', () => {
    expect(tryAcquireUtilityCheckout()).toBe(true);
    expect(openVtuWalletPay(request, jest.fn())).toBe(true);
    expect(useVtuWalletPayStore.getState().pending).toBeNull();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Checkout in progress',
      expect.any(String)
    );
  });

  it('never opens (or holds the slot) for an amount the wallet does not cover', () => {
    useVtuWalletPayStore.setState({ covers: () => false });
    expect(openVtuWalletPay(request, jest.fn())).toBe(false);
    expect(tryAcquireUtilityCheckout()).toBe(true);
  });
});
