import type { NextRequest } from 'next/server';
import { getMerchantInboxInsights } from '@/lib/chatwoot/merchant-inbox-insights';
import {
  merchantInboxError,
  merchantInboxJson,
  resolveMerchantInboxRequest,
} from '@/lib/chatwoot/merchant-inbox-request';
import { merchantInboxInsightsQuerySchema } from '@/schemas/merchant-inbox-insights-query';

/** Conversation totals and reply times for the signed-in merchant's chat. */
export async function GET(request: NextRequest) {
  // Authenticate first: an unauthenticated caller learns nothing about input.
  const resolved = await resolveMerchantInboxRequest(request, 'view');
  if (!resolved.ok) return resolved.response;

  const query = merchantInboxInsightsQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!query.success) {
    return merchantInboxError(400, 'Invalid request', 'invalid_request');
  }

  const result = await getMerchantInboxInsights(resolved.binding, query.data);
  if (!result.ok) {
    return merchantInboxError(
      503,
      'Chat insights are temporarily unavailable',
      'temporarily_unavailable'
    );
  }
  return merchantInboxJson(result.insights);
}
