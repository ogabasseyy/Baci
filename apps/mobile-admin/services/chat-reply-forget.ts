import type { NotificationResponse } from 'expo-notifications';

/**
 * Drops the device's "last notification response" once a chat reply has been
 * dealt with. The app reads it on every start, so without this a later start
 * would handle the same reply again and repeat its warning. Only when that last
 * response is still this reply: a newer tap is left alone.
 */
export async function forgetChatReplyResponse(
  response: NotificationResponse
): Promise<void> {
  try {
    // Loaded on demand, like the rest of the push code: importing the native
    // module while the app's modules are evaluated can crash it.
    const notifications = await import('expo-notifications');
    const last = notifications.getLastNotificationResponse();
    if (
      last?.actionIdentifier === response.actionIdentifier &&
      last.notification.request.identifier ===
        response.notification.request.identifier &&
      last.userText === response.userText
    ) {
      notifications.clearLastNotificationResponse();
    }
  } catch {
    // Best effort: the stored claim still stops it being sent twice.
  }
}
