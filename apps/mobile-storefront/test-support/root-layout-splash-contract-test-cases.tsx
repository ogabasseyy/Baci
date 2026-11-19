import { expect, it, jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import type React from 'react';
import { registerRootLayoutSplashRemountTests } from './root-layout-splash-remount-test-cases';

interface SplashContractTestContext {
  RootLayout: React.ComponentType;
  authState: { isInitialized: boolean };
  initializeStorage: jest.Mock<() => Promise<void>>;
  hideSplash: jest.Mock<(options: unknown) => Promise<void>>;
  waitForIntro: jest.Mock<() => Promise<boolean>>;
  usePushNotifications: jest.Mock;
  finishNativeSplash: () => Promise<void>;
}

export function registerRootLayoutSplashContractTests({
  RootLayout,
  authState,
  initializeStorage,
  hideSplash,
  waitForIntro,
  usePushNotifications,
  finishNativeSplash,
}: SplashContractTestContext) {
  it('keeps the startup placeholder on the splash background', async () => {
    waitForIntro.mockReturnValue(new Promise<boolean>(() => undefined));
    initializeStorage.mockResolvedValue(undefined);

    render(<RootLayout />);

    await waitFor(() =>
      expect(screen.getByTestId('startup-placeholder')).toHaveStyle({
        backgroundColor: '#20000b',
      })
    );
  });

  it('does not enable push navigation after timeout until auth is initialized', async () => {
    authState.isInitialized = false;
    initializeStorage.mockResolvedValue(undefined);
    const view = render(<RootLayout />);
    act(() => jest.advanceTimersByTime(8000));
    await waitFor(() => expect(hideSplash).toHaveBeenCalledTimes(1));
    await finishNativeSplash();
    await waitFor(() =>
      expect(usePushNotifications).toHaveBeenLastCalledWith({
        navigationReady: false,
      })
    );

    authState.isInitialized = true;
    view.rerender(<RootLayout />);
    await waitFor(() =>
      expect(usePushNotifications).toHaveBeenLastCalledWith({
        navigationReady: true,
      })
    );
  });

  registerRootLayoutSplashRemountTests({
    RootLayout,
    initializeStorage,
    hideSplash,
    finishNativeSplash,
  });
}
