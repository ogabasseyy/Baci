/**
 * The notification category and action that put a "Reply" box on a customer
 * chat push. The server names the category on the push; the app registers it
 * and recognises the action. Both import these so they can never drift apart.
 */
export const CHAT_REPLY_NOTIFICATION_CATEGORY = 'chat_reply';
export const CHAT_REPLY_ACTION_ID = 'reply';
