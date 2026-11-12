import { expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type React from 'react';

interface SplashRecoveryTestContext {
  RootLayout: React.ComponentType;
  authState: { isInitialized: boolean };
  initializeStorage: jest.Mock<() => Promise<void>>;
  prefetchStartupStorefrontData: jest.Mock<() => Promise<void>>;
  hideSplash: jest.Mock<(options: unknown) => Promise<void>>;
  useAppTrackingTransparency: jest.Mock;
  usePushNotifications: jest.Mock;
  verifyBenchmarkTelemetry: jest.Mock;
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
  useAppTrackingTransparency,
  usePushNotifications,
  verifyBenchmarkTelemetry,
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

  it('does not restart the timeout when auth becomes ready', async () => {
    setAutoLayout(false);
    authState.isInitialized = false;
    initializeStorage.mockResolvedValue(undefined);
    const view = render(<RootLayout />);
    await waitFor(() =>
      expect(screen.getByTestId('root-layout-nav')).toBeOnTheScreen()
    );
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    authState.isInitialized = true;
    view.rerender(<RootLayout />);
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    await waitFor(() => expect(hideSplash).toHaveBeenCalledTimes(1));
    expect(hideSplash).toHaveBeenCalledWith({
      waitForLoop: false,
      minDuration: 0,
      fade: 220,
    });
    expect(screen.getByTestId('startup-recovery')).toBeOnTheScreen();
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
    hideSplash.mockRejectedValue(new Error('native splash unavailable'));

    render(<RootLayout />);

    await waitFor(() =>
      expect(screen.getByTestId('startup-recovery')).toBeOnTheScreen()
    );
    expect(hideSplash).toHaveBeenCalledTimes(3);
    expect(hideSplash).toHaveBeenLastCalledWith({
      waitForLoop: false,
      minDuration: 0,
      fade: 0,
    });
    expect(screen.queryByTestId('root-layout-nav')).toBeNull();
    expect(useAppTrackingTransparency).toHaveBeenLastCalledWith({
      enabled: false,
    });
  });

  it('shows recovery and releases the native splash when navigation never lays out', async () => {
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
    expect(screen.getByTestId('startup-recovery')).toBeOnTheScreen();
    expect(screen.queryByTestId('root-layout-nav')).toBeNull();
  });

  it('keeps recovery visible when only the recovery screen lays out', async () => {
    setAutoLayout(false);
    initializeStorage.mockResolvedValue(undefined);

    render(<RootLayout />);
    await waitFor(() =>
      expect(screen.getByTestId('root-layout-nav')).toBeOnTheScreen()
    );
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(screen.getByTestId('startup-recovery')).toBeOnTheScreen();

    fireEvent(screen.getByTestId('startup-recovery'), 'layout');

    expect(screen.getByTestId('startup-recovery')).toBeOnTheScreen();
    expect(screen.queryByTestId('root-layout-nav')).toBeNull();
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
    expect(screen.getByTestId('startup-recovery')).toBeOnTheScreen();
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

  it('does not replay the animated splash after a completed boot remount', async () => {
    initializeStorage.mockResolvedValue(undefined);

    const firstRender = render(<RootLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
        'adTracking:true;persistence:false;resume:false'
      );
    });

    await finishNativeSplash();

    await waitFor(() => {
      expect(useAppTrackingTransparency).toHaveBeenLastCalledWith({
        enabled: true,
      });
    });
    expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
      'adTracking:true;persistence:true;resume:true'
    );

    firstRender.unmount();
    render(<RootLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
        'adTracking:true;persistence:true;resume:true'
      );
    });
    expect(hideSplash).toHaveBeenCalledTimes(1);
  });
}
