import type { NextRequest } from 'next/server';
import { listConversationsWithCustomers } from '@/lib/chatwoot/merchant-inbox-list-with-customers';
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

  const result = await listConversationsWithCustomers({
    binding: resolved.binding,
    supabase: resolved.supabase,
    merchantId: resolved.merchantId,
    page: query.data.page,
    status: query.data.status,
    view: query.data.view,
  });
  if (!result.ok) {
    return merchantInboxError(
      503,
      'Messages are temporarily unavailable',
      'temporarily_unavailable'
    );
  }
  return merchantInboxJson({
    conversations: result.conversations,
    hasMore: result.hasMore,
    page: result.page,
  });
}
