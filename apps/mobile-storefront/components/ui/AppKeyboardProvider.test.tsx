import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import AppKeyboardProvider from './AppKeyboardProvider';

const originalRequestIdleCallback = global.requestIdleCallback;
const originalCancelIdleCallback = global.cancelIdleCallback;
let pendingIdleCallback: (() => void) | undefined;
const cancelIdleCallbackMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  pendingIdleCallback = undefined;
  global.requestIdleCallback = jest.fn((callback) => {
    pendingIdleCallback = () =>
      callback({ didTimeout: false, timeRemaining: () => 50 });
    return 1;
  });
  global.cancelIdleCallback = cancelIdleCallbackMock;
});

afterEach(() => {
  jest.useRealTimers();
  global.requestIdleCallback = originalRequestIdleCallback;
  global.cancelIdleCallback = originalCancelIdleCallback;
});

describe('AppKeyboardProvider', () => {
  it('renders children inside an edge-to-edge keyboard provider', () => {
    render(
      <AppKeyboardProvider>
        <Text>Storefront app</Text>
      </AppKeyboardProvider>
    );

    const provider = screen.getByTestId('keyboard-provider');

    expect(screen.getByText('Storefront app')).toBeTruthy();
    expect(provider).toHaveProp('preload', false);
    expect(provider).toHaveProp('navigationBarTranslucent', true);
    expect(provider).toHaveProp('preserveEdgeToEdge', true);
    expect(provider).toHaveProp('statusBarTranslucent', true);
  });

  it('preloads the keyboard only after startup and when the event loop is idle', async () => {
    const view = render(
      <AppKeyboardProvider startupReady={false}>
        <Text>Storefront app</Text>
      </AppKeyboardProvider>
    );

    expect(global.requestIdleCallback).not.toHaveBeenCalled();
    expect(KeyboardController.preload).not.toHaveBeenCalled();

    view.rerender(
      <AppKeyboardProvider startupReady>
        <Text>Storefront app</Text>
      </AppKeyboardProvider>
    );

    expect(global.requestIdleCallback).toHaveBeenCalledWith(
      expect.any(Function),
      { timeout: 1200 }
    );
    expect(KeyboardController.preload).not.toHaveBeenCalled();

    await act(async () => pendingIdleCallback?.());
    expect(KeyboardController.preload).toHaveBeenCalledTimes(1);
  });

  it('cancels pending keyboard preload when the provider unmounts', async () => {
    const view = render(
      <AppKeyboardProvider startupReady>
        <Text>Storefront app</Text>
      </AppKeyboardProvider>
    );
    const lateCallback = pendingIdleCallback;

    view.unmount();
    expect(cancelIdleCallbackMock).toHaveBeenCalledWith(1);

    await act(async () => lateCallback?.());
    expect(KeyboardController.preload).not.toHaveBeenCalled();
  });

  it('falls back to a delayed timer when idle callbacks are unavailable', () => {
    jest.useFakeTimers();
    Object.defineProperty(global, 'requestIdleCallback', {
      configurable: true,
      value: undefined,
    });
    render(
      <AppKeyboardProvider startupReady>
        <Text>Storefront app</Text>
      </AppKeyboardProvider>
    );

    expect(KeyboardController.preload).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(249));
    expect(KeyboardController.preload).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(KeyboardController.preload).toHaveBeenCalledTimes(1);
  });

  it('cancels the timer fallback when the provider unmounts', () => {
    jest.useFakeTimers();
    Object.defineProperty(global, 'requestIdleCallback', {
      configurable: true,
      value: undefined,
    });
    const view = render(
      <AppKeyboardProvider startupReady>
        <Text>Storefront app</Text>
      </AppKeyboardProvider>
    );

    view.unmount();
    act(() => jest.advanceTimersByTime(250));

    expect(KeyboardController.preload).not.toHaveBeenCalled();
  });
});
