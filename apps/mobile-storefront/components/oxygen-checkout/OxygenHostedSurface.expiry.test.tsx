import { act, fireEvent, render } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { OxygenHostedSurface } from './OxygenHostedSurface';

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
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
it('blocks an expired link and offers selfie renewal', () => {
  const onRenew = jest.fn();
  const view = render(
    <OxygenHostedSurface {...props} sessionExpired onRenew={onRenew} />
  );
  expect(view.queryByRole('button', { name: 'Continue to Oxygen' })).toBeNull();
  expect(view.getByText('Your verification session expired')).toBeTruthy();
  expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
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
    expect(
      view.queryByRole('button', { name: 'Continue to Oxygen' })
    ).toBeNull();
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
