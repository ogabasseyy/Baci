import type * as NotificationsType from 'expo-notifications';
import { registerChatReplyCategory } from './chat-notification-reply';
import { setupAndroidChannels } from './push-notification-channels';

/**
 * Everything a chat notification needs on the device, every launch: its Reply
 * box and, on Android, the channels (the server sends chat pushes to
 * `messages`, which an install that already had a token would otherwise lack).
 * One step failing never blocks the other.
 */
export async function prepareChatNotifications(
  notifications: typeof NotificationsType,
  options: { android: boolean }
): Promise<void> {
  const steps = [registerChatReplyCategory(notifications)];
  if (options.android) steps.push(setupAndroidChannels(notifications));
  const results = await Promise.allSettled(steps);
  for (const result of results) {
    if (result.status === 'rejected' && __DEV__) {
      console.debug(
        '[Push] Chat notification setup step failed:',
        result.reason
      );
    }
  }
}
