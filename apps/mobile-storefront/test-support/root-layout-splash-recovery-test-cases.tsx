import { expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type React from 'react';
import { registerRootLayoutPendingSplashRecoveryTest } from './root-layout-pending-splash-recovery-test-cases';
import { registerRootLayoutTimeoutPlaceholderTests } from './root-layout-timeout-placeholder-test-cases';

export interface SplashRecoveryTestContext {
  RootLayout: React.ComponentType;
  authState: { isInitialized: boolean };
  initializeStorage: jest.Mock<() => Promise<void>>;
  prefetchStartupStorefrontData: jest.Mock<() => Promise<void>>;
  hideSplash: jest.Mock<(options: unknown) => Promise<void>>;
  isSplashVisible: jest.Mock<() => boolean>;
  useAppTrackingTransparency: jest.Mock;
  usePushNotifications: jest.Mock;
  verifyBenchmarkTelemetry: jest.Mock;
  markStartupTiming: jest.Mock;
  rootLayoutNavMount: jest.Mock;
  rootLayoutNavUnmount: jest.Mock;
  setAutoLayout: (autoLayout: boolean) => void;
  finishNativeSplash: () => Promise<void>;
}

export function registerRootLayoutSplashRecoveryTests({
  RootLayout,
  authState,
  initializeStorage,
  prefetchStartupStorefrontData,
  hideSplash,
  isSplashVisible,
  useAppTrackingTransparency,
  usePushNotifications,
  verifyBenchmarkTelemetry,
  markStartupTiming,
  rootLayoutNavMount,
  rootLayoutNavUnmount,
  setAutoLayout,
  finishNativeSplash,
}: SplashRecoveryTestContext) {
  it('keeps the splash until the navigation shell has laid out', async () => {
    setAutoLayout(false);
    initializeStorage.mockResolvedValue(undefined);
    render(<RootLayout />);
    await waitFor(() =>
      expect(screen.getByTestId('root-layout-nav')).toBeOnTheScreen()
    );
    expect(hideSplash).not.toHaveBeenCalled();
    fireEvent(screen.getByTestId('root-layout-nav'), 'layout');
    await waitFor(() => expect(hideSplash).toHaveBeenCalledTimes(1));
    expect(hideSplash).toHaveBeenCalledWith({
      waitForLoop: false,
      minDuration: 0,
      fade: 220,
    });
  });

  it('keeps navigation gated during timeout recovery until auth becomes ready', async () => {
    setAutoLayout(false);
    authState.isInitialized = false;
    initializeStorage.mockResolvedValue(undefined);
    const view = render(<RootLayout />);
    await waitFor(() =>
      expect(screen.getByTestId('root-layout-nav')).toBeOnTheScreen()
    );
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    await waitFor(() => expect(hideSplash).toHaveBeenCalledTimes(1));
    expect(hideSplash).toHaveBeenCalledWith({
      waitForLoop: false,
      minDuration: 0,
      fade: 220,
    });
    expect(screen.getByTestId('startup-recovery-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('root-layout-nav')).toBeNull();

    authState.isInitialized = true;
    view.rerender(<RootLayout />);
    await finishNativeSplash();
    await waitFor(() =>
      expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
        /resume:true/
      )
    );
  });

  it('dismisses when a delayed navigation layout arrives', async () => {
    setAutoLayout(false);
    initializeStorage.mockResolvedValue(undefined);
    render(<RootLayout />);
    await waitFor(() =>
      expect(screen.getByTestId('root-layout-nav')).toBeOnTheScreen()
    );
    expect(hideSplash).not.toHaveBeenCalled();
    fireEvent(screen.getByTestId('root-layout-nav'), 'layout');
    await waitFor(() => expect(hideSplash).toHaveBeenCalledTimes(1));
  });

  it('waits for native splash dismissal before enabling ATT and persistence', async () => {
    let finishHide!: () => void;
    initializeStorage.mockResolvedValue(undefined);
    hideSplash.mockReturnValue(
      new Promise<void>((resolve) => {
        finishHide = resolve;
      })
    );
    render(<RootLayout />);
    await waitFor(() => expect(hideSplash).toHaveBeenCalledTimes(1));
    expect(hideSplash).toHaveBeenCalledWith({
      waitForLoop: false,
      minDuration: 0,
      fade: 220,
    });
    expect(useAppTrackingTransparency).toHaveBeenLastCalledWith({
      enabled: false,
    });
    expect(usePushNotifications).toHaveBeenLastCalledWith({
      navigationReady: false,
    });
    expect(verifyBenchmarkTelemetry).not.toHaveBeenCalled();
    expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
      /persistence:false/
    );
    await act(async () => finishHide());
    await waitFor(() =>
      expect(useAppTrackingTransparency).toHaveBeenLastCalledWith({
        enabled: true,
      })
    );
    expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
      /persistence:true/
    );
    expect(usePushNotifications).toHaveBeenLastCalledWith({
      navigationReady: true,
    });
    expect(verifyBenchmarkTelemetry).toHaveBeenCalledTimes(1);
  });

  it('keeps startup recovery visible if the native hide request rejects', async () => {
    initializeStorage.mockResolvedValue(undefined);
    isSplashVisible.mockReturnValue(true);
    hideSplash.mockRejectedValue(new Error('native splash unavailable'));

    render(<RootLayout />);

    await waitFor(() => expect(hideSplash).toHaveBeenCalledTimes(3));
    expect(hideSplash).toHaveBeenCalledTimes(3);
    expect(hideSplash).toHaveBeenLastCalledWith({
      waitForLoop: false,
      minDuration: 0,
      fade: 0,
    });
    expect(screen.queryByTestId('startup-recovery-screen')).toBeNull();
    expect(rootLayoutNavUnmount).not.toHaveBeenCalled();
    isSplashVisible.mockReturnValue(false);
    act(() => jest.advanceTimersByTime(250));
    await waitFor(() =>
      expect(screen.getByTestId('startup-recovery-screen')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('root-layout-nav')).toBeNull();
    expect(useAppTrackingTransparency).toHaveBeenLastCalledWith({
      enabled: false,
    });
  });

  it('retries navigation after the startup deadline when fonts and storage are ready', async () => {
    setAutoLayout(false);
    initializeStorage.mockResolvedValue(undefined);

    render(<RootLayout />);
    await waitFor(() =>
      expect(screen.getByTestId('root-layout-nav')).toBeOnTheScreen()
    );

    act(() => {
      jest.advanceTimersByTime(8000);
    });

    await waitFor(() => expect(hideSplash).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('startup-recovery-screen')).toBeNull();
    expect(screen.getByTestId('root-layout-nav')).toBeOnTheScreen();
    fireEvent(screen.getByTestId('root-layout-nav'), 'layout');
    expect(screen.queryByTestId('startup-recovery-screen')).toBeNull();
  });

  it('resumes navigation when delayed startup storage becomes ready', async () => {
    setAutoLayout(false);
    let resolveStorage!: () => void;
    initializeStorage.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveStorage = resolve;
      })
    );

    render(<RootLayout />);
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    await waitFor(() => expect(hideSplash).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('startup-recovery-screen')).toBeOnTheScreen();

    await act(async () => resolveStorage());

    await waitFor(() =>
      expect(screen.getByTestId('root-layout-nav')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('startup-recovery-screen')).toBeNull();
  });

  it('shows recovery and releases the splash when startup storage is not ready', async () => {
    initializeStorage.mockReturnValue(new Promise(() => undefined));

    render(<RootLayout />);

    expect(prefetchStartupStorefrontData).toHaveBeenCalledTimes(1);
    expect(hideSplash).not.toHaveBeenCalled();
    expect(screen.queryByTestId('root-layout-nav')).toBeNull();

    act(() => {
      jest.advanceTimersByTime(8000);
    });

    await waitFor(() => expect(hideSplash).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('root-layout-nav')).toBeNull();
    expect(screen.getByTestId('startup-recovery-screen')).toBeOnTheScreen();
  });

  it('keeps storage gated and enters recovery when storage initialization rejects', async () => {
    isSplashVisible.mockReturnValue(true);
    let rejectStorage!: (error: Error) => void;
    initializeStorage.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectStorage = reject;
      })
    );

    render(<RootLayout />);
    await act(async () => rejectStorage(new Error('storage unavailable')));

    expect(screen.queryByTestId('root-layout-nav')).toBeNull();
    expect(screen.queryByTestId('startup-placeholder')).toBeNull();

    act(() => jest.advanceTimersByTime(8_000));
    await waitFor(() => expect(hideSplash).toHaveBeenCalledTimes(1));
    await finishNativeSplash();

    expect(screen.getByTestId('startup-recovery-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('root-layout-nav')).toBeNull();
  });

  it('reports layout when the startup recovery screen becomes visible', async () => {
    initializeStorage.mockReturnValue(new Promise(() => undefined));

    render(<RootLayout />);
    act(() => jest.advanceTimersByTime(8000));
    await waitFor(() =>
      expect(screen.getByTestId('startup-recovery-screen')).toBeOnTheScreen()
    );

    fireEvent(screen.getByTestId('startup-recovery-screen'), 'layout');

    expect(markStartupTiming).toHaveBeenCalledWith('root_first_layout');
  });

  it('keeps the navigator mounted when the startup splash finishes', async () => {
    initializeStorage.mockResolvedValue(undefined);

    render(<RootLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
        'adTracking:true;persistence:false;resume:false'
      );
    });
    expect(rootLayoutNavMount).toHaveBeenCalledTimes(1);

    await finishNativeSplash();

    await waitFor(() => {
      expect(useAppTrackingTransparency).toHaveBeenLastCalledWith({
        enabled: true,
      });
    });
    expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
      'adTracking:true;persistence:true;resume:true'
    );
    expect(rootLayoutNavMount).toHaveBeenCalledTimes(1);
    expect(rootLayoutNavUnmount).not.toHaveBeenCalled();
  });

  registerRootLayoutPendingSplashRecoveryTest({
    RootLayout,
    initializeStorage,
    hideSplash,
    isSplashVisible,
    rootLayoutNavUnmount,
  });

  registerRootLayoutTimeoutPlaceholderTests({
    RootLayout,
    initializeStorage,
    hideSplash,
    isSplashVisible,
  });
}
