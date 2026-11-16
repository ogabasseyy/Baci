import { renderHook, waitFor } from '@testing-library/react-native';
import { useImeiWalletPayableTiers } from './use-imei-wallet-payable-tiers';

const props = { apiBaseUrl: 'https://api.test', device: 'smartphone' as const };

describe('useImeiWalletPayableTiers', () => {
  afterEach(() => jest.restoreAllMocks());

  it('asks nothing and stays unknown while paying from the wallet is off', () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const { result } = renderHook(() =>
      useImeiWalletPayableTiers({ ...props, canPay: false })
    );
    expect(result.current).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads the server list while it is on', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ walletPayableTierKeys: ['basic'] }),
    } as Response);
    const { result } = renderHook(() =>
      useImeiWalletPayableTiers({ ...props, canPay: true })
    );
    await waitFor(() => expect(result.current).toEqual(['basic']));
  });

  it('stays unknown when the read fails', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() =>
      useImeiWalletPayableTiers({ ...props, canPay: true })
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
