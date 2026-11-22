import type { NextRequest } from 'next/server';
import { listMerchantInboxConversations } from '@/lib/chatwoot/merchant-inbox-client';
import { loadCustomerBadges } from '@/lib/chatwoot/merchant-inbox-customer';
import {
  merchantInboxError,
  merchantInboxJson,
  resolveMerchantInboxRequest,
} from '@/lib/chatwoot/merchant-inbox-request';
import { merchantInboxListQuerySchema } from '@/schemas/merchant-inbox';

/** Lists the signed-in merchant's customer conversations. */
export async function GET(request: NextRequest) {
  // Authenticate first: an unauthenticated caller learns nothing about input.
  const resolved = await resolveMerchantInboxRequest(request, 'view');
  if (!resolved.ok) return resolved.response;

  const query = merchantInboxListQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!query.success) {
    return merchantInboxError(400, 'Invalid request', 'invalid_request');
  }

  const result = await listMerchantInboxConversations(
    resolved.binding,
    query.data
  );
  if (!result.ok) {
    return merchantInboxError(
      503,
      'Messages are temporarily unavailable',
      'temporarily_unavailable'
    );
  }
  // Verified signed-in customers get a badge; this never fails the list.
  const badges = await loadCustomerBadges({
    supabase: resolved.supabase,
    merchantId: resolved.merchantId,
    links: result.links,
  });
  const withCustomers = result.conversations.map((conversation) =>
    badges[conversation.id]
      ? { ...conversation, customer: badges[conversation.id] }
      : conversation
  );
  const conversations =
    query.data.view === 'returning'
      ? withCustomers.filter((c) => (c.customer?.orderCount ?? 0) > 0)
      : withCustomers;
  return merchantInboxJson({
    conversations,
    hasMore: result.hasMore,
    page: query.data.page,
  });
}
