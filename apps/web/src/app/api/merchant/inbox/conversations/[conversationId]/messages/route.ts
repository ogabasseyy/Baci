import type { NextRequest } from 'next/server';
import { listMerchantInboxMessages } from '@/lib/chatwoot/merchant-inbox-client';
import {
  merchantInboxError,
  merchantInboxJson,
  resolveMerchantInboxRequest,
} from '@/lib/chatwoot/merchant-inbox-request';
import {
  merchantInboxConversationIdSchema,
  merchantInboxMessagesQuerySchema,
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
  });
}
