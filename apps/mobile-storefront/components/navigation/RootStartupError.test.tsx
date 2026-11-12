import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import SplashMotion from 'react-native-splash-motion';
import Colors from '@/constants/Colors';
import { RootStartupError } from './RootStartupError';

jest.unmock('react-native/Libraries/Utilities/useColorScheme');
const mockAppearanceListeners = new Set<() => void>();
let mockSystemScheme: 'light' | 'dark' = 'light';
jest.mock('react-native/Libraries/Utilities/Appearance', () => ({
  addChangeListener: (listener: () => void) => {
    mockAppearanceListeners.add(listener);
    return { remove: () => mockAppearanceListeners.delete(listener) };
  },
  getColorScheme: () => mockSystemScheme,
}));

jest.mock('react-native-splash-motion', () => ({
  __esModule: true,
  default: { waitForIntro: jest.fn(), hide: jest.fn() },
}));
jest.mock('@/lib/crash-diagnostics', () => ({
  recordCrashBreadcrumb: jest.fn(),
}));
jest.mock('@/lib/startup-timing', () => ({ markStartupTiming: jest.fn() }));
jest.mock('../error-boundary-content', () => ({
  classifyError: jest.fn(() => 'general'),
  getErrorContent: jest.fn(() => ({
    title: 'Something went wrong',
    message: '',
    buttonText: 'Retry',
    icon: 'refresh',
  })),
  logError: jest.fn(),
}));

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

it('keeps the native intro until it completes and the error screen lays out', async () => {
  let finishIntro!: (value: boolean) => void;
  jest.mocked(SplashMotion.waitForIntro).mockReturnValue(
    new Promise((resolve) => {
      finishIntro = resolve;
    })
  );
  jest.mocked(SplashMotion.hide).mockResolvedValue();
  render(
    <RootStartupError error={new Error('Broken startup')} retry={jest.fn()} />
  );
  expect(screen.queryByText('Something went wrong')).toBeNull();
  expect(SplashMotion.hide).not.toHaveBeenCalled();
  await act(async () => finishIntro(true));
  expect(screen.getByText('Something went wrong')).toBeTruthy();
  expect(SplashMotion.hide).not.toHaveBeenCalled();
  fireEvent(screen.getByTestId('root-startup-error'), 'layout', {});
  await waitFor(() => expect(SplashMotion.hide).toHaveBeenCalledTimes(1));
});

it('releases the native splash at the startup deadline without a second layout', async () => {
  jest.useFakeTimers();
  jest.mocked(SplashMotion.waitForIntro).mockReturnValue(
    new Promise(() => {
      /* Simulate the error fallback replacing an already-laid-out placeholder. */
    })
  );
  jest.mocked(SplashMotion.hide).mockResolvedValue();

  render(
    <RootStartupError error={new Error('Broken startup')} retry={jest.fn()} />
  );

  await act(async () => {
    jest.advanceTimersByTime(8000);
  });

  expect(screen.getByText('Something went wrong')).toBeTruthy();
  expect(SplashMotion.hide).toHaveBeenCalledWith({
    waitForLoop: false,
    minDuration: 0,
    fade: 220,
  });
});

it('updates the visible startup error when the system appearance changes', async () => {
  mockSystemScheme = 'light';
  jest.mocked(SplashMotion.waitForIntro).mockResolvedValue(true);
  render(
    <RootStartupError error={new Error('Broken startup')} retry={jest.fn()} />
  );
  const title = await screen.findByText('Something went wrong');
  expect(title).toHaveStyle({ color: Colors.light.foreground });
  act(() => {
    mockSystemScheme = 'dark';
    for (const notify of mockAppearanceListeners) notify();
  });
  expect(title).toHaveStyle({ color: Colors.dark.foreground });
});
