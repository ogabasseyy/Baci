import { describe, expect, it } from 'vitest';
import type { NotificationSendResult, PushDelivery } from './expo-push-types';

describe('expo push types', () => {
  it('describes a send result and a delivery that exposes its Expo client', () => {
    const result: NotificationSendResult = { errors: [], failed: 0, sent: 1 };
    const keys: (keyof PushDelivery)[] = ['getExpo', 'insertAttempt'];

    expect(result.sent).toBe(1);
    expect(keys).toContain('getExpo');
  });
});
