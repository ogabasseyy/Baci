import type { NextRequest } from 'next/server';
import { syncChatFollowUpReminder } from '@/lib/chatwoot/chat-follow-up-reminder-sync';
import { readMerchantInboxJsonBody } from '@/lib/chatwoot/merchant-inbox-body';
import { updateMerchantInboxConversation } from '@/lib/chatwoot/merchant-inbox-manage-client';
import {
  merchantInboxError,
  merchantInboxJson,
  resolveMerchantInboxRequest,
} from '@/lib/chatwoot/merchant-inbox-request';
import { checkCsrfProtection } from '@/lib/csrf';
import { merchantInboxConversationIdSchema } from '@/schemas/merchant-inbox';
import { merchantInboxUpdateSchema } from '@/schemas/merchant-inbox-manage';

/**
 * Changes one chat in the signed-in merchant's inbox: Done / reopen,
 * follow-up, priority and tags.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ conversationId: string }> }
) {
  // CSRF first (an origin check that needs no identity), then auth, then input.
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) return merchantInboxError(403, 'Forbidden', 'forbidden');

  const resolved = await resolveMerchantInboxRequest(request, 'edit');
  if (!resolved.ok) return resolved.response;

  const { conversationId: rawConversationId } = await context.params;
  const conversationId =
    merchantInboxConversationIdSchema.safeParse(rawConversationId);
  if (!conversationId.success) {
    return merchantInboxError(400, 'Invalid request', 'invalid_request');
  }
  const rawBody = await readMerchantInboxJsonBody(request);
  const update = merchantInboxUpdateSchema.safeParse(
    rawBody.ok ? rawBody.body : null
  );
  if (!update.success) {
    return merchantInboxError(400, 'Invalid request', 'invalid_request');
  }

  const result = await updateMerchantInboxConversation(resolved.binding, {
    conversationId: conversationId.data,
    update: update.data,
  });
  if (result.ok) {
    // The push reminder follows the change the chat engine just accepted. It
    // is best effort: a failure here never fails the change itself.
    await syncChatFollowUpReminder(resolved.supabase, {
      merchantId: resolved.binding.merchantId,
      conversationId: conversationId.data,
      update: update.data,
      customerName: result.conversation.customerName,
      observedSnoozedUntil: result.conversation.snoozedUntil,
    });
    return merchantInboxJson({ conversation: result.conversation });
  }
  if (result.code === 'not_found') {
    return merchantInboxError(404, 'Conversation not found', 'not_found');
  }
  if (result.code === 'invalid_follow_up') {
    return merchantInboxError(
      400,
      'Pick a follow-up time in the next 90 days',
      'invalid_follow_up'
    );
  }
  return merchantInboxError(
    503,
    'Messages are temporarily unavailable',
    'temporarily_unavailable'
  );
}
