import { builderDesignCapabilities } from '@baci/shared/contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { getRandomBytesAsync } from 'expo-crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNativePreviewBridge } from './use-native-preview-bridge';

vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: vi.fn(async () => new Uint8Array(16).fill(10)),
}));
const nonce = '0a'.repeat(16);
const ready = JSON.stringify({
  type: 'baci.builder-preview.native-ready',
  version: 2,
  sessionNonce: nonce,
  capabilityHash: builderDesignCapabilities.capabilityHash,
  capabilityVersion: builderDesignCapabilities.capabilityVersion,
});
const rendered = (revision: number) =>
  JSON.stringify({
    type: 'baci.builder-preview.native-rendered',
    version: 2,
    sessionNonce: nonce,
    revision,
  });
const input = {
  identityKey: 'user-1:merchant-1',
  draftRevision: 1,
  config: { content: [], root: { props: { title: 'Home' } } },
  merchant: { id: 'merchant-1', slug: 'acme' },
  isIdentityCurrent: () => true,
};

describe('native preview bridge lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());
  it('handshakes before injecting the draft and fences stale acknowledgements', async () => {
    const injectJavaScript = vi.fn();
    const { result } = renderHook(() => useNativePreviewBridge(input));
    await waitFor(() => expect(result.current.nonce).toBe(nonce));
    act(() => {
      result.current.webViewRef.current = { injectJavaScript };
      result.current.onLoad(result.current.instanceId, nonce);
    });
    await waitFor(() =>
      expect(injectJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('native-init')
      )
    );
    expect(injectJavaScript).not.toHaveBeenCalledWith(
      expect.stringContaining('native-render')
    );
    act(() =>
      result.current.onMessage(result.current.instanceId, 'b'.repeat(32), ready)
    );
    expect(injectJavaScript).not.toHaveBeenCalledWith(
      expect.stringContaining('native-render')
    );
    act(() =>
      result.current.onMessage(result.current.instanceId, nonce, ready)
    );
    await waitFor(() =>
      expect(injectJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('native-render')
      )
    );
    act(() =>
      result.current.onMessage(result.current.instanceId, nonce, rendered(0))
    );
    expect(result.current.hasRendered).toBe(false);
    act(() =>
      result.current.onMessage(result.current.instanceId, nonce, rendered(1))
    );
    expect(result.current.hasRendered).toBe(true);
  });
  it('does not inject if the signed-in identity is no longer current', async () => {
    const injectJavaScript = vi.fn();
    let current = true;
    const { result } = renderHook(() =>
      useNativePreviewBridge({ ...input, isIdentityCurrent: () => current })
    );
    await waitFor(() => expect(result.current.nonce).toBe(nonce));
    current = false;
    act(() => {
      result.current.webViewRef.current = { injectJavaScript };
      result.current.onLoad(result.current.instanceId, nonce);
    });
    expect(injectJavaScript).not.toHaveBeenCalled();
  });
});

it('rejects callbacks from a previous WebView even if a nonce repeats', async () => {
  const injectJavaScript = vi.fn();
  const { result } = renderHook(() => useNativePreviewBridge(input));
  await waitFor(() => expect(result.current.nonce).toBe(nonce));
  const oldInstance = result.current.instanceId;
  act(() => {
    result.current.webViewRef.current = { injectJavaScript };
    result.current.onLoadError(oldInstance, nonce);
  });
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.instanceId).not.toBe(oldInstance));
  act(() => result.current.onMessage(oldInstance, nonce, ready));
  expect(injectJavaScript).not.toHaveBeenCalledWith(
    expect.stringContaining('native-render')
  );
});

it('rotates the instance after a second load and rejects callbacks from the old document', async () => {
  const injectJavaScript = vi.fn();
  const { result } = renderHook(() => useNativePreviewBridge(input));
  await waitFor(() => expect(result.current.nonce).toBe(nonce));
  const oldInstance = result.current.instanceId;
  act(() => {
    result.current.webViewRef.current = { injectJavaScript };
    result.current.onLoad(oldInstance, nonce);
  });
  act(() => result.current.onLoad(oldInstance, nonce));
  await waitFor(() => expect(result.current.instanceId).not.toBe(oldInstance));
  act(() => result.current.onMessage(oldInstance, nonce, ready));
  expect(injectJavaScript).not.toHaveBeenCalledWith(
    expect.stringContaining('native-render')
  );
});

it('times out a handshake and ignores a late ready response', async () => {
  vi.useFakeTimers();
  const injectJavaScript = vi.fn();
  const { result, unmount } = renderHook(() => useNativePreviewBridge(input));
  await act(async () => {
    await Promise.resolve();
  });
  const instance = result.current.instanceId;
  act(() => {
    result.current.webViewRef.current = { injectJavaScript };
    result.current.onLoad(instance, nonce);
  });
  act(() => vi.advanceTimersByTime(10_000));
  expect(result.current.error).toBe('handshake');
  act(() => result.current.onMessage(instance, nonce, ready));
  expect(injectJavaScript).not.toHaveBeenCalledWith(
    expect.stringContaining('native-render')
  );
  unmount();
  vi.useRealTimers();
});

it('preserves the last successful preview through a render timeout and ignores its late acknowledgement', async () => {
  vi.useFakeTimers();
  const injectJavaScript = vi.fn();
  const { result, rerender, unmount } = renderHook(
    ({ draftRevision }: { draftRevision: number }) =>
      useNativePreviewBridge({ ...input, draftRevision }),
    { initialProps: { draftRevision: 1 } }
  );
  await act(async () => {
    await Promise.resolve();
  });
  const instance = result.current.instanceId;
  act(() => {
    result.current.webViewRef.current = { injectJavaScript };
    result.current.onLoad(instance, nonce);
  });
  act(() => result.current.onMessage(instance, nonce, ready));
  act(() => result.current.onMessage(instance, nonce, rendered(1)));
  expect(result.current.hasRendered).toBe(true);
  rerender({ draftRevision: 2 });
  act(() => vi.advanceTimersByTime(10_000));
  expect(result.current.error).toBe('render');
  expect(result.current.hasRendered).toBe(true);
  act(() => result.current.onMessage(instance, nonce, rendered(2)));
  expect(result.current.error).toBe('render');
  unmount();
  vi.useRealTimers();
});

it('invalidates an active instance as soon as a new navigation starts', async () => {
  const injectJavaScript = vi.fn();
  const { result } = renderHook(() => useNativePreviewBridge(input));
  await waitFor(() => expect(result.current.nonce).toBe(nonce));
  const old = result.current.instanceId;
  act(() => {
    result.current.webViewRef.current = { injectJavaScript };
    result.current.onLoad(old, nonce);
  });
  act(() => result.current.onLoadStart(old, nonce));
  act(() => result.current.onMessage(old, nonce, ready));
  expect(injectJavaScript).not.toHaveBeenCalledWith(
    expect.stringContaining('native-render')
  );
  await waitFor(() => expect(result.current.instanceId).not.toBe(old));
});

it('rotates the session on render retry while retaining the last preview', async () => {
  const injectJavaScript = vi.fn();
  const { result, rerender } = renderHook(
    ({ draftRevision }: { draftRevision: number }) =>
      useNativePreviewBridge({ ...input, draftRevision }),
    { initialProps: { draftRevision: 1 } }
  );
  await waitFor(() => expect(result.current.nonce).toBe(nonce));
  const oldInstance = result.current.instanceId;
  act(() => {
    result.current.webViewRef.current = { injectJavaScript };
    result.current.onLoad(oldInstance, nonce);
  });
  act(() => result.current.onMessage(oldInstance, nonce, ready));
  act(() => result.current.onMessage(oldInstance, nonce, rendered(1)));
  expect(result.current.hasRendered).toBe(true);
  rerender({ draftRevision: 2 });
  act(() =>
    result.current.onMessage(
      oldInstance,
      nonce,
      JSON.stringify({
        type: 'baci.builder-preview.native-error',
        version: 2,
        sessionNonce: nonce,
        revision: 2,
        code: 'render_failed',
      })
    )
  );
  expect(result.current.error).toBe('render');
  vi.mocked(getRandomBytesAsync).mockResolvedValueOnce(
    new Uint8Array(16).fill(11)
  );
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.nonce).toBe('0b'.repeat(16)));
  expect(result.current.instanceId).toBe(oldInstance);
  expect(result.current.hasRendered).toBe(true);
  act(() => result.current.onMessage(oldInstance, nonce, rendered(2)));
  expect(result.current.hasRendered).toBe(true);
});

it('invalidates an in-flight retry when navigation starts', async () => {
  const { result } = renderHook(() => useNativePreviewBridge(input));
  await waitFor(() => expect(result.current.nonce).toBe(nonce));
  const old = result.current.instanceId;
  act(() => {
    result.current.webViewRef.current = { injectJavaScript: vi.fn() };
    result.current.onLoad(old, nonce);
  });
  act(() => result.current.onMessage(old, nonce, ready));
  act(() =>
    result.current.onMessage(
      old,
      nonce,
      JSON.stringify({
        type: 'baci.builder-preview.native-error',
        version: 2,
        sessionNonce: nonce,
        revision: 1,
        code: 'render_failed',
      })
    )
  );
  let resolveBytes: ((bytes: Uint8Array) => void) | undefined;
  vi.mocked(getRandomBytesAsync).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveBytes = resolve;
      })
  );
  act(() => result.current.retry());
  act(() => result.current.onLoadStart(old, nonce));
  await act(async () => {
    resolveBytes?.(new Uint8Array(16).fill(11));
  });
  await waitFor(() => expect(result.current.instanceId).not.toBe(old));
});

it('surfaces an error if identity changes while creating a session', async () => {
  let resolveBytes: ((bytes: Uint8Array) => void) | undefined;
  vi.mocked(getRandomBytesAsync).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveBytes = resolve;
      })
  );
  let current = true;
  const { result } = renderHook(() =>
    useNativePreviewBridge({ ...input, isIdentityCurrent: () => current })
  );
  current = false;
  await act(async () => {
    resolveBytes?.(new Uint8Array(16).fill(10));
  });
  expect(result.current.error).toBe('handshake');
});

it('times out when the preview document never finishes loading', async () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() => useNativePreviewBridge(input));
  await act(async () => {
    await Promise.resolve();
  });
  expect(result.current.nonce).toBe(nonce);
  act(() => vi.advanceTimersByTime(10_000));
  expect(result.current.error).toBe('load');
  unmount();
  vi.useRealTimers();
});
