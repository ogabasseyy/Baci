import { renderHook } from '@testing-library/react-native';
import { useImeiWalletPay } from './use-imei-wallet-pay';
import { useImeiWalletPayableTiers } from './use-imei-wallet-payable-tiers';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async () => 'sha256',
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('./use-imei-wallet-payable-tiers', () => ({
  useImeiWalletPayableTiers: jest.fn(() => null),
}));
jest.mock('@/stores/auth-store', () => {
  const state = { user: { id: 'user-1' }, merchantId: 'merchant-1' };
  const useAuthStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});
jest.mock('@/lib/wallet-pay/imei-wallet-pay-api', () => ({
  imeiWalletPayApi: { start: jest.fn(), verifyPin: jest.fn(), pay: jest.fn() },
}));

const payable = useImeiWalletPayableTiers as jest.Mock;

function setup(canPay = true) {
  return renderHook(() =>
    useImeiWalletPay({
      apiBaseUrl: 'https://api.test',
      device: 'smartphone',
      walletQuery: {
        data: { wallet: { balance: 0, primary_balance_kobo: 1_000_000 } },
        refetch: jest.fn(),
      },
      onDelivered: jest.fn(),
      canPay,
    })
  );
}

describe('bugfix: the app ignored the server list of wallet-payable checks (walk M1)', () => {
  afterEach(() => payable.mockReturnValue(null));

  it('stops offering a check the server can not bill to the wallet', () => {
    payable.mockReturnValue(['full']);
    expect(setup().result.current.covers('basic')).toBe(false);
  });

  it('offers nothing while the list is still loading', () => {
    payable.mockReturnValue('loading');
    expect(setup().result.current.covers('basic')).toBe(false);
  });

  it('bugfix: Verify waits while the list loads instead of choosing a top-up (Codex P2)', () => {
    payable.mockReturnValue('loading');
    expect(setup().result.current.waitsForWallet).toBe(true);
    payable.mockReturnValue(['basic']);
    expect(setup().result.current.waitsForWallet).toBe(false);
    payable.mockReturnValue('loading');
    expect(setup(false).result.current.waitsForWallet).toBe(false);
  });

  it('asks for the list with the screen device and switch', () => {
    setup(false);
    expect(payable).toHaveBeenLastCalledWith({
      apiBaseUrl: 'https://api.test',
      canPay: false,
      device: 'smartphone',
    });
  });
});
