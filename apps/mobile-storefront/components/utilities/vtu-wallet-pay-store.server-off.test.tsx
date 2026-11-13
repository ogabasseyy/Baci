import {
  clearVtuWalletPay,
  openVtuWalletPay,
  payFromPiggyvestIfCovered,
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
  useVtuWalletPayStore.setState({ covers: () => false, pending: null });
});

describe('VTU PiggyVest hand-over with the server keeping PiggyVest off', () => {
  it('covers nothing until a host says so, so forms keep store credit', () => {
    expect(useVtuWalletPayStore.getState().covers(500)).toBe(false);
    expect(openVtuWalletPay(request, jest.fn())).toBe(false);
    expect(payFromPiggyvestIfCovered(request, jest.fn(), '08031234567')).toBe(
      false
    );
    expect(useVtuWalletPayStore.getState().pending).toBeNull();
  });
});

describe('VTU PiggyVest hand-over (switched on)', () => {
  it('opens one sheet at a time and reports success like the store credit path', () => {
    useVtuWalletPayStore.setState({ covers: () => true });
    const onSuccess = jest.fn();
    expect(payFromPiggyvestIfCovered(request, onSuccess, '08031234567')).toBe(
      true
    );
    expect(openVtuWalletPay(request, jest.fn())).toBe(false);
    useVtuWalletPayStore
      .getState()
      .pending?.onDelivered({ reference: 'REF', voucherPin: 'PIN' });
    expect(onSuccess).toHaveBeenCalledWith({
      amount: 500,
      customerIdentifier: '08031234567',
      reference: 'REF',
      status: 'successful',
      voucherPin: 'PIN',
    });
    clearVtuWalletPay();
    expect(useVtuWalletPayStore.getState().pending).toBeNull();
  });
});
