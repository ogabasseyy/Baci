import { builderDesignCapabilities } from '@baci/shared/contracts';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativePreviewCanvas } from './native-preview-canvas';

vi.mock('@/components/storefront/render-builder-config', () => ({
  RenderBuilderConfig: ({
    config,
    onRendered,
  }: {
    config: { content: Array<{ props: { id: string } }> };
    onRendered: () => void;
  }) => {
    if (config.content[0]?.props.id === 'render-failure')
      throw new Error('fixture failure');
    useEffect(() => {
      onRendered();
    }, [onRendered]);
    return <output>{config.content[0]?.props.id}</output>;
  },
}));
const nonce = 'a'.repeat(32);
const init = {
  type: 'baci.builder-preview.native-init',
  version: 2,
  sessionNonce: nonce,
};
const message = (revision: number, id: string) => ({
  type: 'baci.builder-preview.native-render',
  version: 2,
  sessionNonce: nonce,
  revision,
  capabilityHash: builderDesignCapabilities.capabilityHash,
  capabilityVersion: builderDesignCapabilities.capabilityVersion,
  merchant: { id: 'merchant-1', slug: 'acme' },
  candidateConfig: {
    content: [{ type: 'Text', props: { id, title: 'Hello' } }],
    root: { props: { title: 'Home' } },
  },
});
function dispatch(
  payload: unknown,
  target: Window | Document = window,
  source?: Window | null
) {
  act(() =>
    target.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify(payload),
        ...(source === undefined ? {} : { source }),
      })
    )
  );
}
function bridge() {
  const postMessage = vi.fn();
  Object.defineProperty(window, 'ReactNativeWebView', {
    configurable: true,
    value: { postMessage },
  });
  return postMessage;
}
afterEach(() => {
  delete (window as Window & { ReactNativeWebView?: unknown })
    .ReactNativeWebView;
});

describe('native preview renderer', () => {
  it('accepts only a handshaken session and rejects wrong or stale revisions', async () => {
    const post = bridge();
    render(<NativePreviewCanvas />);
    dispatch(message(1, 'before-init'));
    expect(screen.queryByText('before-init')).toBeNull();
    dispatch(init);
    expect(post).toHaveBeenCalledWith(expect.stringContaining('native-ready'));
    dispatch({ ...message(1, 'wrong-session'), sessionNonce: 'b'.repeat(32) });
    expect(screen.queryByText('wrong-session')).toBeNull();
    dispatch(message(1, 'first'), document);
    expect(await screen.findByText('first')).toBeInTheDocument();
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.stringContaining('native-rendered')
      )
    );
    dispatch(message(1, 'stale'));
    expect(screen.queryByText('stale')).toBeNull();
  });
  it('ignores cross-window messages and requires the native bridge', () => {
    render(<NativePreviewCanvas />);
    dispatch(init);
    bridge();
    dispatch(init, window, window);
    dispatch(message(1, 'untrusted'), window, window);
    expect(screen.queryByText('untrusted')).toBeNull();
  });
  it('does not establish a native session inside a parent frame', () => {
    const post = bridge();
    const originalParent = window.parent;
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: vi.fn() },
    });
    try {
      render(<NativePreviewCanvas />);
      dispatch(init);
      dispatch(message(1, 'framed'));
      expect(post).not.toHaveBeenCalled();
      expect(screen.queryByText('framed')).toBeNull();
    } finally {
      Object.defineProperty(window, 'parent', {
        configurable: true,
        value: originalParent,
      });
    }
  });
  it('keeps the committed preview when rotating the session and accepting revision one again', async () => {
    bridge();
    render(<NativePreviewCanvas />);
    dispatch(init);
    dispatch(message(1, 'first'));
    expect(await screen.findByText('first')).toBeInTheDocument();
    const nextNonce = 'b'.repeat(32);
    dispatch({ ...init, sessionNonce: nextNonce, previousSessionNonce: nonce });
    expect(screen.getByText('first')).toBeInTheDocument();
    dispatch({ ...message(1, 'next'), sessionNonce: nextNonce });
    expect(await screen.findByText('next')).toBeInTheDocument();
    expect(screen.queryByText('first')).not.toBeInTheDocument();
  });
  it('keeps the last committed preview if a later render fails', async () => {
    const post = bridge();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<NativePreviewCanvas />);
    dispatch(init);
    dispatch(message(1, 'first'));
    expect(await screen.findByText('first')).toBeInTheDocument();
    dispatch(message(2, 'render-failure'));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(expect.stringContaining('native-error'))
    );
    expect(screen.getByText('first')).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
