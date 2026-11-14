import { expect, it, jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import type React from 'react';
import { AppState } from 'react-native';
import {
  getCrashBreadcrumbsForTest,
  resetCrashDiagnosticsForTest,
} from '@/lib/crash-diagnostics';

interface AuthState {
  isInitialized: boolean;
  user: { id: string } | null;
}

type ActivateDueSavingsReminder =
  typeof import('@/services/savings-reminder-notifications').activateDueSavingsReminderNotification;

interface ReminderTestContext {
  RootLayout: React.ComponentType;
  authState: AuthState;
  initializeStorage: jest.Mock<() => Promise<void>>;
  activateDueSavingsReminderNotification: jest.MockedFunction<ActivateDueSavingsReminder>;
}

function mockAppStateListener() {
  const original = AppState.addEventListener;
  const addEventListener = jest.fn(
    (_event: string, _handler: (state: string) => void) => ({
      remove: jest.fn(),
    })
  );
  Object.defineProperty(AppState, 'addEventListener', {
    configurable: true,
    value: addEventListener,
  });
  return {
    addEventListener,
    restoreAppState: () => {
      Object.defineProperty(AppState, 'addEventListener', {
        configurable: true,
        value: original,
      });
    },
  };
}

function latestChangeHandler(
  addEventListener: ReturnType<typeof mockAppStateListener>['addEventListener']
) {
  const handlers = addEventListener.mock.calls
    .filter(([event]) => event === 'change')
    .map(([, handler]) => handler);
  expect(handlers.length).toBeGreaterThan(0);
  return handlers[handlers.length - 1];
}

export function registerRootLayoutReminderTests({
  RootLayout,
  authState,
  initializeStorage,
  activateDueSavingsReminderNotification,
}: ReminderTestContext) {
  it('activates due savings reminders when the app foregrounds', async () => {
    authState.user = { id: 'customer-1' };
    initializeStorage.mockResolvedValue(undefined);
    const { addEventListener, restoreAppState } = mockAppStateListener();

    try {
      render(<RootLayout />);
      await waitFor(() => {
        expect(screen.getByTestId('root-layout-nav')).toBeOnTheScreen();
      });

      const onChange = latestChangeHandler(addEventListener);
      const before = activateDueSavingsReminderNotification.mock.calls.length;
      act(() => onChange('active'));
      expect(activateDueSavingsReminderNotification).toHaveBeenCalledTimes(
        before + 1
      );
      act(() => onChange('background'));
      expect(activateDueSavingsReminderNotification).toHaveBeenCalledTimes(
        before + 1
      );
    } finally {
      restoreAppState();
    }
  });

  it('skips foreground reminder activation while logged out', async () => {
    authState.user = null;
    initializeStorage.mockResolvedValue(undefined);
    const { addEventListener, restoreAppState } = mockAppStateListener();

    try {
      render(<RootLayout />);
      await waitFor(() => expect(addEventListener).toHaveBeenCalled());

      activateDueSavingsReminderNotification.mockClear();
      act(() => latestChangeHandler(addEventListener)('active'));
      expect(activateDueSavingsReminderNotification).not.toHaveBeenCalled();
    } finally {
      restoreAppState();
    }
  });

  it('records a breadcrumb instead of throwing when foreground activation rejects', async () => {
    authState.user = { id: 'customer-1' };
    initializeStorage.mockResolvedValue(undefined);
    const { addEventListener, restoreAppState } = mockAppStateListener();

    try {
      render(<RootLayout />);
      await waitFor(() => {
        expect(screen.getByTestId('root-layout-nav')).toBeOnTheScreen();
      });

      // Boot activation already fired; reject the foreground call specifically.
      activateDueSavingsReminderNotification.mockClear();
      activateDueSavingsReminderNotification.mockRejectedValueOnce(
        new Error('storage unavailable')
      );
      resetCrashDiagnosticsForTest();
      await act(async () => {
        latestChangeHandler(addEventListener)('active');
        await Promise.resolve();
      });

      expect(
        getCrashBreadcrumbsForTest().filter(
          (crumb) =>
            crumb.name === 'root_layout:savings_reminder_activation_failed'
        )
      ).toHaveLength(1);
    } finally {
      restoreAppState();
    }
  });

  it('skips foreground reminder activation before boot is ready', async () => {
    authState.user = { id: 'customer-1' };
    authState.isInitialized = false;
    initializeStorage.mockResolvedValue(undefined);
    const { addEventListener, restoreAppState } = mockAppStateListener();

    try {
      render(<RootLayout />);
      await waitFor(() => expect(addEventListener).toHaveBeenCalled());

      activateDueSavingsReminderNotification.mockClear();
      act(() => latestChangeHandler(addEventListener)('active'));
      expect(activateDueSavingsReminderNotification).not.toHaveBeenCalled();
    } finally {
      restoreAppState();
    }
  });
}
