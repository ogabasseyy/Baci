import { randomUUID } from 'node:crypto';

const NOTIFICATION_ID_KEY = 'notification_id';

export function preparePushNotificationPayload(
  data?: Record<string, unknown>
): Record<string, unknown> {
  const notificationId =
    typeof data?.[NOTIFICATION_ID_KEY] === 'string' &&
    data[NOTIFICATION_ID_KEY].length > 0
      ? data[NOTIFICATION_ID_KEY]
      : randomUUID();

  return { ...(data ?? {}), [NOTIFICATION_ID_KEY]: notificationId };
}
