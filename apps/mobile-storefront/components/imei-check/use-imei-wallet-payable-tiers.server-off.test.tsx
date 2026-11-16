import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  PAYABLE_TIERS_TIMEOUT_MS,
  useImeiWalletPayableTiers,
} from './use-imei-wallet-payable-tiers';

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

  it('bugfix: a server that never answers falls back to the app rule (Codex P2)', () => {
    jest.useFakeTimers();
    try {
      jest
        .spyOn(global, 'fetch')
        .mockImplementation(() => new Promise<Response>(() => undefined));
      const { result } = renderHook(() =>
        useImeiWalletPayableTiers({ ...props, canPay: true })
      );
      expect(result.current).toBe('loading');
      act(() => jest.advanceTimersByTime(PAYABLE_TIERS_TIMEOUT_MS));
      expect(result.current).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('bugfix: the first render after a device switch is loading, never the old list (CodeRabbit)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ walletPayableTierKeys: ['basic'] }),
    } as Response);
    const seen: unknown[] = [];
    const { result, rerender } = renderHook(
      ({ device }: { device: 'smartphone' | 'laptop' }) => {
        const tiers = useImeiWalletPayableTiers({
          ...props,
          device,
          canPay: true,
        });
        seen.push(tiers);
        return tiers;
      },
      { initialProps: { device: 'smartphone' } }
    );
    await waitFor(() => expect(result.current).toEqual(['basic']));
    seen.length = 0;
    rerender({ device: 'laptop' });
    expect(seen[0]).toBe('loading');
  });

  it('bugfix: switching away and back is loading until the new read settles (CodeRabbit)', async () => {
    let calls = 0;
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      calls += 1;
      // Only the first read answers; later ones stay in flight.
      return calls === 1
        ? Promise.resolve({
            ok: true,
            json: async () => ({ walletPayableTierKeys: ['basic'] }),
          } as Response)
        : new Promise<Response>(() => undefined);
    });
    const { result, rerender } = renderHook(
      ({ device }: { device: 'smartphone' | 'laptop' }) =>
        useImeiWalletPayableTiers({ ...props, device, canPay: true }),
      { initialProps: { device: 'smartphone' } }
    );
    await waitFor(() => expect(result.current).toEqual(['basic']));
    rerender({ device: 'laptop' });
    rerender({ device: 'smartphone' });
    expect(result.current).toBe('loading');
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
