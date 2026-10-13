import { createLogger } from '@/lib/logger';

type NotificationsModule = {
  clearLastNotificationResponse: () => void;
} | null;

const log = createLogger('ClearLastNotificationResponse');

export function clearLastNotificationResponse(
  notifications: NotificationsModule
): boolean {
  if (!notifications) return false;
  try {
    notifications.clearLastNotificationResponse();
    return true;
  } catch (error) {
    log.warn('Failed to clear last notification response:', error);
    return false;
  }
}
