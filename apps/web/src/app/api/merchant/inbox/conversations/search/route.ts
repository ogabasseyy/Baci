import type { NextRequest } from 'next/server';
import {
  merchantInboxError,
  merchantInboxJson,
  resolveMerchantInboxRequest,
} from '@/lib/chatwoot/merchant-inbox-request';
import { searchMerchantInboxConversations } from '@/lib/chatwoot/merchant-inbox-search-client';
import { merchantInboxSearchQuerySchema } from '@/schemas/merchant-inbox-manage';

/** Searches the signed-in merchant's chats by name, contact and message text. */
export async function GET(request: NextRequest) {
  // Authenticate first: an unauthenticated caller learns nothing about input.
  const resolved = await resolveMerchantInboxRequest(request, 'view');
  if (!resolved.ok) return resolved.response;

  const query = merchantInboxSearchQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!query.success) {
    return merchantInboxError(400, 'Invalid request', 'invalid_request');
  }

  const result = await searchMerchantInboxConversations(
    resolved.binding,
    query.data
  );
  if (!result.ok) {
    return merchantInboxError(
      503,
      'Search is temporarily unavailable',
      'temporarily_unavailable'
    );
  }
  return merchantInboxJson({
    results: result.results,
    hasMore: result.hasMore,
    page: query.data.page,
  });
}
