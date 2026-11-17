import { act, render, screen, waitFor } from '@testing-library/react-native';
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

it('shows the startup error immediately and dismisses the native splash', async () => {
  jest.mocked(SplashMotion.waitForIntro).mockReturnValue(
    new Promise(() => {
      /* A crash fallback must not wait on another intro promise. */
    })
  );
  jest.mocked(SplashMotion.hide).mockResolvedValue();
  render(
    <RootStartupError error={new Error('Broken startup')} retry={jest.fn()} />
  );

  expect(screen.getByText('Something went wrong')).toBeTruthy();
  expect(SplashMotion.waitForIntro).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(SplashMotion.hide).toHaveBeenCalledWith({
      waitForLoop: false,
      minDuration: 0,
      fade: 220,
    })
  );
});

it('keeps the error visible and records a failed native hide', async () => {
  const { recordCrashBreadcrumb } = jest.requireMock('@/lib/crash-diagnostics');
  jest
    .mocked(SplashMotion.hide)
    .mockRejectedValue(new Error('Native hide failed'));
  render(
    <RootStartupError error={new Error('Broken startup')} retry={jest.fn()} />
  );

  expect(screen.getByText('Something went wrong')).toBeTruthy();
  await waitFor(() =>
    expect(recordCrashBreadcrumb).toHaveBeenCalledWith(
      'root_startup_error:native_splash_hide_failed'
    )
  );
});

it('retries native splash dismissal immediately without animation', async () => {
  jest
    .mocked(SplashMotion.hide)
    .mockRejectedValueOnce(new Error('Transient native failure'))
    .mockResolvedValueOnce();

  render(
    <RootStartupError error={new Error('Broken startup')} retry={jest.fn()} />
  );

  await waitFor(() => expect(SplashMotion.hide).toHaveBeenCalledTimes(2));
  expect(SplashMotion.hide).toHaveBeenNthCalledWith(2, {
    waitForLoop: false,
    minDuration: 0,
    fade: 0,
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
