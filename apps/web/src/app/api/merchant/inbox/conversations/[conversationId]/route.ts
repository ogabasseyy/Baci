import type { NextRequest } from 'next/server';
import { observeChatFollowUp } from '@/lib/chatwoot/chat-follow-up-reminder-observe';
import { recoverAcceptedFollowUpReminder } from '@/lib/chatwoot/chat-follow-up-reminder-recover';
import { syncChatFollowUpReminder } from '@/lib/chatwoot/chat-follow-up-reminder-sync';
import { readChatFollowUpReminderVersion } from '@/lib/chatwoot/chat-follow-up-reminder-version';
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

  const chat = {
    merchantId: resolved.binding.merchantId,
    conversationId: conversationId.data,
  };
  // Read before the chat changes: the reminder is then only written over this
  // version, so a teammate's newer one is noticed.
  const seen =
    update.data.followUpAt !== undefined || update.data.status !== undefined
      ? await readChatFollowUpReminderVersion(resolved.supabase, chat)
      : undefined;

  const result = await updateMerchantInboxConversation(resolved.binding, {
    conversationId: conversationId.data,
    update: update.data,
  });
  if (result.ok) {
    // The push reminder follows the change the chat engine just accepted. It
    // is best effort: a failure here never fails the change itself.
    await syncChatFollowUpReminder(resolved.supabase, {
      ...chat,
      update: update.data,
      customerName: result.conversation.customerName,
      seen,
      recheck: () => observeChatFollowUp(resolved.binding, conversationId.data),
      observed: {
        status: result.conversation.status,
        followUp: result.conversation.followUp,
        snoozedUntil: result.conversation.snoozedUntil,
      },
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
  // A later write or the read-back can fail after the follow-up was set or
  // cancelled.
  await recoverAcceptedFollowUpReminder(resolved.supabase, resolved.binding, {
    conversationId: conversationId.data,
    update: update.data,
    seen,
    sent: 'followUpSent' in result ? result.followUpSent : undefined,
    cancelSent:
      'followUpCancelSent' in result ? result.followUpCancelSent : undefined,
  });
  return merchantInboxError(
    503,
    'Messages are temporarily unavailable',
    'temporarily_unavailable'
  );
}
