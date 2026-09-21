import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { AppState } from 'react-native';
import {
  mockAuthStoreModule,
  mockColorSchemeModule,
  mockExpoRouterModule,
  mockMaybeShowPostOrderInterstitial,
  mockOrderSuccessView,
  mockOrderSuccessViewModule,
  mockPermissionBoosterModule,
  mockPostOrderInterstitialModule,
  mockPushNotificationsModule,
  mockReceiptDismissalHolder,
  mockReceiptPreviewModalModule,
  mockReceiptPreviewModule,
  mockReceiptState,
  mockRequestPermission,
  mockTriggerSystemPrompt,
  setupOrderSuccessMocks,
} from './order-success.test-utils';

jest.mock('expo-router', () => mockExpoRouterModule());
jest.mock('@/components/orders/OrderSuccessView', () =>
  mockOrderSuccessViewModule()
);
jest.mock('@/components/receipts/ReceiptPreviewModal', () =>
  mockReceiptPreviewModalModule()
);
jest.mock('@/components/useColorScheme', () => mockColorSchemeModule());
jest.mock('@/hooks/use-permission-booster', () =>
  mockPermissionBoosterModule()
);
jest.mock('@/hooks/use-receipt-preview', () => mockReceiptPreviewModule());
jest.mock('@/stores/auth-store', () => mockAuthStoreModule());
jest.mock('@/services/push-notifications', () => mockPushNotificationsModule());
jest.mock('@/lib/post-order-interstitial', () =>
  mockPostOrderInterstitialModule()
);

import OrderSuccessScreen from '@/app/order-success';

describe('OrderSuccessScreen interstitial', () => {
  beforeEach(() => {
    setupOrderSuccessMocks();
  });

  it('cancels the post-order interstitial while the app is backgrounded', async () => {
    // Regression: a LOADED event firing after backgrounding would present
    // the purchase ad on resume, outside the post-order moment.
    jest.useFakeTimers();
    try {
      render(<OrderSuccessScreen />);
      // Flush the permission lookup too: until it resolves the permission
      // flow flag stays set and would mask the AppState assertion below.
      await act(async () => {
        jest.advanceTimersByTime(2600);
      });

      expect(mockMaybeShowPostOrderInterstitial).toHaveBeenCalledTimes(1);
      const isCancelled =
        mockMaybeShowPostOrderInterstitial.mock.calls[0]?.[0]?.isCancelled;
      expect(isCancelled).toBeDefined();
      AppState.currentState = 'active';
      expect(isCancelled?.()).toBe(false);
      AppState.currentState = 'background';
      expect(isCancelled?.()).toBe(true);
      AppState.currentState = 'active';
    } finally {
      jest.useRealTimers();
    }
  });

  it('withholds the banner until the native permission prompt resolves', async () => {
    // Regression: clearing the soft-ask modal on grant must not remount
    // the banner underneath the native system prompt still in flight.
    mockRequestPermission.mockResolvedValueOnce('soft-ask-needed');
    let resolvePrompt!: () => void;
    mockTriggerSystemPrompt.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolvePrompt = resolve;
      })
    );
    const latestProps = () =>
      mockOrderSuccessView.mock.calls.at(-1)?.[0] as
        | {
            isPermissionFlowActive?: boolean;
            onPermissionGrant: () => void;
            showPermissionModal?: boolean;
          }
        | undefined;

    jest.useFakeTimers();
    try {
      render(<OrderSuccessScreen />);
      await act(async () => {
        jest.advanceTimersByTime(1600);
      });

      expect(latestProps()?.showPermissionModal).toBe(true);
      expect(latestProps()?.isPermissionFlowActive).toBe(true);

      act(() => {
        void latestProps()?.onPermissionGrant();
      });
      expect(latestProps()?.showPermissionModal).toBe(false);
      expect(latestProps()?.isPermissionFlowActive).toBe(true);

      await act(async () => {
        resolvePrompt();
      });
      expect(latestProps()?.isPermissionFlowActive).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('holds receipt ownership until the sheet dismissal completes', async () => {
    // Regression: closePreview clears the open state synchronously while
    // the iOS slide dismissal still covers the screen — a late LOADED event
    // must not present over the departing sheet and the banner must not
    // remount underneath it.
    const latestProps = () =>
      mockOrderSuccessView.mock.calls.at(-1)?.[0] as
        | { isReceiptPreviewActive?: boolean }
        | undefined;

    jest.useFakeTimers();
    try {
      mockReceiptState.isOpen = true;
      const { rerender } = render(<OrderSuccessScreen />);
      await act(async () => {
        jest.advanceTimersByTime(2600);
      });

      expect(mockMaybeShowPostOrderInterstitial).toHaveBeenCalledTimes(1);
      const isCancelled =
        mockMaybeShowPostOrderInterstitial.mock.calls[0]?.[0]?.isCancelled;
      expect(isCancelled?.()).toBe(true);
      expect(latestProps()?.isReceiptPreviewActive).toBe(true);

      mockReceiptState.isOpen = false;
      rerender(<OrderSuccessScreen />);
      expect(isCancelled?.()).toBe(true);
      expect(latestProps()?.isReceiptPreviewActive).toBe(true);

      await act(async () => {
        mockReceiptDismissalHolder.current?.();
      });
      expect(isCancelled?.()).toBe(false);
      expect(latestProps()?.isReceiptPreviewActive).toBe(false);
    } finally {
      jest.useRealTimers();
      mockReceiptState.isOpen = false;
      mockReceiptState.isLoading = false;
    }
  });

  it('withholds the banner while the interstitial is presenting but unresolved', async () => {
    // Regression: show() resolves over a native bridge round-trip after
    // presentation begins; the banner must be withheld synchronously via
    // onPresenting rather than after the helper promise resolves.
    let resolveInterstitial!: (outcome: 'shown' | 'skipped') => void;
    mockMaybeShowPostOrderInterstitial.mockReturnValueOnce(
      new Promise<'shown' | 'skipped'>((resolve) => {
        resolveInterstitial = resolve;
      })
    );
    const latestProps = () =>
      mockOrderSuccessView.mock.calls.at(-1)?.[0] as
        | { isFullscreenAdActive?: boolean }
        | undefined;

    jest.useFakeTimers();
    try {
      render(<OrderSuccessScreen />);
      await act(async () => {
        jest.advanceTimersByTime(2600);
      });

      expect(mockMaybeShowPostOrderInterstitial).toHaveBeenCalledTimes(1);
      const options = mockMaybeShowPostOrderInterstitial.mock.calls[0]?.[0];
      expect(typeof options?.onPresenting).toBe('function');
      expect(latestProps()?.isFullscreenAdActive).toBe(false);

      // Presentation begins while the helper promise stays pending.
      act(() => {
        options?.onPresenting?.();
      });
      expect(latestProps()?.isFullscreenAdActive).toBe(true);

      await act(async () => {
        resolveInterstitial('shown');
      });
      expect(latestProps()?.isFullscreenAdActive).toBe(true);

      act(() => {
        options?.onClosed?.();
      });
      expect(latestProps()?.isFullscreenAdActive).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
