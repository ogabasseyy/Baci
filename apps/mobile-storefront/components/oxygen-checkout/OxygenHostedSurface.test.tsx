import { act, fireEvent, render } from '@testing-library/react-native';
import { Camera } from 'expo-camera';
import { StrictMode } from 'react';
import { AppState, type AppStateStatus, Linking } from 'react-native';
import { OxygenHostedSurface } from './OxygenHostedSurface';
import { recordOxygenSelfieDiagnostic } from './oxygen-selfie-diagnostics';

jest.mock('./oxygen-selfie-diagnostics', () => ({
  recordOxygenSelfieDiagnostic: jest.fn(),
}));

jest.mock('react-native-webview', () => ({ WebView: 'ProviderWebView' }));
jest.mock('expo-camera', () => ({
  Camera: {
    getCameraPermissionsAsync: jest.fn(),
    requestCameraPermissionsAsync: jest.fn(),
  },
}));
const capabilities = {
  hostedOrigins: ['https://pay.example'],
  selfieOrigins: [],
};
describe('hosted Oxygen surface', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(Camera.requestCameraPermissionsAsync).mockResolvedValue({
      granted: false,
      canAskAgain: true,
    } as Awaited<ReturnType<typeof Camera.requestCameraPermissionsAsync>>);
    AppState.currentState = 'active';
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(() => ({ remove: jest.fn() }));
  });
  it('opens the provider page first, then requests camera permission only after it loads', async () => {
    jest.mocked(Camera.requestCameraPermissionsAsync).mockResolvedValue({
      granted: true,
      canAskAgain: true,
    } as Awaited<ReturnType<typeof Camera.requestCameraPermissionsAsync>>);
    const view = render(
      <OxygenHostedSurface
        url="https://pay.example/selfie"
        kind="selfie"
        capabilities={{
          ...capabilities,
          selfieOrigins: capabilities.hostedOrigins,
        }}
        active
        onRefresh={jest.fn()}
        onExit={jest.fn()}
      />
    );
    const web = view.UNSAFE_getByType('ProviderWebView' as never);
    expect(web.props.mediaPlaybackRequiresUserAction).toBe(false);
    expect(Camera.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(view.queryByText('Opening your selfie camera…')).toBeNull();
    await act(async () =>
      web.props.onLoadEnd({
        nativeEvent: { url: 'https://pay.example/selfie' },
      })
    );
    expect(Camera.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(recordOxygenSelfieDiagnostic).toHaveBeenCalledWith('page_loaded');
    expect(recordOxygenSelfieDiagnostic).toHaveBeenCalledWith('camera_granted');
    await act(async () =>
      view
        .UNSAFE_getByType('ProviderWebView' as never)
        .props.onLoadEnd({ nativeEvent: { url: 'https://pay.example/selfie' } })
    );
    expect(Camera.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(view.UNSAFE_getByType('ProviderWebView' as never)).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Allow camera' })).toBeNull();
  });
  it('offers Settings after permanent denial without repeatedly prompting', async () => {
    jest.mocked(Camera.requestCameraPermissionsAsync).mockResolvedValue({
      granted: false,
      canAskAgain: false,
    } as Awaited<ReturnType<typeof Camera.requestCameraPermissionsAsync>>);
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    const view = render(
      <OxygenHostedSurface
        url="https://pay.example/selfie"
        kind="selfie"
        capabilities={{
          ...capabilities,
          selfieOrigins: capabilities.hostedOrigins,
        }}
        active
        onRefresh={jest.fn()}
        onExit={jest.fn()}
      />
    );
    await act(async () =>
      view
        .UNSAFE_getByType('ProviderWebView' as never)
        .props.onLoadEnd({ nativeEvent: { url: 'https://pay.example/selfie' } })
    );
    fireEvent.press(view.getByRole('button', { name: 'Open Settings' }));
    expect(settings).toHaveBeenCalledTimes(1);
    expect(Camera.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    settings.mockRestore();
  });
  it.each([
    'onError',
    'onHttpError',
  ])('does not prompt for camera access when the provider page fails: %s', async (failure) => {
    const view = render(
      <OxygenHostedSurface
        url="https://pay.example/selfie"
        kind="selfie"
        capabilities={{
          ...capabilities,
          selfieOrigins: capabilities.hostedOrigins,
        }}
        active
        onRefresh={jest.fn()}
        onExit={jest.fn()}
      />
    );
    const web = view.UNSAFE_getByType('ProviderWebView' as never);
    await act(async () => {
      web.props[failure]();
      web.props.onLoadEnd({
        nativeEvent: { url: 'https://pay.example/selfie' },
      });
    });
    expect(Camera.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(view.getByRole('alert')).toBeTruthy();
    expect(recordOxygenSelfieDiagnostic).toHaveBeenCalledWith(
      failure === 'onError' ? 'page_load_failed' : 'page_http_failed'
    );
    expect(recordOxygenSelfieDiagnostic).not.toHaveBeenCalledWith('confirmed');
  });
  it('untrusted redirects and fabricated bridge messages never establish completion', async () => {
    const onRefresh = jest.fn(async () => undefined);
    const onExit = jest.fn();
    const view = render(
      <StrictMode>
        <OxygenHostedSurface
          url="https://pay.example/pay"
          kind="payment"
          capabilities={capabilities}
          active
          onRefresh={onRefresh}
          onExit={onExit}
        />
      </StrictMode>
    );
    const web = view.UNSAFE_getByType('ProviderWebView' as never);
    expect(web.props.source).toEqual({ uri: 'https://pay.example/pay' });
    expect(
      web.props.onShouldStartLoadWithRequest({
        url: 'https://evil.example/success',
      })
    ).toBe(false);
    await act(async () => {
      web.props.onMessage({
        nativeEvent: { data: '{"paid":true,"activated":true}' },
      });
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    expect(
      web.props.onShouldStartLoadWithRequest({
        url: 'https://pay.example/success',
      })
    ).toBe(true);
  });
  it('opens only pinned payment popups in the external browser', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const view = render(
      <OxygenHostedSurface
        url="https://pay.example/pay"
        kind="payment"
        capabilities={capabilities}
        active
        onRefresh={async () => undefined}
        onExit={jest.fn()}
      />
    );
    const web = view.UNSAFE_getByType('ProviderWebView' as never);
    act(() =>
      web.props.onOpenWindow({
        nativeEvent: { targetUrl: 'https://evil.example/3ds' },
      })
    );
    expect(openURL).not.toHaveBeenCalled();
    await act(async () =>
      web.props.onOpenWindow({
        nativeEvent: { targetUrl: 'https://pay.example/3ds' },
      })
    );
    expect(openURL).toHaveBeenCalledWith('https://pay.example/3ds');
    openURL.mockRestore();
  });
  it('denies bad initial links and keeps saved progress on exit', () => {
    const onExit = jest.fn();
    const view = render(
      <OxygenHostedSurface
        url="https://evil.example/pay"
        kind="payment"
        capabilities={capabilities}
        active
        onRefresh={async () => undefined}
        onExit={onExit}
      />
    );
    expect(view.queryByTestId('oxygen-hosted')).toBeNull();
    fireEvent.press(
      view.getByRole('button', { name: 'Return to saved progress' })
    );
    expect(onExit).toHaveBeenCalledTimes(1);
  });
  it('stops background polling, refreshes on resume and stops on unmount', async () => {
    jest.useFakeTimers();
    const onRefresh = jest.fn(async () => undefined);
    let stateChange: (state: AppStateStatus) => void = () => {};
    const listener = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        stateChange = listener;
        return { remove: jest.fn() };
      });
    const view = render(
      <OxygenHostedSurface
        url="https://pay.example/pay"
        kind="payment"
        capabilities={capabilities}
        active
        onRefresh={onRefresh}
        onExit={jest.fn()}
      />
    );
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      stateChange('background');
      jest.advanceTimersByTime(10000);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId('oxygen-hosted')).toBeNull();
    await act(async () => {
      stateChange('active');
    });
    expect(onRefresh).toHaveBeenCalledTimes(2);
    view.unmount();
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(onRefresh).toHaveBeenCalledTimes(2);
    listener.mockRestore();
    jest.useRealTimers();
  });
  it('camera denial remains distinct from verification and sends no provider read', async () => {
    const onRefresh = jest.fn(async () => undefined);
    const view = render(
      <OxygenHostedSurface
        url="https://pay.example/selfie"
        kind="selfie"
        capabilities={{
          ...capabilities,
          selfieOrigins: capabilities.hostedOrigins,
        }}
        active
        onRefresh={onRefresh}
        onExit={jest.fn()}
      />
    );
    await act(async () =>
      view
        .UNSAFE_getByType('ProviderWebView' as never)
        .props.onLoadEnd({ nativeEvent: { url: 'https://pay.example/selfie' } })
    );
    expect(Camera.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(view.getByRole('button', { name: 'Allow camera' })).toBeTruthy();
    expect(
      view.getByText(
        'Camera access denied. Enable camera access in Settings to continue.'
      )
    ).toBeTruthy();
    expect(view.UNSAFE_getByType('ProviderWebView' as never)).toBeTruthy();
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
