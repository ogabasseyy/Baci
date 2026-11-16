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

  it('bugfix: goes back to unknown when wallet pay is switched off (Muse)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ walletPayableTierKeys: ['basic'] }),
    } as Response);
    const { result, rerender } = renderHook(
      ({ canPay }: { canPay: boolean }) =>
        useImeiWalletPayableTiers({ ...props, canPay }),
      { initialProps: { canPay: true } }
    );
    await waitFor(() => expect(result.current).toEqual(['basic']));
    rerender({ canPay: false });
    expect(result.current).toBeNull();
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
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('bugfix: offers nothing while a read is in flight, even after a device switch (Muse)', async () => {
    let resolve: (value: Response) => void = () => undefined;
    jest.spyOn(global, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        })
    );
    const { result, rerender } = renderHook(
      ({ device }: { device: 'smartphone' | 'laptop' }) =>
        useImeiWalletPayableTiers({ ...props, device, canPay: true }),
      { initialProps: { device: 'smartphone' } }
    );
    expect(result.current).toBe('loading');
    resolve({
      ok: true,
      json: async () => ({ walletPayableTierKeys: ['basic'] }),
    } as Response);
    await waitFor(() => expect(result.current).toEqual(['basic']));
    rerender({ device: 'laptop' });
    expect(result.current).toBe('loading');
  });
});
