import { act, renderHook } from '@testing-library/react-native';
import { type OxygenProofPicker, useOxygenProof } from './use-oxygen-proof';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
describe('transient Oxygen proof', () => {
  const asset = {
    uri: 'file:///private-proof.pdf',
    name: 'proof.pdf',
    mimeType: 'application/pdf',
    size: 10,
  };
  function picker(): OxygenProofPicker {
    return {
      pick: jest.fn().mockResolvedValue({ canceled: false, assets: [asset] }),
      size: () => 10,
      readBytes: async () => new Uint8Array([37, 80, 68, 70, 45]),
    };
  }
  it('cancel preserves a selected proof and booking rerenders retain it', async () => {
    const source = picker();
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) => useOxygenProof(scope, source),
      { initialProps: { scope: 'user/merchant/workflow/address-revision' } }
    );
    await act(() => result.current.pick());
    expect(result.current.proof?.name).toBe(asset.name);
    jest.mocked(source.pick).mockResolvedValue({ canceled: true });
    await act(() => result.current.pick());
    rerender({ scope: 'user/merchant/workflow/address-revision' });
    expect(result.current.proof?.name).toBe(asset.name);
  });
  it('releases a cached document after reading it or rejecting it', async () => {
    const release = jest.fn();
    const source = picker();
    jest.mocked(source.pick).mockResolvedValue({
      canceled: false,
      assets: [{ ...asset, release }],
    });
    const { result } = renderHook(() => useOxygenProof('one', source));
    await act(() => result.current.pick());
    expect(result.current.proof?.name).toBe(asset.name);
    expect(release).toHaveBeenCalledTimes(1);
    jest.mocked(source.pick).mockResolvedValue({
      canceled: false,
      assets: [{ ...asset, mimeType: 'text/plain', release }],
    });
    await act(() => result.current.pick());
    expect(release).toHaveBeenCalledTimes(2);
  });
  it('rejects actual oversized bytes despite a small declared picker size', async () => {
    const source = { ...picker(), size: () => 1572865 };
    const { result } = renderHook(() => useOxygenProof('one', source));
    await act(() => result.current.pick());
    expect(result.current.proof).toBeNull();
    expect(result.current.error).toMatch(/1.5/);
  });
  it('invalidates on address revision and does not restore proof on process restart', async () => {
    const source = picker();
    const { result, rerender, unmount } = renderHook(
      ({ scope }: { scope: string }) => useOxygenProof(scope, source),
      { initialProps: { scope: 'one' } }
    );
    await act(() => result.current.pick());
    rerender({ scope: 'two' });
    expect(result.current.proof).toBeNull();
    unmount();
    const restarted = renderHook(() => useOxygenProof('one', source));
    expect(restarted.result.current.proof).toBeNull();
  });
  it('ignores a picker result arriving after scope change', async () => {
    let finish: (
      value: Awaited<ReturnType<OxygenProofPicker['pick']>>
    ) => void = () => {};
    const source = {
      ...picker(),
      pick: () =>
        new Promise<Awaited<ReturnType<OxygenProofPicker['pick']>>>(
          (resolve) => {
            finish = resolve;
          }
        ),
    };
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) => useOxygenProof(scope, source),
      { initialProps: { scope: 'one' } }
    );
    let pending: Promise<void>;
    act(() => {
      pending = result.current.pick();
    });
    rerender({ scope: 'two' });
    const release = jest.fn();
    await act(async () => {
      finish({ canceled: false, assets: [{ ...asset, release }] });
      await pending;
    });
    expect(result.current.proof).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
