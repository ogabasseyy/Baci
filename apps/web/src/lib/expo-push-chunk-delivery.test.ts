import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendPushNotificationsAsync = vi.fn();
const chunkPushNotifications = vi.fn((messages: unknown[]) => [messages]);

vi.mock('expo-server-sdk', () => {
  class MockExpo {
    sendPushNotificationsAsync = sendPushNotificationsAsync;
    chunkPushNotifications = chunkPushNotifications;

    static isExpoPushToken(token: unknown): boolean {
      return (
        typeof token === 'string' && token.startsWith('ExponentPushToken[')
      );
    }
  }

  return { default: MockExpo, Expo: MockExpo };
});

import Expo, { type ExpoPushMessage } from 'expo-server-sdk';
import { sendPushNotificationChunks } from './expo-push-chunk-delivery';

describe('sendPushNotificationChunks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps invalid token tickets aligned with the original message order', async () => {
    sendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'ok', id: 'accepted' },
    ]);
    const messages = [
      { to: 'invalid-token', body: 'invalid' },
      { to: 'ExponentPushToken[valid]', body: 'valid' },
    ] as ExpoPushMessage[];

    const delivery = await sendPushNotificationChunks(new Expo(), messages);

    expect(delivery.tickets).toEqual([
      expect.objectContaining({ status: 'error' }),
      { status: 'ok', id: 'accepted' },
    ]);
    // Locally rejected tokens never reached the provider.
    expect(delivery.deliveryUncertain).toBe(false);
  });

  it('marks the delivery uncertain when a provider request throws', async () => {
    sendPushNotificationsAsync.mockRejectedValueOnce(
      new Error('socket hangup')
    );

    const delivery = await sendPushNotificationChunks(new Expo(), [
      { to: 'ExponentPushToken[valid]', body: 'valid' },
    ] as ExpoPushMessage[]);

    expect(delivery.tickets).toEqual([
      expect.objectContaining({
        details: { error: 'ExpoError' },
        status: 'error',
      }),
    ]);
    expect(delivery.deliveryUncertain).toBe(true);
    expect(delivery.syntheticTicketIndexes).toEqual(new Set([0]));
  });

  it('marks a definitive provider rejection as certain', async () => {
    // Expo's own `ExpoError` ticket is a definitive rejection: the
    // public error code must never be inferred as uncertain.
    sendPushNotificationsAsync.mockResolvedValueOnce([
      { details: { error: 'ExpoError' }, status: 'error' },
    ]);

    const delivery = await sendPushNotificationChunks(new Expo(), [
      { to: 'ExponentPushToken[valid]', body: 'valid' },
    ] as ExpoPushMessage[]);

    expect(delivery.deliveryUncertain).toBe(false);
    expect(delivery.syntheticTicketIndexes).toEqual(new Set());
  });

  it('marks only the synthetic ticket when a real ExpoError shares an uncertain batch', async () => {
    chunkPushNotifications.mockImplementationOnce((messages: unknown[]) => [
      [messages[0]],
      [messages[1]],
    ]);
    sendPushNotificationsAsync
      .mockResolvedValueOnce([
        { details: { error: 'ExpoError' }, status: 'error' },
      ])
      .mockRejectedValueOnce(new Error('socket hangup'));

    const delivery = await sendPushNotificationChunks(new Expo(), [
      { to: 'ExponentPushToken[one]', body: 'one' },
      { to: 'ExponentPushToken[two]', body: 'two' },
    ] as ExpoPushMessage[]);

    expect(delivery.deliveryUncertain).toBe(true);
    // Index 0 is Expo's own definitive ticket; only index 1 was
    // synthesized after the throw — same public code, different truth.
    expect(delivery.syntheticTicketIndexes).toEqual(new Set([1]));
  });

  it('calls the rejection boundary only after definitive error tickets', async () => {
    sendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'error', message: 'MessageRateExceeded' },
    ]);
    const onDeliveryRejected = vi.fn();

    await sendPushNotificationChunks(
      new Expo(),
      [{ to: 'ExponentPushToken[valid]', body: 'valid' }],
      { onDeliveryRejected }
    );

    expect(onDeliveryRejected).toHaveBeenCalledOnce();
  });
});
