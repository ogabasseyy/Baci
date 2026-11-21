import { after, type NextRequest, NextResponse } from 'next/server';
import {
  CHAT_EVENT_NAME_MAX_LENGTH,
  CHAT_EVENT_PREVIEW_MAX_LENGTH,
  normalizeChatEventText,
  recordChatCustomerMessage,
} from '@/lib/chatwoot/chat-event-intake';
import { sendChatEventPush } from '@/lib/chatwoot/chat-event-push';
import { readChatWebhookBody } from '@/lib/chatwoot/chat-webhook-body';
import { getChatWebhookBinding } from '@/lib/chatwoot/chat-webhook-config';
import { verifyChatWebhookSignature } from '@/lib/chatwoot/chat-webhook-signature';
import {
  chatWebhookEnvelopeSchema,
  chatWebhookMessageCreatedSchema,
} from '@/schemas/chat-webhook';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

type ChatEvent = Parameters<typeof sendChatEventPush>[0];

async function pushChatMessage(chatEvent: ChatEvent) {
  let pushStatus = 'failed';
  try {
    const push = await sendChatEventPush(chatEvent);
    pushStatus =
      push.status === 'skipped' ? `skipped:${push.reason}` : push.status;
  } catch {
    // Swallowed on purpose; see the caller.
  }
  // Losing the claim to a concurrent delivery is normal. Anything else that
  // stopped the push is logged, without customer text or secrets, so a
  // broken push path is visible even though the webhook still succeeds.
  if (
    pushStatus !== 'sent' &&
    pushStatus !== 'skipped:already_claimed' &&
    pushStatus !== 'skipped:muted'
  ) {
    console.warn('Chat message push was not sent', {
      eventKey: chatEvent.eventKey,
      merchantId: chatEvent.merchantId,
      status: pushStatus,
    });
  }
}

/**
 * Chat webhook receiver: turns a signed "customer sent a message" event into
 * a merchant notification.
 *
 * - The path key only selects which store's signing secret applies; the
 *   request is trusted only after its signature and timestamp verify.
 * - An unknown key and a bad signature get the same 401, so the endpoint does
 *   not reveal which stores exist.
 * - Events that are not a public customer message for the bound inbox are
 *   acknowledged and dropped (200), so the sender does not retry them.
 * - A newly notified message is also pushed to the store's merchant-app
 *   devices, best effort and at most once per message.
 * - A database or configuration failure is 503, so the sender may retry;
 *   a redelivery is harmless because the database removes duplicates.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ webhookKey: string }> }
) {
  const { webhookKey } = await context.params;
  const binding = getChatWebhookBinding(webhookKey);

  const body = await readChatWebhookBody(request);
  if (!body.ok) {
    return body.reason === 'too_large'
      ? respond(413, { error: 'Payload too large', code: 'payload_too_large' })
      : respond(400, { error: 'Invalid request', code: 'invalid_request' });
  }

  if (
    !binding ||
    !verifyChatWebhookSignature({
      rawBody: body.text,
      signatureHeader: request.headers.get('x-chatwoot-signature'),
      timestampHeader: request.headers.get('x-chatwoot-timestamp'),
      secret: binding.webhookSecret,
    })
  ) {
    return respond(401, { error: 'Unauthorized', code: 'unauthorized' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.text);
  } catch {
    return respond(400, { error: 'Invalid request', code: 'invalid_request' });
  }
  const envelope = chatWebhookEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    return respond(400, { error: 'Invalid request', code: 'invalid_request' });
  }
  if (envelope.data.event !== 'message_created') {
    return respond(200, { received: true, handled: false });
  }
  const message = chatWebhookMessageCreatedSchema.safeParse(payload);
  if (!message.success) {
    return respond(400, { error: 'Invalid request', code: 'invalid_request' });
  }

  const event = message.data;
  if (
    event.message_type !== 'incoming' ||
    event.private === true ||
    event.account.id !== binding.accountId ||
    event.inbox.id !== binding.inboxId
  ) {
    return respond(200, { received: true, handled: false });
  }

  const chatEvent = {
    merchantId: binding.merchantId,
    // Stable per provider message. The prefix keeps even the smallest ids
    // within the 8-80 characters the database intake requires.
    eventKey: `chat-msg-${event.account.id}-${event.id}`,
    conversationId: event.conversation.id,
    customerName: normalizeChatEventText(
      event.sender?.name,
      CHAT_EVENT_NAME_MAX_LENGTH
    ),
    preview: normalizeChatEventText(
      event.content,
      CHAT_EVENT_PREVIEW_MAX_LENGTH
    ),
  };
  const result = await recordChatCustomerMessage(chatEvent);
  if (!result.ok) {
    return respond(503, {
      error: 'Temporarily unavailable',
      code: 'temporarily_unavailable',
    });
  }
  // Push only for a newly created notification. It runs after the response
  // so the sender's 200 never waits on the push provider; it is best effort
  // and at most once (the database hands out one claim per event), and it
  // never changes the answer: the notification itself is already recorded.
  if (result.outcome === 'notified' && !result.duplicate) {
    after(() => pushChatMessage(chatEvent));
  }
  return respond(200, { received: true, handled: true });
}
