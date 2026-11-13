import {
  clearVtuWalletPay,
  openVtuWalletPay,
  payFromPiggyvest,
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
    expect(payFromPiggyvest(request, jest.fn(), '08031234567', false)).toBe(
      false
    );
    expect(useVtuWalletPayStore.getState().pending).toBeNull();
  });
});

describe('VTU PiggyVest hand-over (switched on)', () => {
  it('opens one sheet at a time and reports success like the store credit path', () => {
    useVtuWalletPayStore.setState({ covers: () => true });
    const onSuccess = jest.fn();
    expect(payFromPiggyvest(request, onSuccess, '08031234567', false)).toBe(
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

describe('bugfix: a retained store credit attempt was forked to PiggyVest (Muse)', () => {
  it('replays the retained store credit attempt instead', () => {
    useVtuWalletPayStore.setState({ covers: () => true });
    expect(payFromPiggyvest(request, jest.fn(), '08031234567', true)).toBe(
      false
    );
    expect(useVtuWalletPayStore.getState().pending).toBeNull();
  });
});
