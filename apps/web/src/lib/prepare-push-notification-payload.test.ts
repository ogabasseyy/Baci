import { describe, expect, it } from 'vitest';
import { preparePushNotificationPayload } from './prepare-push-notification-payload';

describe('preparePushNotificationPayload', () => {
  it.each([
    ['undefined payload', undefined],
    ['empty notification id', { notification_id: '' }],
    ['non-string notification id', { notification_id: 42 }],
  ] as const)('generates an id for %s', (_caseName, data) => {
    const payload = preparePushNotificationPayload(data);

    expect(typeof payload.notification_id).toBe('string');
    expect(payload.notification_id).not.toBe('');
  });

  it('preserves a provided notification id for send and open correlation', () => {
    const payload = preparePushNotificationPayload({
      type: 'promotion',
      notification_id: 'campaign-123',
    });

    expect(payload.notification_id).toBe('campaign-123');
  });
});
