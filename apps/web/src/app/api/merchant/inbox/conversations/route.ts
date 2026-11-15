import type { NextRequest } from 'next/server';
import { listMerchantInboxConversations } from '@/lib/chatwoot/merchant-inbox-client';
import {
  merchantInboxError,
  merchantInboxJson,
  resolveMerchantInboxRequest,
} from '@/lib/chatwoot/merchant-inbox-request';
import { merchantInboxListQuerySchema } from '@/schemas/merchant-inbox';

/** Lists the signed-in merchant's customer conversations. */
export async function GET(request: NextRequest) {
  const query = merchantInboxListQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!query.success) {
    return merchantInboxError(400, 'Invalid request', 'invalid_request');
  }

  const resolved = await resolveMerchantInboxRequest('view');
  if (!resolved.ok) return resolved.response;

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
  return merchantInboxJson({
    conversations: result.conversations,
    hasMore: result.hasMore,
    page: query.data.page,
  });
}
