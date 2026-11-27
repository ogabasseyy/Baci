import type { NextRequest } from 'next/server';
import { getMerchantInboxConversation } from '@/lib/chatwoot/merchant-inbox-client';
import { loadCustomerProfile } from '@/lib/chatwoot/merchant-inbox-customer';
import { MerchantInboxCustomerUnavailableError } from '@/lib/chatwoot/merchant-inbox-customer-unavailable';
import {
  merchantInboxError,
  merchantInboxJson,
  resolveMerchantInboxRequest,
} from '@/lib/chatwoot/merchant-inbox-request';
import { merchantInboxConversationIdSchema } from '@/schemas/merchant-inbox';

/**
 * The signed-in customer behind a chat, with their order history, for the
 * signed-in merchant's own chats. `{ customer: null }` for a guest chat or a
 * link that does not verify.
 */
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
  if (!conversationId.success) {
    return merchantInboxError(400, 'Invalid request', 'invalid_request');
  }

  // Reads the chat from the bound inbox only, so another store's chat id is
  // indistinguishable from a missing one.
  const owned = await getMerchantInboxConversation(
    resolved.binding,
    conversationId.data
  );
  if (!owned.ok) {
    return owned.code === 'not_found'
      ? merchantInboxError(404, 'Conversation not found', 'not_found')
      : merchantInboxError(
          503,
          'Messages are temporarily unavailable',
          'temporarily_unavailable'
        );
  }
  if (!owned.link) return merchantInboxJson({ customer: null });

  try {
    const customer = await loadCustomerProfile({
      supabase: resolved.supabase,
      merchantId: resolved.merchantId,
      token: owned.link,
      // Order details need their own permission, beyond reading chats.
      includeOrders: resolved.canViewOrders,
    });
    return merchantInboxJson({ customer });
  } catch (error) {
    // Unreadable records are an outage, not a guest chat.
    if (error instanceof MerchantInboxCustomerUnavailableError) {
      return merchantInboxError(
        503,
        'Customer details are temporarily unavailable',
        'temporarily_unavailable'
      );
    }
    throw error;
  }
}
