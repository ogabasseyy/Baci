import type { jest } from '@jest/globals';
import { expect, it } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import type React from 'react';

interface AuthState {
  merchantId: string | null;
  user: { id: string } | null;
}

interface AttTestDependencies {
  RootLayout: React.ComponentType;
  authState: AuthState;
  cleanupAuth: jest.Mock;
  initializeStorage: jest.Mock<() => Promise<void>>;
  initializeAdTrackingForStartup: jest.Mock<() => Promise<void>>;
  registerPushNotifications: jest.Mock;
  activateDueSavingsReminderNotification: jest.Mock;
  useAppTrackingTransparency: jest.Mock;
  setTrackingAuthorizationSettled: (settled: boolean) => void;
  finishNativeSplash: () => Promise<void>;
}

export function registerRootLayoutAttTests({
  RootLayout,
  authState,
  cleanupAuth,
  initializeStorage,
  initializeAdTrackingForStartup,
  registerPushNotifications,
  activateDueSavingsReminderNotification,
  useAppTrackingTransparency,
  setTrackingAuthorizationSettled,
  finishNativeSplash,
}: AttTestDependencies) {
  it('keeps the global auth subscription alive when the root view unmounts', async () => {
    initializeStorage.mockResolvedValue(undefined);

    const { unmount } = render(<RootLayout />);

    await waitFor(() => expect(initializeStorage).toHaveBeenCalledTimes(1));

    unmount();

    expect(cleanupAuth).not.toHaveBeenCalled();
  });

  it('keeps route navigation mounted while startup ad tracking finishes', async () => {
    let resolveAdTrackingStartup!: () => void;
    initializeStorage.mockResolvedValue(undefined);
    initializeAdTrackingForStartup.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveAdTrackingStartup = resolve;
      })
    );

    render(<RootLayout />);

    await waitFor(() => {
      expect(initializeAdTrackingForStartup).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
      'adTracking:false;persistence:false;resume:false'
    );

    await act(async () => resolveAdTrackingStartup());

    await waitFor(() => {
      expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
        'adTracking:true;persistence:false;resume:false'
      );
    });
  });

  it('waits for ATT settlement before starting ad tracking', async () => {
    initializeStorage.mockResolvedValue(undefined);
    setTrackingAuthorizationSettled(false);
    const view = render(<RootLayout />);

    await waitFor(() => {
      expect(initializeStorage).toHaveBeenCalledTimes(1);
    });
    await finishNativeSplash();
    await waitFor(() => {
      expect(useAppTrackingTransparency).toHaveBeenLastCalledWith({
        enabled: true,
      });
    });
    expect(initializeAdTrackingForStartup).not.toHaveBeenCalled();

    setTrackingAuthorizationSettled(true);
    view.rerender(<RootLayout />);

    await waitFor(() => {
      expect(initializeAdTrackingForStartup).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        screen.getByRole('text', { name: 'Store navigation' })
      ).toBeOnTheScreen();
    });
  });

  it('enables the root ATT coordinator only after the startup splash finishes', async () => {
    initializeStorage.mockResolvedValue(undefined);
    render(<RootLayout />);

    await waitFor(() => {
      expect(initializeStorage).toHaveBeenCalledTimes(1);
    });
    expect(useAppTrackingTransparency).toHaveBeenLastCalledWith({
      enabled: false,
    });

    await finishNativeSplash();

    await waitFor(() => {
      expect(useAppTrackingTransparency).toHaveBeenLastCalledWith({
        enabled: true,
      });
    });
  });

  it('waits for ATT to settle before starting push registration', async () => {
    initializeStorage.mockResolvedValue(undefined);
    setTrackingAuthorizationSettled(false);
    authState.user = { id: 'review-user' };
    authState.merchantId = 'merchant-id';
    const view = render(<RootLayout />);

    await waitFor(() => {
      expect(initializeStorage).toHaveBeenCalledTimes(1);
    });
    await finishNativeSplash();
    await waitFor(() => {
      expect(useAppTrackingTransparency).toHaveBeenLastCalledWith({
        enabled: true,
      });
    });
    expect(registerPushNotifications).not.toHaveBeenCalled();

    setTrackingAuthorizationSettled(true);
    view.rerender(<RootLayout />);

    await waitFor(() => {
      expect(registerPushNotifications).toHaveBeenCalledWith(
        'review-user',
        'merchant-id'
      );
    });
  });

  it('waits for ATT to settle before activating a due savings reminder', async () => {
    initializeStorage.mockResolvedValue(undefined);
    setTrackingAuthorizationSettled(false);
    // Reminder activation requires a signed-in user (boot auth gate); set
    // one so this case exercises ATT gating rather than the user gate.
    authState.user = { id: 'review-user' };
    const view = render(<RootLayout />);

    await waitFor(() => {
      expect(initializeStorage).toHaveBeenCalledTimes(1);
    });
    expect(activateDueSavingsReminderNotification).not.toHaveBeenCalled();

    setTrackingAuthorizationSettled(true);
    view.rerender(<RootLayout />);

    await waitFor(() => {
      expect(activateDueSavingsReminderNotification).toHaveBeenCalledTimes(1);
    });
  });
}
