import { act, renderHook } from '@testing-library/react-native';
import { useWalletPinPrompt } from './use-wallet-pin-prompt';

const request = {
  merchantId: 'm',
  goalId: 'g',
  operationId: 'o',
  amountKobo: 100,
};

describe('useWalletPinPrompt', () => {
  it('opens the sheet for a request and resolves with the proof', async () => {
    const { result } = renderHook(() => useWalletPinPrompt());
    expect(result.current.sheetProps.request).toBeNull();
    let pending!: Promise<string | null>;
    act(() => {
      pending = result.current.requestProof(request);
    });
    expect(result.current.sheetProps.request).toEqual(request);
    act(() => result.current.sheetProps.onProof('proof-value'));
    await expect(pending).resolves.toBe('proof-value');
    expect(result.current.sheetProps.request).toBeNull();
  });

  it('resolves null when the sheet is cancelled', async () => {
    const { result } = renderHook(() => useWalletPinPrompt());
    let pending!: Promise<string | null>;
    act(() => {
      pending = result.current.requestProof(request);
    });
    act(() => result.current.sheetProps.onCancel());
    await expect(pending).resolves.toBeNull();
    expect(result.current.sheetProps.request).toBeNull();
  });

  it('resolves null when the screen goes away while waiting', async () => {
    const { result, unmount } = renderHook(() => useWalletPinPrompt());
    let pending!: Promise<string | null>;
    act(() => {
      pending = result.current.requestProof(request);
    });
    unmount();
    await expect(pending).resolves.toBeNull();
  });

  it('releases an older waiting request when a new one replaces it', async () => {
    const { result } = renderHook(() => useWalletPinPrompt());
    let first!: Promise<string | null>;
    act(() => {
      first = result.current.requestProof(request);
    });
    act(() => {
      void result.current.requestProof({ ...request, operationId: 'o2' });
    });
    await expect(first).resolves.toBeNull();
    expect(result.current.sheetProps.request?.operationId).toBe('o2');
  });
});
