import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import SplashMotion from 'react-native-splash-motion';
import { RootStartupError } from './RootStartupError';

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
