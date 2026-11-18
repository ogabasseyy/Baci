import { act, fireEvent, render } from '@testing-library/react-native';
import { Camera } from 'expo-camera';
import { OxygenHostedSurface } from './OxygenHostedSurface';

jest.mock('react-native-webview', () => ({ WebView: 'ProviderWebView' }));
jest.mock('expo-camera', () => ({
  Camera: {
    getCameraPermissionsAsync: jest.fn(),
    requestCameraPermissionsAsync: jest.fn(),
  },
}));
jest.mock('./oxygen-selfie-diagnostics', () => ({
  recordOxygenSelfieDiagnostic: jest.fn(),
}));
const props = {
  url: 'https://selfie.example/?securityToken=private',
  kind: 'selfie' as const,
  capabilities: {
    selfieOrigins: ['https://selfie.example'],
    hostedOrigins: [],
  },
  active: true,
  onRefresh: jest.fn(),
  onExit: jest.fn(),
};
it('removes an expired camera session and offers retry without asking permission again', () => {
  const onRenew = jest.fn();
  const view = render(
    <OxygenHostedSurface {...props} sessionExpired onRenew={onRenew} />
  );
  expect(view.queryByTestId('oxygen-hosted')).toBeNull();
  expect(view.getByText('Your verification session expired')).toBeTruthy();
  expect(Camera.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: 'Try again' }));
  expect(onRenew).toHaveBeenCalledTimes(1);
});
it('shows bounded renewal loading with no stale preview or competing polling', async () => {
  jest.useFakeTimers();
  try {
    const onRenew = jest.fn();
    const view = render(
      <OxygenHostedSurface {...props} renewing onRenew={onRenew} />
    );
    expect(view.queryByTestId('oxygen-hosted')).toBeNull();
    expect(
      view.getByText('Refreshing your verification session…')
    ).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: 'Refreshing session…' }));
    await act(async () => {
      jest.advanceTimersByTime(30000);
    });
    expect(onRenew).not.toHaveBeenCalled();
    expect(props.onRefresh).not.toHaveBeenCalled();
    view.unmount();
  } finally {
    jest.useRealTimers();
  }
});
