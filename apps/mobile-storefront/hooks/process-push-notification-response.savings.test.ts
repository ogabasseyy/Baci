import { jest } from '@jest/globals';
import type { NotificationResponse } from 'expo-notifications';
import { processPushNotificationResponse } from './process-push-notification-response';

const mockHandle =
  jest.fn<
    typeof import('@/services/push-notifications').handleNotificationResponse
  >();
jest.mock('@/services/push-notifications', () => ({
  handleNotificationResponse: (...args: Parameters<typeof mockHandle>) =>
    mockHandle(...args),
  clearBadge: jest.fn(),
}));
jest.mock('@/services/analytics', () => ({
  trackNotificationInteraction: jest.fn(),
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn() }),
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockHandle.mockReset();
});
afterEach(() => jest.useRealTimers());

it.each([
  'synchronous',
  'asynchronous',
] as const)('retains merchant scope and wallet invalidation through a %s navigation retry', async (failure) => {
  const response: NotificationResponse = {
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: {
      date: 1000,
      request: {
        identifier: `savings-retry-${failure}`,
        trigger: null,
        content: {
          title: null,
          subtitle: null,
          body: null,
          categoryIdentifier: null,
          sound: null,
          data: { type: 'savings' },
        },
      },
    },
  };
  const navigate =
    jest.fn<Parameters<typeof processPushNotificationResponse>[1]>();
  const invalidateSavingsWallet = jest.fn(async () => {});
  const options = { activeMerchantId: 'merchant-1', invalidateSavingsWallet };
  mockHandle
    .mockImplementationOnce(() => {
      if (failure === 'synchronous') throw new Error('navigation unavailable');
      return Promise.reject(new Error('navigation unavailable'));
    })
    .mockImplementationOnce(
      async (
        _response,
        navigateFromResponse,
        _update,
        merchantId,
        invalidate
      ) => {
        if (merchantId !== options.activeMerchantId) return;
        await invalidate?.();
        await navigateFromResponse('wallet', { savingsGoalId: 'goal-1' });
      }
    );

  processPushNotificationResponse(response, navigate, undefined, options);
  await Promise.resolve();
  await Promise.resolve();
  await jest.runOnlyPendingTimersAsync();

  expect(mockHandle).toHaveBeenCalledTimes(2);
  expect(mockHandle).toHaveBeenNthCalledWith(
    1,
    response,
    expect.any(Function),
    undefined,
    'merchant-1',
    invalidateSavingsWallet
  );
  expect(mockHandle).toHaveBeenNthCalledWith(
    2,
    response,
    expect.any(Function),
    undefined,
    'merchant-1',
    invalidateSavingsWallet
  );
  expect(invalidateSavingsWallet).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith(
    'wallet',
    { savingsGoalId: 'goal-1' },
    expect.any(Function)
  );
});
