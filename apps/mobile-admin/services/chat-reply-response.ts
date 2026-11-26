import { CHAT_REPLY_ACTION_ID } from '@baci/shared';
import type { NotificationResponse } from 'expo-notifications';

/** True when the shop owner used the Reply box (not a plain tap). */
export function isChatReplyResponse(response: NotificationResponse): boolean {
  return response.actionIdentifier === CHAT_REPLY_ACTION_ID;
}
