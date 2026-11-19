import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { reloadAppAsync } from 'expo';
import * as Updates from 'expo-updates';
import Colors from '@/constants/Colors';
import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';
import { StartupRecoveryScreen } from './StartupRecoveryScreen';

jest.unmock('react-native/Libraries/Utilities/useColorScheme');
jest.mock('expo', () => ({ reloadAppAsync: jest.fn() }));
jest.mock('expo-updates', () => ({
  isEnabled: true,
  reloadAsync: jest.fn(),
}));
jest.mock('@/lib/crash-diagnostics', () => ({
  recordCrashBreadcrumb: jest.fn(),
}));
const mockAppearanceListeners = new Set<() => void>();
let mockSystemScheme: 'light' | 'dark' = 'light';
jest.mock('react-native/Libraries/Utilities/Appearance', () => ({
  addChangeListener: (listener: () => void) => {
    mockAppearanceListeners.add(listener);
    return { remove: () => mockAppearanceListeners.delete(listener) };
  },
  getColorScheme: () => mockSystemScheme,
}));

it('updates the visible recovery screen when the system appearance changes', () => {
  mockSystemScheme = 'light';
  render(<StartupRecoveryScreen onLayout={jest.fn()} />);
  const recovery = () => screen.getByTestId('startup-recovery-screen');
  expect(recovery()).toHaveStyle({ backgroundColor: Colors.light.background });
  act(() => {
    mockSystemScheme = 'dark';
    for (const notify of mockAppearanceListeners) notify();
  });
  expect(recovery()).toHaveStyle({ backgroundColor: Colors.dark.background });
});

const reload = jest.mocked(reloadAppAsync);
const reloadUpdate = jest.mocked(Updates.reloadAsync);
const recordBreadcrumb = jest.mocked(recordCrashBreadcrumb);
afterEach(() => jest.clearAllMocks());

it('shows an accessible retry and reports layout', () => {
  const onLayout = jest.fn();
  render(<StartupRecoveryScreen onLayout={onLayout} />);
  expect(screen.getByText('Taking longer than expected')).toBeTruthy();
  fireEvent(screen.getByTestId('startup-recovery-screen'), 'layout', {});
  expect(onLayout).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
});

it('prevents concurrent reloads and reports a failed retry', async () => {
  let reject!: (error: Error) => void;
  reload.mockReturnValueOnce(
    new Promise((_, rejectPromise) => {
      reject = rejectPromise;
    })
  );
  reload.mockReturnValueOnce(new Promise(() => {}));
  reloadUpdate.mockRejectedValueOnce(new Error('updates reload failed'));
  render(<StartupRecoveryScreen onLayout={jest.fn()} />);
  const button = screen.getByRole('button', { name: 'Try again' });
  fireEvent.press(button);
  fireEvent.press(button);
  expect(reload).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('failed')));
  await waitFor(() =>
    expect(
      screen.getByText(
        'Could not restart automatically. Close and reopen the app, then try again.'
      )
    ).toBeTruthy()
  );
  expect(reloadUpdate).toHaveBeenCalledTimes(1);
  expect(recordBreadcrumb).toHaveBeenCalledWith(
    'startup_recovery:reload_failed',
    {
      isError: true,
      errorType: 'Error',
      fallbackErrorType: 'Error',
    }
  );
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(reload).toHaveBeenCalledTimes(2);
});

it('tries Expo Updates when the native reload bridge fails', async () => {
  reload.mockRejectedValueOnce(new Error('native reload failed'));
  reloadUpdate.mockResolvedValueOnce();
  render(<StartupRecoveryScreen onLayout={jest.fn()} />);

  fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

  await waitFor(() => expect(reloadUpdate).toHaveBeenCalledTimes(1));
  expect(
    screen.queryByText(
      'Could not restart automatically. Close and reopen the app, then try again.'
    )
  ).toBeNull();
});
