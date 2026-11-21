import 'server-only';

import type { ChatEventIntakeOutcome } from '@/schemas/chat-webhook';
import { sendChatEventPush } from './chat-event-push';
import {
  type ChatHandoverEvent,
  recordChatHandover,
} from './chat-handover-intake';

export type ChatHandoverAlertOutcome = ChatEventIntakeOutcome | 'failed';

/**
 * Alerts the store that the assistant handed a chat to a person: a bell
 * notification recorded by the database, then a push to the merchant-app
 * devices for a newly recorded alert. The merchant's level decides inside the
 * database, so a handover alerts at "all" and "handover only" and stays
 * silent only when the merchant turned chat alerts off. Best effort and
 * never throws: the chat has already been handed over, so a failure here
 * must not undo or block that.
 */
export async function alertMerchantOfHandover(
  event: ChatHandoverEvent
): Promise<ChatHandoverAlertOutcome> {
  try {
    const recorded = await recordChatHandover(event);
    if (!recorded.ok) {
      // Logged without customer text or secrets, so a broken alert path is
      // visible even though the handover itself went through.
      console.warn('Chat handover alert was not recorded', {
        eventKey: event.eventKey,
        merchantId: event.merchantId,
        code: recorded.code,
      });
      return 'failed';
    }
    if (recorded.outcome === 'notified' && !recorded.duplicate) {
      // The push has its own switch and claim; its failure never changes the
      // recorded alert, but it is logged (no customer text) like a message push.
      const push = await sendChatEventPush({
        ...event,
        preview: '',
        kind: 'handover',
      }).catch(() => ({ status: 'failed' as const }));
      if (
        push.status === 'failed' ||
        push.status === 'partial' ||
        (push.status === 'skipped' && push.reason === 'not_configured')
      ) {
        console.warn('Chat handover push was not sent', {
          eventKey: event.eventKey,
          merchantId: event.merchantId,
          status: push.status,
        });
      }
    }
    return recorded.outcome;
  } catch {
    return 'failed';
  }
}
