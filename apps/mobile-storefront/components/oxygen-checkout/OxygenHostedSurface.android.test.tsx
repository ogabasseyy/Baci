import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState, Linking, Platform } from 'react-native';
import { OxygenHostedSurface } from './OxygenHostedSurface';

jest.mock('react-native-webview', () => ({ WebView: 'ProviderWebView' }));
jest.mock('./oxygen-selfie-diagnostics', () => ({
  recordOxygenSelfieDiagnostic: jest.fn(),
}));

const capabilities = {
  hostedOrigins: ['https://pay.example'],
  selfieOrigins: [],
};

it('opens the verified Android provider link in the browser and checks status on return', async () => {
  const originalPlatform = Platform.OS;
  Reflect.set(Platform, 'OS', 'android');
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const onRefresh = jest.fn(async () => undefined);
  const callback = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(() => ({ remove: jest.fn() }));
  try {
    AppState.currentState = 'active';
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
    expect(view.queryByTestId('oxygen-hosted')).toBeNull();
    expect(open).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(
        view.getByRole('button', { name: 'Continue in browser' })
      );
    });
    expect(open).toHaveBeenCalledWith('https://pay.example/pay');
    expect(onRefresh).not.toHaveBeenCalled();
    const onAppStateChange = callback.mock.lastCall?.[1];
    expect(onAppStateChange).toBeDefined();
    await act(async () => {
      onAppStateChange?.('background');
      onAppStateChange?.('active');
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  } finally {
    Reflect.set(Platform, 'OS', originalPlatform);
    open.mockRestore();
    callback.mockRestore();
  }
});

it('does not expose an Android browser action for an untrusted provider link', () => {
  const originalPlatform = Platform.OS;
  Reflect.set(Platform, 'OS', 'android');
  const appState = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(() => ({ remove: jest.fn() }));
  try {
    const view = render(
      <OxygenHostedSurface
        url="https://untrusted.example/pay"
        kind="payment"
        capabilities={capabilities}
        active
        onRefresh={jest.fn()}
        onExit={jest.fn()}
      />
    );
    expect(view.getByRole('alert')).toBeOnTheScreen();
    expect(
      view.queryByRole('button', { name: 'Continue in browser' })
    ).toBeNull();
    expect(view.queryByTestId('oxygen-hosted')).toBeNull();
  } finally {
    Reflect.set(Platform, 'OS', originalPlatform);
    appState.mockRestore();
  }
});
