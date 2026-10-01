import { SANTA_MERCHANT_SLUG_HEADER } from '@/lib/agentic/santa-merchant-slug-header';

/**
 * Echoes the resolving tenant on a chat response so clients can verify
 * which storefront answered. The slug is server-resolved, never reflected
 * from request input.
 */
export function withChatTenantHeader(
  response: Response,
  merchantSlug: string
): Response {
  response.headers.set(SANTA_MERCHANT_SLUG_HEADER, merchantSlug);
  return response;
}
