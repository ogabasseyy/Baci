import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { NativeCustomizePreviewPane } from './NativeCustomizePreviewPane';
import { useNativePreviewBridge } from './use-native-preview-bridge';

const mocks = vi.hoisted(() => ({
  onLoad: vi.fn(),
  onLoadStart: vi.fn(),
  onLoadError: vi.fn(),
  onMessage: vi.fn(),
  retry: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('react-native', async () => {
  const { createCustomizeReactNativeMock } = await import(
    './customize-test-react-native.mock'
  );
  return createCustomizeReactNativeMock({
    includeActivityIndicator: true,
    includePressable: true,
  });
});
vi.mock('./use-native-preview-bridge', () => ({
  useNativePreviewBridge: vi.fn(),
}));
vi.mock('react-native-webview', () => ({
  WebView: ({
    onLoad,
    onLoadStart,
    onMessage,
    onShouldStartLoadWithRequest,
    source,
  }: {
    onLoad: (event: { nativeEvent: { url: string } }) => void;
    onLoadStart: (event: { nativeEvent: { url: string } }) => void;
    onMessage: (event: { nativeEvent: { data: string } }) => void;
    onShouldStartLoadWithRequest: (request: { url: string }) => boolean;
    source: { uri: string };
  }) => (
    <div>
      <span>{source.uri}</span>
      <button
        type="button"
        onClick={() => onLoad({ nativeEvent: { url: source.uri } })}
      >
        load
      </button>
      <button
        type="button"
        onClick={() => onLoadStart({ nativeEvent: { url: source.uri } })}
      >
        start
      </button>
      <button
        type="button"
        onClick={() => onMessage({ nativeEvent: { data: 'payload' } })}
      >
        message
      </button>
      <button
        type="button"
        onClick={() =>
          mocks.navigate(
            onShouldStartLoadWithRequest({ url: 'https://evil.example/' })
          )
        }
      >
        navigate
      </button>
    </div>
  ),
}));
const props = {
  colors: LIGHT_COLORS,
  identityKey: 'user:merchant',
  draftRevision: 1,
  config: { content: [], root: {} },
  merchant: { id: 'merchant', slug: 'acme' },
  isIdentityCurrent: () => true,
  previewUrl: 'https://usebaci.com/template-preview/builder-preview?native=2',
};

describe('native preview host', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useNativePreviewBridge).mockReturnValue({
      nonce: 'a'.repeat(32),
      instanceId: 5,
      webViewRef: { current: null },
      hasRendered: true,
      pending: false,
      error: null,
      ...mocks,
    });
  });
  it('binds events to the active instance and rejects off-origin navigation', () => {
    render(<NativeCustomizePreviewPane {...props} />);
    fireEvent.click(screen.getByText('load'));
    fireEvent.click(screen.getByText('message'));
    fireEvent.click(screen.getByText('navigate'));
    expect(mocks.onLoad).toHaveBeenCalledWith(5, 'a'.repeat(32));
    expect(mocks.onMessage).toHaveBeenCalledWith(5, 'a'.repeat(32), 'payload');
    expect(mocks.navigate).toHaveBeenCalledWith(false);
  });
  it('offers the published preview if the draft cannot be validated', () => {
    const onFallback = vi.fn();
    vi.mocked(useNativePreviewBridge).mockReturnValue({
      nonce: 'a'.repeat(32),
      instanceId: 5,
      webViewRef: { current: null },
      hasRendered: false,
      pending: false,
      error: 'invalid',
      ...mocks,
    });
    render(<NativeCustomizePreviewPane {...props} onFallback={onFallback} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'View published store' })
    );
    expect(onFallback).toHaveBeenCalled();
  });
  it('offers the published store after a handshake failure', () => {
    const onFallback = vi.fn();
    vi.mocked(useNativePreviewBridge).mockReturnValue({
      nonce: 'a'.repeat(32),
      instanceId: 5,
      webViewRef: { current: null },
      hasRendered: false,
      pending: false,
      error: 'handshake',
      ...mocks,
    });
    render(<NativeCustomizePreviewPane {...props} onFallback={onFallback} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'View published store' })
    );
    expect(onFallback).toHaveBeenCalled();
  });
  it('retains the WebView and offers retry after a render error', () => {
    vi.mocked(useNativePreviewBridge).mockReturnValue({
      nonce: 'a'.repeat(32),
      instanceId: 5,
      webViewRef: { current: null },
      hasRendered: true,
      pending: false,
      error: 'render',
      ...mocks,
    });
    render(<NativeCustomizePreviewPane {...props} />);
    expect(screen.getByText(props.previewUrl)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
    expect(mocks.retry).toHaveBeenCalled();
  });
});
