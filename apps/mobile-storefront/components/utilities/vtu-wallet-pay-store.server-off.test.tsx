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
  useVtuWalletPayStore.setState({
    covers: () => false,
    retains: async () => false,
    pending: null,
  });
});

describe('VTU PiggyVest hand-over with the server keeping PiggyVest off', () => {
  it('covers nothing until a host says so, so forms keep store credit', async () => {
    expect(useVtuWalletPayStore.getState().covers(500)).toBe(false);
    expect(openVtuWalletPay(request, jest.fn())).toBe(false);
    expect(
      await payFromPiggyvest(request, jest.fn(), '08031234567', false)
    ).toBe(false);
    expect(useVtuWalletPayStore.getState().pending).toBeNull();
  });
});

describe('VTU PiggyVest hand-over (switched on)', () => {
  it('opens one sheet at a time and reports success like the store credit path', async () => {
    useVtuWalletPayStore.setState({ covers: () => true });
    const onSuccess = jest.fn();
    expect(
      await payFromPiggyvest(request, onSuccess, '08031234567', false)
    ).toBe(true);
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
  it('replays the retained store credit attempt instead', async () => {
    useVtuWalletPayStore.setState({ covers: () => true });
    expect(
      await payFromPiggyvest(request, jest.fn(), '08031234567', true)
    ).toBe(false);
    expect(useVtuWalletPayStore.getState().pending).toBeNull();
  });
});

describe('bugfix: a retained PiggyVest purchase fell back to store credit (Codex P1)', () => {
  it('replays a retained PiggyVest attempt even when store credit now covers it', async () => {
    useVtuWalletPayStore.setState({
      covers: () => false,
      retains: async () => true,
    });
    expect(
      await payFromPiggyvest(request, jest.fn(), '08031234567', false)
    ).toBe(true);
    expect(useVtuWalletPayStore.getState().pending?.request).toEqual(request);
    clearVtuWalletPay();
  });

  it('treats a key store it can not read as retained (fails closed)', async () => {
    useVtuWalletPayStore.setState({
      covers: () => false,
      retains: async () => {
        throw new Error('storage unreadable');
      },
    });
    expect(
      await payFromPiggyvest(request, jest.fn(), '08031234567', false)
    ).toBe(true);
    clearVtuWalletPay();
  });
});
