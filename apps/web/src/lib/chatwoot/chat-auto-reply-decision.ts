import type { ChatWebhookMessageCreated } from '@/schemas/chat-webhook';

export type ChatAutoReplyDecision =
  | { action: 'reply' }
  | {
      action: 'handover';
      reason: 'customer_requested_human' | 'customer_sent_attachment';
    }
  | { action: 'skip'; reason: 'not_pending' | 'empty' };

const HUMAN_REQUEST_PATTERNS = [
  /\b(talk|speak|chat|connect|transfer|put me)\b.{0,30}\b(human|person|agent|representative|someone|staff|manager|operator)\b/i,
  /\b(real|live) (person|human|agent)\b/i,
  /\b(human|agent|representative|operator) (please|pls)\b/i,
  /\bcustomer (care|service|support)\b/i,
  /\bnot (a )?(bot|robot)\b/i,
  /\bnot (talking|speaking|chatting) (to|with) (a )?(bot|robot)\b/i,
];

/** True when the customer is asking for a person rather than the assistant. */
export function asksForHuman(text: string): boolean {
  return HUMAN_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Whether the assistant should answer a customer message. The provider's
 * conversation status is the switch: only a `pending` conversation belongs to
 * the assistant, and a person's reply moves it to `open`, so the assistant
 * never talks over staff.
 */
export function decideChatAutoReply(
  event: Pick<
    ChatWebhookMessageCreated,
    'content' | 'conversation' | 'attachments'
  >,
  { semanticHandoff = false }: { semanticHandoff?: boolean } = {}
): ChatAutoReplyDecision {
  if (event.conversation.status !== 'pending') {
    return { action: 'skip', reason: 'not_pending' };
  }
  const text = (event.content ?? '').trim();
  // A picture or voice note (captioned or not) carries something the
  // assistant cannot read: a person must look at it, or the customer would
  // get an answer about the wrong thing, or wait with nobody queued.
  if (event.attachments?.length) {
    return { action: 'handover', reason: 'customer_sent_attachment' };
  }
  if (!text) return { action: 'skip', reason: 'empty' };
  if (!semanticHandoff && asksForHuman(text)) {
    return { action: 'handover', reason: 'customer_requested_human' };
  }
  return { action: 'reply' };
}

/** A visible reply written by staff (not the assistant, not a private note). */
export function isMerchantReply(
  event: Pick<
    ChatWebhookMessageCreated,
    | 'message_type'
    | 'private'
    | 'sender'
    | 'content_attributes'
    | 'additional_attributes'
  >
): boolean {
  // Automation rules and campaigns send as a user too; like the provider's
  // own "human response" check, they are not a person taking over.
  const automated =
    event.content_attributes?.automation_rule_id != null ||
    event.additional_attributes?.campaign_id != null;
  return (
    event.message_type === 'outgoing' &&
    event.private !== true &&
    event.sender?.type === 'user' &&
    !automated
  );
}
