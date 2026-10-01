import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

type NotificationResponse = import('expo-notifications').NotificationResponse;

const mockClearBadge = jest.fn();
const mockHandleNotificationResponse =
  jest.fn<
    typeof import('@/services/push-notifications')['handleNotificationResponse']
  >();
const mockTrackNotificationInteraction = jest.fn();
const mockWarn = jest.fn();

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: mockWarn }),
}));

jest.mock('@/services/analytics', () => ({
  trackNotificationInteraction: mockTrackNotificationInteraction,
}));

jest.mock('@/services/push-notifications', () => ({
  clearBadge: mockClearBadge,
  handleNotificationResponse: mockHandleNotificationResponse,
}));

const { processPushNotificationResponse } =
  require('./process-push-notification-response') as typeof import('./process-push-notification-response');

type ProcessedNotificationResponse = Parameters<
  typeof processPushNotificationResponse
>[0];
type Navigate = Parameters<typeof processPushNotificationResponse>[1];

const createResponse = (
  identifier: string,
  data: Record<string, unknown>,
  date = 1000
): ProcessedNotificationResponse =>
  ({
    notification: {
      date,
      request: {
        identifier,
        content: { data },
      },
    },
  }) as NotificationResponse;

describe('processPushNotificationResponse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClearBadge.mockReset();
    mockHandleNotificationResponse.mockReset();
    mockTrackNotificationInteraction.mockReset();
    mockWarn.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('deduplicates by delivery identifier while retaining payload attribution', () => {
    const navigate = jest.fn<Navigate>();
    const response = createResponse('utility-delivery-1', {
      notification_id: 'utility-campaign-1',
      notification_type: 'promotion',
    });

    processPushNotificationResponse(response, navigate);
    processPushNotificationResponse(response, navigate);

    expect(mockTrackNotificationInteraction).toHaveBeenCalledTimes(1);
    expect(mockTrackNotificationInteraction).toHaveBeenCalledWith(
      'opened',
      'promotion',
      'utility-campaign-1'
    );
    expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(1);
    expect(mockClearBadge).toHaveBeenCalledTimes(1);
  });

  it('processes separate occurrences that reuse a recurring request identifier', () => {
    const navigate = jest.fn<Navigate>();
    const firstOccurrence = createResponse(
      'utility-recurring',
      { notification_type: 'savings_reminder' },
      2000
    );
    const secondOccurrence = createResponse(
      'utility-recurring',
      { notification_type: 'savings_reminder' },
      3000
    );

    processPushNotificationResponse(firstOccurrence, navigate);
    processPushNotificationResponse(secondOccurrence, navigate);

    expect(mockTrackNotificationInteraction).toHaveBeenCalledTimes(2);
    expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(2);
    expect(mockClearBadge).toHaveBeenCalledTimes(2);
  });

  it('retries user-facing handling after a navigation error', () => {
    jest.useFakeTimers();
    const navigate = jest.fn<Navigate>();
    const onHandled = jest.fn();
    mockHandleNotificationResponse.mockImplementation(
      (
        _response: NotificationResponse,
        navigateFromResponse: (
          screen: string,
          params?: Record<string, string>
        ) => void
      ) => {
        navigateFromResponse('wallet');
      }
    );
    navigate.mockImplementationOnce(() => {
      throw new Error('navigator is not ready');
    });
    const response = createResponse('utility-navigation-failure', {
      notification_type: 'promotion',
    });

    expect(() =>
      processPushNotificationResponse(response, navigate, onHandled)
    ).not.toThrow();
    expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(1);
    expect(mockClearBadge).not.toHaveBeenCalled();
    expect(onHandled).not.toHaveBeenCalled();

    jest.runOnlyPendingTimers();

    expect(mockTrackNotificationInteraction).toHaveBeenCalledTimes(1);
    expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(2);
    expect(mockClearBadge).toHaveBeenCalledTimes(1);
    expect(onHandled).toHaveBeenCalledTimes(1);
  });

  it('waits for async wallet navigation before finalizing and retries rejection', async () => {
    jest.useFakeTimers();
    const navigate = jest.fn<Navigate>();
    const onHandled = jest.fn();
    mockHandleNotificationResponse
      .mockImplementationOnce(() =>
        Promise.reject(new Error('navigator is not ready'))
      )
      .mockImplementationOnce(() => Promise.resolve());
    const response = createResponse('utility-wallet-async-failure', {
      notification_type: 'wallet_credited',
    });

    processPushNotificationResponse(response, navigate, onHandled);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockClearBadge).not.toHaveBeenCalled();
    expect(onHandled).not.toHaveBeenCalled();

    await jest.runOnlyPendingTimersAsync();

    expect(mockTrackNotificationInteraction).toHaveBeenCalledTimes(1);
    expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(2);
    expect(mockClearBadge).toHaveBeenCalledTimes(1);
    expect(onHandled).toHaveBeenCalledTimes(1);
  });

  it('continues response handling when analytics tracking throws', () => {
    mockTrackNotificationInteraction.mockImplementation(() => {
      throw new Error('analytics unavailable');
    });
    const navigate = jest.fn<Navigate>();
    const response = createResponse('utility-analytics-failure', {
      notification_type: 'promotion',
    });

    expect(() =>
      processPushNotificationResponse(response, navigate)
    ).not.toThrow();

    expect(mockHandleNotificationResponse).toHaveBeenCalledWith(
      response,
      expect.any(Function)
    );
    expect(mockClearBadge).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  it('ignores an older pending response duplicated after a newer tap succeeds', () => {
    jest.useFakeTimers();
    const navigate = jest.fn<Navigate>();
    const onHandled = jest.fn();
    mockHandleNotificationResponse.mockImplementationOnce(() => {
      throw new Error('navigator is not ready');
    });
    const firstResponse = createResponse(
      'utility-response-a',
      { notification_type: 'promotion' },
      4000
    );
    const secondResponse = createResponse(
      'utility-response-b',
      { notification_type: 'promotion' },
      5000
    );

    processPushNotificationResponse(firstResponse, navigate, onHandled);
    processPushNotificationResponse(secondResponse, navigate, onHandled);
    processPushNotificationResponse(firstResponse, navigate, onHandled);
    jest.runOnlyPendingTimers();

    expect(onHandled).toHaveBeenCalledTimes(1);
    expect(onHandled).toHaveBeenCalledWith(secondResponse);
    expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(2);
  });

  it('ignores a handled duplicate without cancelling a newer pending tap', () => {
    jest.useFakeTimers();
    const navigate = jest.fn<Navigate>();
    const firstResponse = createResponse(
      'utility-handled-a',
      { notification_type: 'promotion' },
      6000
    );
    const secondResponse = createResponse(
      'utility-pending-b',
      { notification_type: 'promotion' },
      7000
    );
    mockHandleNotificationResponse
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('navigator is not ready');
      })
      .mockImplementationOnce(() => undefined);

    processPushNotificationResponse(firstResponse, navigate);
    processPushNotificationResponse(secondResponse, navigate);
    processPushNotificationResponse(firstResponse, navigate);
    jest.runOnlyPendingTimers();

    expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(3);
    expect(mockClearBadge).toHaveBeenCalledTimes(2);
  });

  it('does not retry when finalization itself throws', () => {
    const navigate = jest.fn<Navigate>();
    const onHandled = jest.fn(() => {
      throw new Error('native response clear failed');
    });
    const response = createResponse('utility-finalization-failure', {
      notification_type: 'promotion',
    });

    expect(() =>
      processPushNotificationResponse(response, navigate, onHandled)
    ).not.toThrow();
    expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(1);
    expect(mockClearBadge).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  it('retries only native finalization when clearing the cold-start response fails', () => {
    jest.useFakeTimers();
    const navigate = jest.fn<Navigate>();
    const onHandled = jest
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const response = createResponse('utility-native-clear-failure', {
      notification_type: 'promotion',
    });

    processPushNotificationResponse(response, navigate, onHandled);

    expect(onHandled).toHaveBeenCalledTimes(1);
    expect(mockTrackNotificationInteraction).toHaveBeenCalledTimes(1);
    expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(1);
    expect(mockClearBadge).toHaveBeenCalledTimes(1);

    jest.runOnlyPendingTimers();

    expect(onHandled).toHaveBeenCalledTimes(2);
    expect(mockTrackNotificationInteraction).toHaveBeenCalledTimes(1);
    expect(mockHandleNotificationResponse).toHaveBeenCalledTimes(1);
    expect(mockClearBadge).toHaveBeenCalledTimes(1);
  });
});
