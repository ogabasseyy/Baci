/**
 * The notification category and action that put a "Reply" box on a customer
 * chat push. The server names the category on the push; the app registers it
 * and recognises the action. Both import these so they can never drift apart.
 */
export const CHAT_REPLY_NOTIFICATION_CATEGORY = 'chat_reply';
/** Chat-specific, so a future second reply-style action can never collide. */
export const CHAT_REPLY_ACTION_ID = 'chat_reply_send';
