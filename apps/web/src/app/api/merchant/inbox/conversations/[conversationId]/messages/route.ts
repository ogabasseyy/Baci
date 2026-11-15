import type { NextRequest } from 'next/server';
import { readCartJsonBody } from '@/lib/cart/request-context';
import {
  listMerchantInboxMessages,
  sendMerchantInboxReply,
} from '@/lib/chatwoot/merchant-inbox-client';
import {
  merchantInboxError,
  merchantInboxJson,
  resolveMerchantInboxRequest,
} from '@/lib/chatwoot/merchant-inbox-request';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  merchantInboxConversationIdSchema,
  merchantInboxMessagesQuerySchema,
  merchantInboxReplySchema,
} from '@/schemas/merchant-inbox';

/** Returns one page of a conversation in the signed-in merchant's inbox. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ conversationId: string }> }
) {
  // Authenticate first: an unauthenticated caller learns nothing about input.
  const resolved = await resolveMerchantInboxRequest(request, 'view');
  if (!resolved.ok) return resolved.response;

  const { conversationId: rawConversationId } = await context.params;
  const conversationId =
    merchantInboxConversationIdSchema.safeParse(rawConversationId);
  const query = merchantInboxMessagesQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!conversationId.success || !query.success) {
    return merchantInboxError(400, 'Invalid request', 'invalid_request');
  }

  const result = await listMerchantInboxMessages(resolved.binding, {
    conversationId: conversationId.data,
    before: query.data.before,
  });
  if (!result.ok) {
    return result.code === 'not_found'
      ? merchantInboxError(404, 'Conversation not found', 'not_found')
      : merchantInboxError(
          503,
          'Messages are temporarily unavailable',
          'temporarily_unavailable'
        );
  }
  return merchantInboxJson({
    conversation: result.conversation,
    messages: result.messages,
    hasOlder: result.hasOlder,
    nextBefore: result.nextBefore,
  });
}

/** Sends the merchant's reply to a customer in their own inbox. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ conversationId: string }> }
) {
  // CSRF intentionally comes first: it is an origin check for cookie
  // sessions and needs no identity, so forged requests stop before any
  // auth or provider work.
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) return merchantInboxError(403, 'Forbidden', 'forbidden');

  // Authenticate before reading input, as the GET handlers do.
  const resolved = await resolveMerchantInboxRequest(request, 'edit');
  if (!resolved.ok) return resolved.response;

  const { conversationId: rawConversationId } = await context.params;
  const conversationId =
    merchantInboxConversationIdSchema.safeParse(rawConversationId);
  if (!conversationId.success) {
    return merchantInboxError(400, 'Invalid request', 'invalid_request');
  }
  // Shared streaming JSON reader: its 64 KB byte cap is enforced before the
  // body is buffered. The reply's own limit is the 2,000-character schema.
  const rawBody = await readCartJsonBody(request);
  const body = merchantInboxReplySchema.safeParse(
    rawBody.ok ? rawBody.body : null
  );
  if (!body.success) {
    return merchantInboxError(400, 'Invalid request', 'invalid_request');
  }

  const result = await sendMerchantInboxReply(resolved.binding, {
    conversationId: conversationId.data,
    content: body.data.content,
  });
  if (result.ok) return merchantInboxJson({ message: result.message });
  if (result.code === 'not_found') {
    return merchantInboxError(404, 'Conversation not found', 'not_found');
  }
  if (result.code === 'delivery_unknown') {
    return merchantInboxError(
      502,
      'We could not confirm this reply was sent. Check the conversation before sending it again.',
      'delivery_unknown'
    );
  }
  return merchantInboxError(
    503,
    'Messages are temporarily unavailable',
    'temporarily_unavailable'
  );
}
